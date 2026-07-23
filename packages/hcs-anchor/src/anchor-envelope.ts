/**
 * CP-H7 anchor envelope — the exact bytes that would go to a consensus topic.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  NOTHING IN THIS FILE TOUCHES THE NETWORK. No SDK import, no client, no key.
 *  It builds a document, canonicalizes it, and refuses to build one that is not
 *  bound to a real, verified receipt.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Why a v2 envelope next to the v1 payload in `interfaces.ts`:
 *
 *   The v1 payload (`t/d/r/ts/env`) carries the digest and nothing else. That is
 *   enough for a topic reader who already holds the receipt, and useless to one
 *   who does not — they cannot tell which hash function produced the digest,
 *   under which canonicalization, for which receipt schema, or which payment the
 *   receipt describes. v2 adds exactly those bindings and no content.
 *
 *   v1 is left untouched. CP-H1 and CP-H2 evidence asserts its shape, and
 *   rewriting a published artifact to fit a later checkpoint is how evidence
 *   quietly stops being evidence.
 *
 * The one rule the builder enforces above all others: EVERY FIELD IS DERIVED
 * FROM THE RECEIPT. `buildAnchorEnvelope` takes the whole receipt object, never
 * loose strings, so there is no call site at which a digest and a receipt id
 * from two different receipts could be combined by mistake.
 */
import {
  ANCHOR_DIGEST_ALGORITHM,
  ANCHOR_ENVELOPE_SCHEMA_ID,
  ANCHOR_PURPOSE,
  ANCHOR_VERSION,
  CANONICALIZATION_ID,
  ENVIRONMENT,
  HCS_ANCHOR_ENVELOPE_SCHEMA,
  NETWORK,
  SCHEMA_VERSION,
  canonicalDigest,
  canonicalize,
  isDigest,
  sha256Hex,
  toIso,
  validate,
  type Clock,
} from "../../shared-schemas/src/index.ts";

// The protocol chunk limit already exists in mock-anchor.ts and is asserted by
// the CP-H1 tests. Imported rather than restated so the two can never drift.
import { HCS_SINGLE_CHUNK_LIMIT } from "./mock-anchor.ts";

/**
 * Our own budget, well under the protocol limit.
 *
 * The gap is not politeness — it is the room a future field would need. A
 * design that sits at 1023 bytes is one added identifier away from silently
 * becoming a chunked message, and chunked messages have different failure modes
 * on read-back.
 */
export const ANCHOR_ENVELOPE_BYTE_BUDGET = 640;

export const RECEIPT_SCHEMA_ID = `nomos.gx402.proof_of_action_receipt.${SCHEMA_VERSION}`;

export interface AnchorEnvelope {
  schema: typeof ANCHOR_ENVELOPE_SCHEMA_ID;
  anchor_version: typeof ANCHOR_VERSION;
  network: typeof NETWORK;
  receipt_id: string;
  record_digest: string;
  digest_algorithm: typeof ANCHOR_DIGEST_ALGORITHM;
  canonicalization: typeof CANONICALIZATION_ID;
  receipt_schema_version: string;
  source_transaction_id: string;
  source_consensus_timestamp: string;
  created_at: string;
  purpose: typeof ANCHOR_PURPOSE;
  env: typeof ENVIRONMENT;
}

/** Every refusal carries a machine-readable code. Callers branch on the code, never on the message. */
export class AnchorBindingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "AnchorBindingError";
    this.code = code;
  }
}

/** The shape this module needs from a receipt. Anything less is refused. */
interface ReceiptLike {
  schema?: unknown;
  receipt_id?: unknown;
  record?: Record<string, unknown>;
  record_digest?: unknown;
  signature?: { canonicalization?: unknown };
  anchor?: unknown;
}

function str(value: unknown, code: string, what: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AnchorBindingError(code, `${what} is missing or not a string`);
  }
  return value;
}

/**
 * Idempotency key for one receipt's anchor.
 *
 * Bound to (network, receipt_id, record_digest) and to nothing time-varying, so
 * the same receipt yields the same key on every machine and every rerun. That
 * is what makes "has this already been anchored?" a question with an answer.
 */
