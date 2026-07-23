/**
 * Independent verification of an HCS anchor.
 *
 * "Independent" means: this module never trusts a field because our own tool
 * wrote it. It recomputes the envelope from the receipt, recomputes the digest
 * from the record, and compares the bytes it derived against the bytes actually
 * read back from the topic. Anything our submitter believed is irrelevant here.
 *
 * The verifier is deliberately offline. It takes the observed message as an
 * argument rather than fetching it, so the same function verifies a live mirror
 * response, a saved fixture, and a hostile hand-edited file — and so no test
 * needs the network to exercise the real verification path.
 *
 * Failure is a list of reasons, not an exception: a verifier that throws on the
 * first problem hides the second one, and the second one is usually the
 * interesting one.
 */
import { createHash } from "node:crypto";

import {
  HCS_ANCHOR_EVIDENCE_SCHEMA,
  NETWORK,
  canonicalDigest,
  validate,
} from "../../shared-schemas/src/index.ts";
import {
  anchorEnvelopeBytes,
  anchorEnvelopeDigest,
  anchorKey,
  assertEnvelopeBinding,
  AnchorBindingError,
  type AnchorEnvelope,
} from "./anchor-envelope.ts";
import { assertTopicAllowed } from "./interfaces.ts";

export interface AnchorEvidence {
  schema: string;
  status: "SUBMITTED" | "CONFIRMED" | "FAILED";
  network: string;
  anchor_key: string;
  envelope: AnchorEnvelope;
  envelope_digest: string;
  envelope_bytes: number;
  topic_id?: string | null;
  sequence_number?: number | null;
  transaction_id?: string | null;
  consensus_timestamp?: string | null;
  running_hash?: string | null;
  submitted_at?: string | null;
  confirmed_at?: string | null;
  hashscan_url?: string | null;
  mirror_url?: string | null;
  failure_code?: string | null;
}

export interface AnchorVerdict {
  ok: boolean;
  reasons: string[];
  /** What the observed on-chain bytes hash to, when a message was supplied. */
  observed_envelope_digest: string | null;
}

/** The message as a mirror node returns it: base64 in `message`, plus consensus metadata. */
export interface ObservedTopicMessage {
  message?: unknown;
  sequence_number?: unknown;
  consensus_timestamp?: unknown;
  topic_id?: unknown;
  running_hash?: unknown;
}

/**
 * Verify an evidence record against the receipt it claims to anchor, and — when
 * supplied — against the message actually observed on the topic.
 *
 * Without `observed`, a CONFIRMED status is itself a failure: confirmation is a
 * statement about the ledger, and it cannot be made from local files alone.
 */
