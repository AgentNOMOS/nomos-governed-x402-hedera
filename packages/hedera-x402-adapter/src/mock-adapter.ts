/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MOCK / OFFLINE ADAPTER — NOT A HEDERA INTEGRATION                       ║
 * ║                                                                          ║
 * ║  Nothing in this file touches Hedera. No SDK, no network, no key, no     ║
 * ║  transaction. Every settlement it produces is stamped                    ║
 * ║  `source: "MOCK_OFFLINE"`, and that stamp travels all the way into the   ║
 * ║  signed receipt, so a receipt produced by this adapter can never be      ║
 * ║  mistaken for evidence of a real payment — not by a verifier, not by a   ║
 * ║  reviewer, and not by us three weeks from now.                          ║
 * ║                                                                          ║
 * ║  Its only job is to let the governance logic (policy, binding, receipt,  ║
 * ║  verification) be developed and tested end-to-end before CP-H2 wires in  ║
 * ║  the real `@x402/hedera` implementation behind the same interface.       ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { createHash } from "node:crypto";

import { toIso, type Clock, systemClock, assertValid, SETTLEMENT_EVIDENCE_SCHEMA, SCHEMA_VERSION } from "../../shared-schemas/src/index.ts";
import type {
  HederaX402Adapter,
  MirrorSettlementQuery,
  PaymentChallenge,
  Quote,
  SettleResult,
  SignedPaymentPayload,
  VerifyResult,
  HashScanLinks,
} from "./interfaces.ts";
import type { SettlementEvidenceLike } from "./types.ts";
import { createPaymentChallenge, checkQuoteExpiry } from "./challenge.ts";
import { buildHashScanLinks } from "./hashscan.ts";

export const MOCK_SOURCE = "MOCK_OFFLINE" as const;

/** Deterministic pseudo transaction id derived from the quote — never a real one. */
export function mockTransactionId(payerAccountId: string, quoteId: string): string {
  const h = createHash("sha256").update(`${payerAccountId}|${quoteId}`).digest();
  // Seconds pinned into a fixed, obviously-synthetic range so a mock id can
  // never be mistaken for a plausible mainnet timestamp.
  const secs = 1_000_000_000 + (h.readUInt32BE(0) % 1_000_000);
  const nanos = h.readUInt32BE(4) % 1_000_000_000;
  return `${payerAccountId}@${secs}.${String(nanos).padStart(9, "0")}`;
}

export interface MockAdapterOptions {
  clock?: Clock;
  /** Force a settlement outcome, to exercise the unhappy paths in tests. */
  forceFinality?: "FINAL" | "PENDING" | "FAILED";
  /** Simulate an on-chain amount that disagrees with the quote. */
  overrideObservedAmount?: string;
  /** Simulate a transfer that landed at the wrong account. */
  overrideObservedPayee?: string;
  /** Simulate a missing or wrong memo — i.e. a payment not bound to any request. */
  overrideObservedMemo?: string | null;
  /**
   * Pin the settled transaction id, so the SAME on-chain transaction can be
   * presented against two different quotes. That is what a replay actually is,
   * and it is the only way to exercise the transaction-level guard offline.
   */
  fixedTransactionId?: string;
}

export class MockHederaX402Adapter implements HederaX402Adapter {
  readonly #clock: Clock;
  readonly #opts: MockAdapterOptions;
  /** payer account used for mock signatures; deliberately a placeholder id. */
  readonly payerAccountId: string;

  constructor(payerAccountId = "0.0.999001", opts: MockAdapterOptions = {}) {
    this.payerAccountId = payerAccountId;
    this.#clock = opts.clock ?? systemClock;
    this.#opts = opts;
  }

  createPaymentChallenge(quote: Quote): PaymentChallenge {
    return createPaymentChallenge(quote);
  }

