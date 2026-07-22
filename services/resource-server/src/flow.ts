/**
 * The governed flow, end to end, as one auditable state machine.
 *
 *   Discovery → Policy Preflight → HTTP 402 → Payment Authorization
 *   → Settlement Verification → Execution → Delivery Hash
 *   → Signed Proof-of-Action Receipt → optional HCS Anchor → Verification
 *
 * Transport-free on purpose: CP-H1 needs this chain to be testable without a
 * server, and CP-H2 will mount it behind HTTP without changing a line of the
 * logic below. `httpStatus` on each outcome is the status the HTTP layer will
 * return, recorded here so the tests pin the contract now.
 *
 * ORDERING RULE, and the reason this file exists:
 *
 *   Work is released ONLY after settlement is observed FINAL and the observed
 *   transfer is bound to this quote by memo, amount, asset, network and payee.
 *   The Hedera x402 reference implementation settles after the handler returns
 *   and documents the consequence itself — "a verify-pass / settle-fail means
 *   data was delivered without payment landing". The production Base gateway in
 *   this project's lineage hit the mirror-image bug and fixed it the same way:
 *   verify is not paid. So delivery is gated on settlement here, and every
 *   negative test in tests/integration exists to keep it that way.
 */
import {
  canonicalDigest,
  toIso,
  type Clock,
  systemClock,
  isDigest,
} from "../../../packages/shared-schemas/src/index.ts";
import {
  evaluate,
  policyHash,
  ReplayGuard,
  SpendLedger,
  type Decision,
  type PolicyDocument,
} from "../../../packages/nomos-policy/src/index.ts";
import {
  buildPrepaymentDecisionReceipt,
  buildProofOfActionReceipt,
  attachAnchor,
  type ProofOfActionReceipt,
  type PrepaymentDecisionReceipt,
  type DeliveryEvidence,
  type SettlementEvidence,
  type ReceiptSigner,
} from "../../../packages/evidence-receipt/src/index.ts";
import {
  issueQuote,
  createPaymentChallenge,
  checkQuoteExpiry,
  type Quote,
  type PaymentChallenge,
  type SignedPaymentPayload,
  type HederaX402Adapter,
} from "../../../packages/hedera-x402-adapter/src/index.ts";
import { replayKey as makeReplayKey } from "../../../packages/shared-schemas/src/ids.ts";
import type { HcsAnchor } from "../../../packages/hcs-anchor/src/index.ts";
import {
  executeEvidenceRequest,
  hashEvidenceRequest,
  hashEvidenceResult,
  validateEvidenceRequest,
  EvidenceServiceError,
  type EvidenceRequest,
  type EvidenceResult,
} from "./evidence-service.ts";
import { SCHEMA_VERSION } from "../../../packages/shared-schemas/src/schemas.ts";

export interface ServiceOffer {
  schema: string;
  offer_id: string;
  service: { service_id: string; resource_url: string; http_method: string };
  description?: string;
  network: "hedera:testnet";
  asset: string;
  atomic_amount: string;
  pay_to: string;
  quote_ttl_seconds: number;
}

export interface FlowConfig {
  offer: ServiceOffer;
  policy: PolicyDocument;
  adapter: HederaX402Adapter & { mockSign?(q: Quote): SignedPaymentPayload };
  signer: ReceiptSigner;
  anchor?: HcsAnchor;
  anchorTopicId?: string;
  clock?: Clock;
}

export interface PreflightOutcome {
  httpStatus: 200 | 402 | 403;
  decision: Decision;
  decision_receipt: PrepaymentDecisionReceipt;
  challenge?: PaymentChallenge;
  quote?: Quote;
}

export interface PaidOutcome {
  httpStatus: 200 | 402 | 409 | 422 | 502;
  code: string;
  receipt?: ProofOfActionReceipt;
  result?: EvidenceResult;
  settlement?: SettlementEvidence;
  delivery?: DeliveryEvidence;
  /** True when this call returned a previously computed result instead of executing again. */
  idempotent_replay?: boolean;
}

interface ExecutionRecord {
  receipt: ProofOfActionReceipt;
  result: EvidenceResult;
  settlement: SettlementEvidence;
  delivery: DeliveryEvidence;
}

export class GovernedFlow {
  readonly #cfg: FlowConfig;
  readonly #clock: Clock;
  readonly ledger = new SpendLedger();
  readonly replay = new ReplayGuard();
  readonly usedNonces = new Set<string>();
  /** idempotency_key -> completed execution. One execution per key, forever. */
  readonly #executions = new Map<string, ExecutionRecord>();
  /** quote_id -> quote, for the second leg of the request. */
  readonly #quotes = new Map<string, Quote>();