export function verifyAnchorEvidence(
  evidence: unknown,
  receipt: Record<string, unknown>,
  observed?: ObservedTopicMessage | null,
): AnchorVerdict {
  const reasons: string[] = [];
  let observedDigest: string | null = null;

  const issues = validate(evidence, HCS_ANCHOR_EVIDENCE_SCHEMA);
  if (issues.length > 0) {
    return {
      ok: false,
      reasons: issues.map((i) => `evidence_schema_invalid:${i.path}:${i.message}`),
      observed_envelope_digest: null,
    };
  }
  const ev = evidence as AnchorEvidence;

  // ── the envelope must belong to this receipt ──────────────────────────────
  try {
    assertEnvelopeBinding(ev.envelope, receipt as never);
  } catch (err) {
    reasons.push(err instanceof AnchorBindingError ? `binding:${err.code}` : `binding:UNKNOWN:${String(err)}`);
  }

  // ── the record must still hash to what we anchored ────────────────────────
  const record = receipt.record as Record<string, unknown> | undefined;
  if (!record) reasons.push("receipt_record_missing");
  else if (canonicalDigest(record) !== ev.envelope.record_digest) {
    reasons.push("record_digest_not_reproducible");
  }

  // ── self-consistency of the evidence record ───────────────────────────────
  const derivedBytes = anchorEnvelopeBytes(ev.envelope);
  if (ev.envelope_digest !== anchorEnvelopeDigest(ev.envelope)) reasons.push("envelope_digest_mismatch");
  if (ev.envelope_bytes !== derivedBytes.length) reasons.push("envelope_byte_count_mismatch");
  if (ev.network !== NETWORK) reasons.push("network_not_testnet");
  if (ev.anchor_key !== anchorKey(NETWORK, ev.envelope.receipt_id, ev.envelope.record_digest)) {
    reasons.push("anchor_key_mismatch");
  }

  if (ev.topic_id) {
    try {
      assertTopicAllowed(ev.topic_id);
    } catch {
      reasons.push("topic_forbidden_or_malformed");
    }
  }

  // ── what CONFIRMED is allowed to mean ─────────────────────────────────────
  if (ev.status === "CONFIRMED") {
    if (!observed) reasons.push("confirmed_without_observation");
    for (const [field, value] of [
      ["topic_id", ev.topic_id],
      ["sequence_number", ev.sequence_number],
      ["transaction_id", ev.transaction_id],
      ["consensus_timestamp", ev.consensus_timestamp],
    ] as const) {
      if (value === null || value === undefined) reasons.push(`confirmed_without_${field}`);
    }
  }

  // ── the bytes on the topic must be the bytes we built ─────────────────────
  if (observed) {
    const raw = decodeMessage(observed.message);
    if (!raw) {
      reasons.push("observed_message_undecodable");
    } else {
      observedDigest = `sha256:${bufferDigest(raw)}`;
      if (!raw.equals(derivedBytes)) reasons.push("observed_bytes_differ_from_envelope");
    }

    if (observed.topic_id !== undefined && observed.topic_id !== null && ev.topic_id && observed.topic_id !== ev.topic_id) {
      reasons.push("observed_topic_mismatch");
    }
    if (
      observed.sequence_number !== undefined &&
      observed.sequence_number !== null &&
      ev.sequence_number !== null &&
      ev.sequence_number !== undefined &&
      Number(observed.sequence_number) !== Number(ev.sequence_number)
    ) {
      reasons.push("observed_sequence_mismatch");
    }
    if (
      observed.consensus_timestamp !== undefined &&
      observed.consensus_timestamp !== null &&
      ev.consensus_timestamp &&
      observed.consensus_timestamp !== ev.consensus_timestamp
    ) {
      reasons.push("observed_consensus_timestamp_mismatch");
    }
  }

  return { ok: reasons.length === 0, reasons, observed_envelope_digest: observedDigest };
}

/**
 * Detect an attempt to anchor a receipt that already has an anchor on the topic.
 *
 * Runs against messages fetched from the topic, so it catches a duplicate that
 * a previous run created on a different machine — which a local marker file
 * cannot. Both guards exist because they fail in different situations.
 */
export function findDuplicateAnchor(
  messages: readonly ObservedTopicMessage[],
  receiptId: string,
  recordDigest: string,
): ObservedTopicMessage | null {
  for (const m of messages) {
    const raw = decodeMessage(m.message);
    if (!raw) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      continue; // a foreign message on a shared topic is not our duplicate
    }
    const p = parsed as Partial<AnchorEnvelope>;
    if (p?.receipt_id === receiptId && p?.record_digest === recordDigest) return m;
  }
  return null;
}

function decodeMessage(message: unknown): Buffer | null {
  if (typeof message === "string") {
    // Mirror nodes return base64. Reject anything that does not round-trip,
    // rather than silently verifying a mangled decode.
    const buf = Buffer.from(message, "base64");
    return buf.toString("base64").replace(/=+$/, "") === message.replace(/=+$/, "") ? buf : null;
  }
  if (Buffer.isBuffer(message)) return message;
  if (message instanceof Uint8Array) return Buffer.from(message);
  return null;
}

function bufferDigest(b: Buffer): string {
  return createHash("sha256").update(b).digest("hex");
}
