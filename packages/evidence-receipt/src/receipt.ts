/**
 * Receipt assembly and verification.
 *
 * The verifier here is the honest half of the project. It is written to be
 * runnable by someone who does not trust us: it recomputes every digest from
 * the receipt's own contents, checks the signature against a key set supplied
 * from outside, and cross-checks the payment, request, quote and result
 * bindings against each other. Nothing is taken on the receipt's word.
 */
import {
  canonicalDigest,
  digestExcluding,
  isDigest,
  assertValid,
  validate,
  toIso,
  type Clock,
  systemClock,
  PREPAYMENT_DECISION_RECEIPT_SCHEMA,
  PROOF_OF_ACTION_RECEIPT_SCHEMA,
  SETTLEMENT_EVIDENCE_SCHEMA,
  DELIVERY_EVIDENCE_SCHEMA,
  DOMAIN_PREPAYMENT_DECISION,
  DOMAIN_PROOF_OF_ACTION,
  SCHEMA_VERSION,
  ENVIRONMENT,
  DISCLAIMER,
  receiptId as makeReceiptId,
} from "../../shared-schemas/src/index.ts";
import { verifySignature, type ReceiptSigner, type SignatureBlock } from "./signer.ts";

// ── prepayment decision receipt ─────────────────────────────────────────────

export interface PrepaymentDecisionReceipt {
  schema: string;
  decision_id: string;
  record: Record<string, unknown>;
  record_digest: string;
  signature: SignatureBlock;
}

export function buildPrepaymentDecisionReceipt(
  record: Record<string, unknown>,
  decisionId: string,
  signer: ReceiptSigner,
): PrepaymentDecisionReceipt {
  const record_digest = canonicalDigest(record);
  const receipt: PrepaymentDecisionReceipt = {
    schema: `nomos.gx402.prepayment_decision_receipt.${SCHEMA_VERSION}`,
    decision_id: decisionId,
    record,
    record_digest,
    signature: signer.sign(DOMAIN_PREPAYMENT_DECISION, record),
  };
  assertValid(receipt, PREPAYMENT_DECISION_RECEIPT_SCHEMA);
  return receipt;
}

export function verifyPrepaymentDecisionReceipt(
  receipt: unknown,
  trustedKeys?: Readonly<Record<string, string>>,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const issues = validate(receipt, PREPAYMENT_DECISION_RECEIPT_SCHEMA);
  if (issues.length > 0) {
    return { ok: false, reasons: issues.map((i) => `schema:${i.path}:${i.code}`) };
  }
  const r = receipt as PrepaymentDecisionReceipt;

  if (canonicalDigest(r.record) !== r.record_digest) reasons.push("record_digest_mismatch");

  const bt = (r.record as any).bound_terms;
  if (canonicalDigest(bt) !== (r.record as any).bound_terms_digest) reasons.push("bound_terms_digest_mismatch");

  // The binding must be symmetric: a DENY carries the same fields as an ALLOW.
  for (const [k, v] of Object.entries(bt as Record<string, unknown>)) {
    if (v === undefined || v === null || v === "") reasons.push(`bound_terms_hole:${k}`);
  }

  if ((r.record as any).authorizes_payment !== false) reasons.push("receipt_claims_payment_authority");

  const sig = verifySignature(r.record, r.signature, DOMAIN_PREPAYMENT_DECISION, trustedKeys);
  reasons.push(...sig.reasons);

  return { ok: reasons.length === 0, reasons };
}

// ── proof-of-action receipt ─────────────────────────────────────────────────

export interface SettlementEvidence {
  schema: string;
  source: "MOCK_OFFLINE" | "MIRROR_NODE";
  verified: boolean;
  network: string;
  asset: string;
  atomic_amount: string;
  payer: string;
  payee: string;
  transaction_id: string;
  consensus_timestamp?: string | null;
  memo?: string | null;
  finality: "FINAL" | "PENDING" | "FAILED";
  checked_at: string;
  failure_code?: string | null;
}

export interface DeliveryEvidence {
  schema: string;
  idempotency_key: string;
  execution_status: "SUCCEEDED" | "FAILED";
  delivery_status: "DELIVERED" | "NOT_DELIVERED";
  result_hash: string;
  result_media_type?: string | null;
  result_byte_length?: number | null;
  executed_at: string;
  failure_code?: string | null;
  refund_due?: boolean;
}