  constructor(cfg: FlowConfig) {
    this.#cfg = cfg;
    this.#clock = cfg.clock ?? systemClock;
  }

  /** Step 1 — Discovery. Public, unauthenticated, contains no secrets. */
  discover(): ServiceOffer {
    return this.#cfg.offer;
  }

  /**
   * Steps 2–3 — Policy preflight, then the 402 challenge.
   *
   * A DENY still produces a fully bound, signed receipt. That is the difference
   * between a system that refuses and a system that can prove why it refused.
   */
  preflight(args: {
    agent_identity: Record<string, unknown>;
    authority_scope: Record<string, unknown>;
    request_body: EvidenceRequest;
    request_id: string;
    nonce: string;
    payer_account_id: string;
  }): PreflightOutcome {
    const nowMs = this.#clock.nowMs();
    const normalized = validateEvidenceRequest(args.request_body);
    const request_hash = hashEvidenceRequest(normalized);

    const preflightRequest = {
      schema: `nomos.gx402.policy_preflight_request.${SCHEMA_VERSION}`,
      request_id: args.request_id,
      nonce: args.nonce,
      agent_identity: args.agent_identity,
      authority_scope: args.authority_scope,
      offer: this.#cfg.offer,
      request_hash,
      requested_at: toIso(nowMs),
    };

    const result = evaluate(preflightRequest, {
      policy: this.#cfg.policy,
      ledger: this.ledger,
      clock: this.#clock,
      usedNonces: this.usedNonces,
    });

    const decision_receipt = buildPrepaymentDecisionReceipt(
      result.record,
      result.decision_id,
      this.#cfg.signer,
    );

    if (result.decision !== "ALLOW") {
      return { httpStatus: 403, decision: result.decision, decision_receipt };
    }

    const quote = issueQuote({
      offer: this.#cfg.offer,
      request_hash,
      nonce: args.nonce,
      payer_account_id: args.payer_account_id,
      decision_id: result.decision_id,
      clock: this.#clock,
    });
    this.#quotes.set(quote.quote_id, quote);

    return {
      httpStatus: 402,
      decision: "ALLOW",
      decision_receipt,
      challenge: createPaymentChallenge(quote),
      quote,
    };
  }