export function anchorKey(network: string, receiptId: string, recordDigest: string): string {
  return `anc_${sha256Hex(canonicalize([network, receiptId, recordDigest])).slice(0, 24)}`;
}

/**
 * Build the envelope for `receipt`.
 *
 * Fails closed on: a receipt whose digest does not reproduce from its own
 * record, a non-testnet network, a foreign canonicalization profile, a receipt
 * that already carries an anchor, or a missing settlement reference. Each of
 * those would produce a message that says something untrue on a permanent,
 * public topic.
 */
export function buildAnchorEnvelope(receipt: ReceiptLike, nowMs: number, clock?: Clock): AnchorEnvelope {
  const at = clock ? clock.nowMs() : nowMs;

  const schema = str(receipt.schema, "RECEIPT_SCHEMA_MISSING", "receipt.schema");
  if (schema !== RECEIPT_SCHEMA_ID) {
    throw new AnchorBindingError("RECEIPT_SCHEMA_MISMATCH", `expected ${RECEIPT_SCHEMA_ID}, got ${schema}`);
  }

  // An anchored receipt re-anchored is a second, contradictory claim about the
  // same digest. Refuse before anything else can be computed from it.
  if (receipt.anchor !== null && receipt.anchor !== undefined) {
    throw new AnchorBindingError("RECEIPT_ALREADY_ANCHORED", "receipt.anchor is not null — refusing to anchor twice");
  }

  const record = receipt.record;
  if (!record || typeof record !== "object") {
    throw new AnchorBindingError("RECEIPT_RECORD_MISSING", "receipt.record is missing");
  }

  const receiptId = str(receipt.receipt_id, "RECEIPT_ID_MISSING", "receipt.receipt_id");
  if (!/^poa_[0-9a-f]{24}$/.test(receiptId)) {
    throw new AnchorBindingError("RECEIPT_ID_MALFORMED", `receipt_id ${receiptId} is not a poa_ id`);
  }

  const recordDigest = str(receipt.record_digest, "RECORD_DIGEST_MISSING", "receipt.record_digest");
  if (!isDigest(recordDigest)) {
    throw new AnchorBindingError("RECORD_DIGEST_MALFORMED", `record_digest ${recordDigest} is not sha256:<64 hex>`);
  }

  // The strongest check in the file: recompute the digest from the record we
  // were handed. A receipt whose digest was edited — or whose record was —
  // cannot get past this, and neither can a digest pasted in from elsewhere.
  const recomputed = canonicalDigest(record);
  if (recomputed !== recordDigest) {
    throw new AnchorBindingError(
      "RECORD_DIGEST_NOT_REPRODUCIBLE",
      `record_digest ${recordDigest} does not reproduce from receipt.record (got ${recomputed})`,
    );
  }

  const canon = receipt.signature?.canonicalization;
  if (canon !== undefined && canon !== CANONICALIZATION_ID) {
    throw new AnchorBindingError(
      "CANONICALIZATION_MISMATCH",
      `receipt was canonicalized under ${String(canon)}, not ${CANONICALIZATION_ID}`,
    );
  }

  const network = str(record.network, "NETWORK_MISSING", "receipt.record.network");
  if (network !== NETWORK) {
    throw new AnchorBindingError("NETWORK_MISMATCH", `refusing to anchor a ${network} receipt; this project is ${NETWORK}-only`);
  }

  const txId = str(record.hedera_transaction_id, "SOURCE_TX_MISSING", "receipt.record.hedera_transaction_id");
  if (!/^\d+\.\d+\.\d+@\d+\.\d+$/.test(txId)) {
    throw new AnchorBindingError("SOURCE_TX_MALFORMED", `hedera_transaction_id ${txId} is malformed`);
  }

  const consensusTs = str(record.consensus_timestamp, "SOURCE_CONSENSUS_TS_MISSING", "receipt.record.consensus_timestamp");
  if (!/^\d+\.\d+$/.test(consensusTs)) {
    throw new AnchorBindingError("SOURCE_CONSENSUS_TS_MALFORMED", `consensus_timestamp ${consensusTs} is malformed`);
  }

  const envelope: AnchorEnvelope = {
    schema: ANCHOR_ENVELOPE_SCHEMA_ID,
    anchor_version: ANCHOR_VERSION,
    network: NETWORK,
    receipt_id: receiptId,
    record_digest: recordDigest,
    digest_algorithm: ANCHOR_DIGEST_ALGORITHM,
    canonicalization: CANONICALIZATION_ID,
    receipt_schema_version: RECEIPT_SCHEMA_ID,
    source_transaction_id: txId,
    source_consensus_timestamp: consensusTs,
    created_at: toIso(at),
    purpose: ANCHOR_PURPOSE,
    env: ENVIRONMENT,
  };

  assertEnvelopeWellFormed(envelope);
  return envelope;
}