export interface AnchorReference {
  schema: string;
  source: "MOCK_OFFLINE" | "HEDERA_HCS";
  status: "ANCHORED" | "PENDING" | "FAILED";
  network: string;
  anchored_digest: string;
  topic_id?: string | null;
  sequence_number?: number | null;
  transaction_id?: string | null;
  consensus_timestamp?: string | null;
  anchored_at?: string | null;
  hashscan_url?: string | null;
  mirror_url?: string | null;
  failure_code?: string | null;
}

export interface ProofOfActionInput {
  agent_identity: Record<string, unknown>;
  authority_scope: Record<string, unknown>;
  service_identity: Record<string, unknown>;
  offer_id: string;
  policy_decision: "ALLOW" | "DENY" | "REVIEW";
  policy_version: string;
  policy_hash: string;
  decision_id: string;
  request_hash: string;
  quote_id: string;
  quote_hash: string;
  idempotency_key: string;
  nonce: string;
  settlement: SettlementEvidence;
  delivery: DeliveryEvidence;
  /** Link builders — see packages/hedera-x402-adapter/src/hashscan.ts */
  verification: {
    hashscan_transaction_url: string;
    hashscan_topic_url?: string | null;
    mirror_transaction_url?: string | null;
    mirror_topic_message_url?: string | null;
  };
  clock?: Clock;
}

export interface ProofOfActionReceipt {
  schema: string;
  receipt_version: string;
  receipt_id: string;
  record: Record<string, unknown>;
  record_digest: string;
  signature: SignatureBlock;
  anchor?: AnchorReference | null;
  verification: ProofOfActionInput["verification"];
}

/**
 * Assemble and sign the proof-of-action receipt.
 *
 * Note what is NOT a parameter: the request body and the result body. Only
 * their digests reach this function, so there is no code path by which content
 * could end up in a receipt or, later, on a public consensus topic.
 */
export function buildProofOfActionReceipt(
  input: ProofOfActionInput,
  signer: ReceiptSigner,
): ProofOfActionReceipt {
  assertValid(input.settlement, SETTLEMENT_EVIDENCE_SCHEMA);
  assertValid(input.delivery, DELIVERY_EVIDENCE_SCHEMA);

  if (input.delivery.idempotency_key !== input.idempotency_key) {
    throw new Error("IDEMPOTENCY_KEY_MISMATCH: delivery evidence belongs to a different execution");
  }

  const nowMs = (input.clock ?? systemClock).nowMs();
  const s = input.settlement;
  const d = input.delivery;

  const record: Record<string, unknown> = {
    agent_identity: input.agent_identity,
    authority_scope: input.authority_scope,
    service_identity: input.service_identity,
    offer_id: input.offer_id,

    policy_decision: input.policy_decision,
    policy_version: input.policy_version,
    policy_hash: input.policy_hash,
    decision_id: input.decision_id,

    request_hash: input.request_hash,
    quote_id: input.quote_id,
    quote_hash: input.quote_hash,
    idempotency_key: input.idempotency_key,
    nonce: input.nonce,

    network: s.network,
    asset: s.asset,
    atomic_amount: s.atomic_amount,
    payer: s.payer,
    payee: s.payee,

    hedera_transaction_id: s.transaction_id,
    ...(s.consensus_timestamp ? { consensus_timestamp: s.consensus_timestamp } : {}),
    settlement_source: s.source,
    settlement_finality: s.finality,

    execution_status: d.execution_status,
    delivery_status: d.delivery_status,
    result_hash: d.result_hash,
    refund_due: d.refund_due ?? (s.finality === "FINAL" && d.execution_status === "FAILED"),

    receipt_timestamp: toIso(nowMs),
    environment: ENVIRONMENT,
    disclaimer: DISCLAIMER,
  };

  const record_digest = canonicalDigest(record);
  const receipt: ProofOfActionReceipt = {
    schema: `nomos.gx402.proof_of_action_receipt.${SCHEMA_VERSION}`,
    receipt_version: SCHEMA_VERSION,
    receipt_id: makeReceiptId(input.idempotency_key, s.transaction_id, record_digest),
    record,
    record_digest,
    signature: signer.sign(DOMAIN_PROOF_OF_ACTION, record),
    anchor: null,
    verification: input.verification,
  };

  assertValid(receipt, PROOF_OF_ACTION_RECEIPT_SCHEMA);
  return receipt;
}

