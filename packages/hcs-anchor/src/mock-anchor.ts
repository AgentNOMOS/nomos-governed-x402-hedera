/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  MOCK / OFFLINE ANCHOR — NOTHING IS SUBMITTED TO HEDERA                  ║
 * ║                                                                          ║
 * ║  No @hashgraph / @hiero SDK import, no client, no key, no network call.  ║
 * ║  Results carry `source: "MOCK_OFFLINE"` and that value is checked by     ║
 * ║  the receipt verifier, so a mock anchor can never be read as proof that  ║
 * ║  a digest reached a consensus topic.                                     ║
 * ║                                                                          ║
 * ║  Real submission arrives in CP-H7 behind the same `HcsAnchor` interface. ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */
import { createHash } from "node:crypto";

import { canonicalize, isDigest, toIso, type Clock, systemClock, SCHEMA_VERSION } from "../../shared-schemas/src/index.ts";
import { buildHashScanLinks } from "../../hedera-x402-adapter/src/hashscan.ts";
import {
  assertTopicAllowed,
  type AnchorPayload,
  type AnchorRequest,
  type AnchorResult,
  type AnchorVerification,
  type HcsAnchor,
} from "./interfaces.ts";

/** Build the on-chain payload. Real logic — CP-H7 submits exactly these bytes. */
export function buildAnchorPayload(recordDigest: string, receiptId: string, nowMs: number): AnchorPayload {
  if (!isDigest(recordDigest)) throw new Error(`MALFORMED_DIGEST: ${recordDigest}`);
  return { t: "nomos.gx402.anchor.v1", d: recordDigest, r: receiptId, ts: toIso(nowMs), env: "TESTNET_DEMO_ONLY" };
}

/** Byte length of the message that would be submitted. Guards the single-chunk budget. */
export function anchorPayloadBytes(payload: AnchorPayload): number {
  return canonicalize(payload).length;
}

export const HCS_SINGLE_CHUNK_LIMIT = 1024;

export interface MockAnchorOptions {
  clock?: Clock;
  /** Simulate a chain-side failure so the degrade-to-PENDING path is exercised. */
  forceStatus?: "ANCHORED" | "PENDING" | "FAILED";
  /** Simulate a topic that returns a different digest than the one submitted. */
  overrideObservedDigest?: string;
}

export class MockHcsAnchor implements HcsAnchor {
  readonly #clock: Clock;
  readonly #opts: MockAnchorOptions;
  #sequence = 0;
  readonly #submitted = new Map<string, AnchorPayload>();

  constructor(opts: MockAnchorOptions = {}) {
    this.#clock = opts.clock ?? systemClock;
    this.#opts = opts;
  }

  async anchorReceiptHash(req: AnchorRequest): Promise<AnchorResult> {
    assertTopicAllowed(req.topic_id);
    const nowMs = (req.clock ?? this.#clock).nowMs();
    const payload = buildAnchorPayload(req.record_digest, req.receipt_id, nowMs);

    const bytes = anchorPayloadBytes(payload);
    if (bytes > HCS_SINGLE_CHUNK_LIMIT) {
      return this.#failed(req, "payload_exceeds_single_chunk");
    }

    const status = this.#opts.forceStatus ?? "ANCHORED";
    if (status !== "ANCHORED") {
      // Degrade, never throw: the work that produced this receipt already happened.
      return status === "PENDING" ? this.#pending(req) : this.#failed(req, "mock_forced_failure");
    }

    this.#sequence += 1;
    const seq = this.#sequence;
    const txId = mockAnchorTransactionId(req.topic_id, req.record_digest, seq);
    this.#submitted.set(`${req.topic_id}#${seq}`, payload);

    const links = buildHashScanLinks({ transaction_id: txId, topic_id: req.topic_id, sequence_number: seq });

    return {
      schema: `nomos.gx402.hcs_anchor_reference.${SCHEMA_VERSION}`,
      source: "MOCK_OFFLINE",
      status: "ANCHORED",
      network: "hedera:testnet",
      anchored_digest: req.record_digest,
      topic_id: req.topic_id,
      sequence_number: seq,
      transaction_id: txId,
      consensus_timestamp: txId.split("@")[1] ?? null,
      anchored_at: toIso(nowMs),
      hashscan_url: links.topic_message ?? links.topic ?? null,
      mirror_url: links.mirror_topic_message ?? null,
      failure_code: null,
    };
  }

  async verifyAnchor(anchor: AnchorResult, expectedDigest: string): Promise<AnchorVerification> {
    const reasons: string[] = [];
    if (anchor.status !== "ANCHORED") {
      return { ok: false, reasons: [`anchor_status_${anchor.status.toLowerCase()}`], observed_digest: null };
    }
    if (!anchor.topic_id || anchor.sequence_number === null) {
      return { ok: false, reasons: ["anchor_reference_incomplete"], observed_digest: null };
    }
    const stored = this.#submitted.get(`${anchor.topic_id}#${anchor.sequence_number}`);
    const observed = this.#opts.overrideObservedDigest ?? stored?.d ?? null;

    if (!observed) reasons.push("message_not_found");
    else if (observed !== expectedDigest) reasons.push("digest_mismatch");
    if (anchor.anchored_digest !== expectedDigest) reasons.push("anchor_claims_other_digest");

    return { ok: reasons.length === 0, reasons, observed_digest: observed };
  }

  #pending(req: AnchorRequest): AnchorResult {
    return this.#degraded(req, "PENDING", null);
  }

  #failed(req: AnchorRequest, code: string): AnchorResult {
    return this.#degraded(req, "FAILED", code);
  }

  #degraded(req: AnchorRequest, status: "PENDING" | "FAILED", code: string | null): AnchorResult {
    return {
      schema: `nomos.gx402.hcs_anchor_reference.${SCHEMA_VERSION}`,
      source: "MOCK_OFFLINE",
      status,
      network: "hedera:testnet",
      anchored_digest: req.record_digest,
      topic_id: null,
      sequence_number: null,
      transaction_id: null,
      consensus_timestamp: null,
      anchored_at: null,
      hashscan_url: null,
      mirror_url: null,
      failure_code: code,
    };
  }
}

/** Deterministic synthetic anchor transaction id. Never a real one. */
export function mockAnchorTransactionId(topicId: string, digest: string, seq: number): string {
  const h = createHash("sha256").update(`${topicId}|${digest}|${seq}`).digest();
  const secs = 1_000_000_000 + (h.readUInt32BE(0) % 1_000_000);
  const nanos = h.readUInt32BE(4) % 1_000_000_000;
  return `0.0.999002@${secs}.${String(nanos).padStart(9, "0")}`;
}