  /**
   * Steps 4–10 — payment, settlement verification, execution, receipt, anchor.
   *
   * Every early return below is a refusal to deliver. There is exactly one path
   * to a 200, and it passes through a FINAL settlement bound to this quote.
   */
  async submitPayment(args: {
    quote_id: string;
    payload: SignedPaymentPayload;
    request_body: EvidenceRequest;
    agent_identity: Record<string, unknown>;
    authority_scope: Record<string, unknown>;
    decision_id: string;
    nonce: string;
    anchor?: boolean;
  }): Promise<PaidOutcome> {
    const cfg = this.#cfg;
    const quote = this.#quotes.get(args.quote_id);
    if (!quote) return { httpStatus: 409, code: "UNKNOWN_QUOTE" };

    // ── the request must be the one the quote was issued for ────────────────
    let normalized: EvidenceRequest;
    try {
      normalized = validateEvidenceRequest(args.request_body);
    } catch (e) {
      return { httpStatus: 422, code: (e as EvidenceServiceError).code ?? "INVALID_BODY" };
    }
    if (hashEvidenceRequest(normalized) !== quote.request_hash) {
      return { httpStatus: 409, code: "PAYMENT_REQUEST_MISMATCH" };
    }

    // ── expiry, decided on our clock ────────────────────────────────────────
    const expiry = checkQuoteExpiry(quote, this.#clock);
    if (expiry.expired) return { httpStatus: 402, code: expiry.reason };

    // ── idempotency: one execution per key, replays return the stored answer ─
    const prior = this.#executions.get(quote.idempotency_key);
    if (prior) {
      return {
        httpStatus: 200,
        code: "IDEMPOTENT_REPLAY",
        receipt: prior.receipt,
        result: prior.result,
        settlement: prior.settlement,
        delivery: prior.delivery,
        idempotent_replay: true,
      };
    }

    // ── verify the payment authorization, then settle ───────────────────────
    const verify = await cfg.adapter.verifyPayment(args.payload, quote);
    if (!verify.valid) return { httpStatus: 402, code: `PAYMENT_INVALID:${verify.reasons[0] ?? "unknown"}` };

    const settleRes = await cfg.adapter.settlePayment(args.payload, quote);
    if (!settleRes.settled || !settleRes.transaction_id) {
      return { httpStatus: 402, code: `SETTLE_FAILED:${settleRes.reasons[0] ?? "unknown"}` };
    }
    const transaction_id = settleRes.transaction_id;

    // ── anti-replay on the transaction itself ───────────────────────────────
    const rKey = makeReplayKey(quote.network, transaction_id);
    const seen = this.replay.check(rKey);
    if (!seen.fresh) return { httpStatus: 409, code: `TRANSACTION_REPLAY:${seen.state}` };
    this.replay.claim(rKey, this.#clock.nowMs());

    // ── settlement verification: the gate before any work happens ───────────
    const settlement = (await cfg.adapter.verifySettlementViaMirrorNode({
      transaction_id,
      expected_network: quote.network,
      expected_asset: quote.asset,
      expected_atomic_amount: quote.atomic_amount,
      expected_payee: quote.pay_to,
      expected_memo: quote.quote_id,
    })) as SettlementEvidence;

    if (!settlement.verified || settlement.finality !== "FINAL") {
      this.replay.settle(rKey, "failed", this.#clock.nowMs());
      return { httpStatus: 402, code: `SETTLEMENT_UNVERIFIED:${settlement.failure_code ?? settlement.finality}`, settlement };
    }

    // Payment is real and bound. From here on the money is spent, so every
    // failure must still produce a signed receipt.
    this.ledger.commit(this.#clock.nowMs(), settlement.atomic_amount);

    // ── execution ───────────────────────────────────────────────────────────
    let result: EvidenceResult | undefined;
    let execution_status: "SUCCEEDED" | "FAILED" = "SUCCEEDED";
    let failure_code: string | null = null;
    try {
      result = executeEvidenceRequest(normalized);
    } catch (e) {
      execution_status = "FAILED";
      failure_code = (e as Error).name;
    }

    const result_hash = result ? hashEvidenceResult(result) : canonicalDigest({});
    const delivered = execution_status === "SUCCEEDED";

    const delivery: DeliveryEvidence = {
      schema: `nomos.gx402.delivery_evidence.${SCHEMA_VERSION}`,
      idempotency_key: quote.idempotency_key,
      execution_status,
      delivery_status: delivered ? "DELIVERED" : "NOT_DELIVERED",
      result_hash,
      result_media_type: delivered ? "application/json" : null,
      result_byte_length: result ? Buffer.byteLength(JSON.stringify(result)) : null,
      executed_at: toIso(this.#clock.nowMs()),
      failure_code,
      // Paid but not delivered: record the obligation. This demo never moves
      // money by itself, so it states the debt rather than settling it.
      refund_due: !delivered,
    };

    // ── receipt ─────────────────────────────────────────────────────────────
    const links = cfg.adapter.buildHashScanLinks({ transaction_id });
    let receipt = buildProofOfActionReceipt(
      {
        agent_identity: args.agent_identity,
        authority_scope: args.authority_scope,
        service_identity: cfg.offer.service,
        offer_id: cfg.offer.offer_id,
        policy_decision: "ALLOW",
        policy_version: cfg.policy.policy_version,
        policy_hash: policyHash(cfg.policy),
        decision_id: args.decision_id,
        request_hash: quote.request_hash,
        quote_id: quote.quote_id,
        quote_hash: quote.quote_hash,
        idempotency_key: quote.idempotency_key,
        nonce: args.nonce,
        settlement,
        delivery,
        verification: {
          hashscan_transaction_url: links.transaction,
          mirror_transaction_url: links.mirror_transaction,
          hashscan_topic_url: null,
          mirror_topic_message_url: null,
        },
        clock: this.#clock,
      },
      cfg.signer,
    );

    // ── optional anchor: additive, never a precondition ─────────────────────
    if (args.anchor && cfg.anchor && cfg.anchorTopicId) {
      const anchorRes = await cfg.anchor.anchorReceiptHash({
        record_digest: receipt.record_digest,
        receipt_id: receipt.receipt_id,
        topic_id: cfg.anchorTopicId,
        clock: this.#clock,
      });
      // A failed anchor leaves the receipt exactly as valid as it already was.
      receipt = attachAnchor(receipt, anchorRes);
    }

    this.replay.settle(rKey, "consumed", this.#clock.nowMs());
    const record: ExecutionRecord = { receipt, result: result!, settlement, delivery };
    this.#executions.set(quote.idempotency_key, record);

    return {
      httpStatus: 200,
      code: delivered ? "DELIVERED" : "PAID_EXECUTION_FAILED",
      receipt,
      result,
      settlement,
      delivery,
      idempotent_replay: false,
    };
  }

  /** Test/inspection helper — never exposed over HTTP. */
  knownQuote(quoteId: string): Quote | undefined {
    return this.#quotes.get(quoteId);
  }
}

/** Guard used by callers that want to assert a digest before trusting it. */
export function requireDigest(value: unknown, field: string): string {
  if (!isDigest(value)) throw new Error(`MALFORMED_DIGEST:${field}`);
  return value;
}