/** Attach an anchor reference. Additive: the receipt was already valid without it. */
export function attachAnchor(receipt: ProofOfActionReceipt, anchor: AnchorReference): ProofOfActionReceipt {
  if (anchor.anchored_digest !== receipt.record_digest) {
    throw new Error(
      `ANCHOR_DIGEST_MISMATCH: anchor claims ${anchor.anchored_digest} but receipt is ${receipt.record_digest}`,
    );
  }
  const next = { ...receipt, anchor };
  assertValid(next, PROOF_OF_ACTION_RECEIPT_SCHEMA);
  return next;
}

export interface ProofVerification {
  ok: boolean;
  reasons: string[];
  /** True when the receipt is internally sound but the payment was never observed on-chain. */
  mock_settlement: boolean;
}

/**
 * Full verification.
 *
 * `expected` lets a relying party assert what it *thinks* it ordered — the
 * receipt then has to agree. Without it the verifier still checks internal
 * consistency, but cannot detect a receipt that is perfectly formed and about
 * an entirely different purchase.
 */
export function verifyProofOfActionReceipt(
  receipt: unknown,
  opts: {
    trustedKeys?: Readonly<Record<string, string>>;
    expected?: Partial<{
      request_hash: string;
      quote_hash: string;
      result_hash: string;
      atomic_amount: string;
      payee: string;
      network: string;
      asset: string;
    }>;
  } = {},
): ProofVerification {
  const reasons: string[] = [];
  const issues = validate(receipt, PROOF_OF_ACTION_RECEIPT_SCHEMA);
  if (issues.length > 0) {
    return { ok: false, reasons: issues.map((i) => `schema:${i.path}:${i.code}`), mock_settlement: false };
  }

  const r = receipt as ProofOfActionReceipt;
  const rec = r.record as Record<string, any>;

  if (canonicalDigest(rec) !== r.record_digest) reasons.push("record_digest_mismatch");

  if (makeReceiptId(rec.idempotency_key, rec.hedera_transaction_id, r.record_digest) !== r.receipt_id) {
    reasons.push("receipt_id_mismatch");
  }

  const sig = verifySignature(rec, r.signature, DOMAIN_PROOF_OF_ACTION, opts.trustedKeys);
  reasons.push(...sig.reasons);

  // ── semantic coherence: the states must be able to coexist ────────────────
  if (rec.delivery_status === "DELIVERED" && rec.policy_decision !== "ALLOW") {
    reasons.push("delivered_without_allow");
  }
  if (rec.delivery_status === "DELIVERED" && rec.settlement_finality !== "FINAL") {
    reasons.push("delivered_without_final_settlement");
  }
  if (rec.delivery_status === "DELIVERED" && rec.execution_status !== "SUCCEEDED") {
    reasons.push("delivered_without_successful_execution");
  }
  if (rec.settlement_finality === "FINAL" && rec.execution_status === "FAILED" && rec.refund_due !== true) {
    reasons.push("paid_and_failed_without_refund_flag");
  }
  for (const f of ["request_hash", "quote_hash", "result_hash", "policy_hash"]) {
    if (!isDigest(rec[f])) reasons.push(`malformed_digest:${f}`);
  }

  // ── anchor, if present, must describe THIS receipt ────────────────────────
  if (r.anchor) {
    if (r.anchor.anchored_digest !== r.record_digest) reasons.push("anchor_digest_mismatch");
    if (r.anchor.status === "ANCHORED" && r.anchor.source === "HEDERA_HCS") {
      if (!r.anchor.topic_id || !r.anchor.sequence_number || !r.anchor.transaction_id) {
        reasons.push("anchor_claims_anchored_without_reference");
      }
    }
  }

  // ── relying-party expectations ────────────────────────────────────────────
  for (const [k, v] of Object.entries(opts.expected ?? {})) {
    if (v !== undefined && rec[k] !== v) reasons.push(`expectation_mismatch:${k}`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    mock_settlement: rec.settlement_source === "MOCK_OFFLINE",
  };
}

/** Re-export so a verifier script only needs one import. */
export { digestExcluding };