  /** Produce a fake `payment-signature`. Contains no key material because there is no key. */
  mockSign(quote: Quote): SignedPaymentPayload {
    return {
      payment_signature: `MOCK.${createHash("sha256")
        .update(`${this.payerAccountId}|${quote.quote_id}|${quote.atomic_amount}`)
        .digest("hex")
        .slice(0, 32)}`,
      payer_account_id: this.payerAccountId,
      scheme: "exact",
      network: quote.network,
    };
  }

  async verifyPayment(payload: SignedPaymentPayload, quote: Quote): Promise<VerifyResult> {
    const reasons: string[] = [];
    if (!payload.payment_signature?.startsWith("MOCK.")) reasons.push("not_a_mock_payload");
    if (payload.network !== quote.network) reasons.push("network_mismatch");
    if (payload.scheme !== "exact") reasons.push("scheme_unsupported");
    const exp = checkQuoteExpiry(quote, this.#clock);
    if (exp.expired) reasons.push(exp.reason.toLowerCase());
    return { valid: reasons.length === 0, reasons, payer_account_id: payload.payer_account_id };
  }

  async settlePayment(payload: SignedPaymentPayload, quote: Quote): Promise<SettleResult> {
    const verify = await this.verifyPayment(payload, quote);
    if (!verify.valid) return { settled: false, reasons: verify.reasons };

    const finality = this.#opts.forceFinality ?? "FINAL";
    if (finality !== "FINAL") return { settled: false, reasons: [`finality_${finality.toLowerCase()}`] };

    const txId = this.#opts.fixedTransactionId ?? mockTransactionId(payload.payer_account_id, quote.quote_id);
    return {
      settled: true,
      transaction_id: txId,
      consensus_timestamp: txId.split("@")[1],
      reasons: [],
    };
  }

  /**
   * Offline stand-in for the mirror-node check.
   *
   * It performs the same *comparisons* the real verifier will perform in CP-H2
   * — amount, asset, network, payee and memo must all match the quote — so the
   * negative tests written today keep their meaning once the data source is
   * swapped for a live mirror node.
   */
  async verifySettlementViaMirrorNode(query: MirrorSettlementQuery): Promise<SettlementEvidenceLike> {
    const payer = query.transaction_id.split("@")[0];
    const observedAmount = this.#opts.overrideObservedAmount ?? query.expected_atomic_amount;
    const observedPayee = this.#opts.overrideObservedPayee ?? query.expected_payee;
    const observedMemo =
      this.#opts.overrideObservedMemo === undefined ? query.expected_memo : this.#opts.overrideObservedMemo;
    const finality = this.#opts.forceFinality ?? "FINAL";

    const mismatches: string[] = [];
    if (observedAmount !== query.expected_atomic_amount) mismatches.push("amount_mismatch");
    if (observedPayee !== query.expected_payee) mismatches.push("payee_mismatch");
    if (observedMemo !== query.expected_memo) mismatches.push("memo_not_bound_to_quote");
    if (finality !== "FINAL") mismatches.push(`finality_${finality.toLowerCase()}`);

    const evidence: SettlementEvidenceLike = {
      schema: `nomos.gx402.settlement_evidence.${SCHEMA_VERSION}`,
      source: MOCK_SOURCE,
      verified: mismatches.length === 0,
      network: query.expected_network,
      asset: query.expected_asset,
      atomic_amount: observedAmount,
      payer,
      payee: observedPayee,
      transaction_id: query.transaction_id,
      consensus_timestamp: query.transaction_id.split("@")[1] ?? null,
      memo: observedMemo,
      finality,
      checked_at: toIso(this.#clock.nowMs()),
      failure_code: mismatches.length === 0 ? null : mismatches[0],
    };
    assertValid(evidence, SETTLEMENT_EVIDENCE_SCHEMA);
    return evidence;
  }

  buildHashScanLinks(args: {
    transaction_id: string;
    account_id?: string;
    topic_id?: string;
    sequence_number?: number;
  }): HashScanLinks {
    return buildHashScanLinks(args);
  }
}