/** Canonical UTF-8 bytes — exactly what a submit would put on the topic. */
export function anchorEnvelopeBytes(envelope: AnchorEnvelope): Buffer {
  return canonicalize(envelope);
}

/** Digest over the canonical bytes. Binds an evidence record to what was sent. */
export function anchorEnvelopeDigest(envelope: AnchorEnvelope): string {
  return `sha256:${sha256Hex(anchorEnvelopeBytes(envelope))}`;
}

/**
 * Schema + size validation of a standalone envelope.
 *
 * Separate from {@link assertEnvelopeBinding} on purpose: this answers "is this
 * a well-formed envelope at all", which a verifier must be able to ask about a
 * message read off the topic, without holding the receipt.
 */
export function assertEnvelopeWellFormed(envelope: unknown): asserts envelope is AnchorEnvelope {
  const issues = validate(envelope, HCS_ANCHOR_ENVELOPE_SCHEMA);
  if (issues.length > 0) {
    throw new AnchorBindingError(
      "ENVELOPE_SCHEMA_INVALID",
      issues.map((i) => `${i.path}: ${i.message}`).join("; "),
    );
  }

  const bytes = anchorEnvelopeBytes(envelope as AnchorEnvelope).length;
  if (bytes > ANCHOR_ENVELOPE_BYTE_BUDGET) {
    throw new AnchorBindingError(
      "ENVELOPE_OVERSIZED",
      `envelope is ${bytes} bytes, budget is ${ANCHOR_ENVELOPE_BYTE_BUDGET} (protocol chunk limit ${HCS_SINGLE_CHUNK_LIMIT})`,
    );
  }
}

/**
 * Re-check an envelope against the receipt it claims to anchor.
 *
 * Called before a submit and again during verification. Deliberately duplicates
 * work `buildAnchorEnvelope` already did: the envelope may have travelled
 * through a file, a topic, or another process since it was built.
 */
export function assertEnvelopeBinding(envelope: unknown, receipt: ReceiptLike): asserts envelope is AnchorEnvelope {
  assertEnvelopeWellFormed(envelope);
  const e = envelope as AnchorEnvelope;

  if (e.receipt_id !== receipt.receipt_id) {
    throw new AnchorBindingError("RECEIPT_ID_MISMATCH", `envelope names ${e.receipt_id}, receipt is ${String(receipt.receipt_id)}`);
  }
  if (e.record_digest !== receipt.record_digest) {
    throw new AnchorBindingError("RECORD_DIGEST_MISMATCH", `envelope anchors ${e.record_digest}, receipt digest is ${String(receipt.record_digest)}`);
  }

  const record = receipt.record ?? {};
  if (e.network !== record.network) {
    throw new AnchorBindingError("NETWORK_MISMATCH", `envelope says ${e.network}, receipt says ${String(record.network)}`);
  }
  if (e.source_transaction_id !== record.hedera_transaction_id) {
    throw new AnchorBindingError(
      "SOURCE_TX_MISMATCH",
      `envelope names ${e.source_transaction_id}, receipt names ${String(record.hedera_transaction_id)}`,
    );
  }
  if (e.source_consensus_timestamp !== record.consensus_timestamp) {
    throw new AnchorBindingError(
      "SOURCE_CONSENSUS_TS_MISMATCH",
      `envelope names ${e.source_consensus_timestamp}, receipt names ${String(record.consensus_timestamp)}`,
    );
  }

  const recomputed = canonicalDigest(record);
  if (recomputed !== e.record_digest) {
    throw new AnchorBindingError(
      "RECORD_DIGEST_NOT_REPRODUCIBLE",
      `envelope anchors ${e.record_digest} but the receipt record hashes to ${recomputed}`,
    );
  }
}
