/**
 * HCS receipt anchoring — interface surface (CP-H1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  STATUS: interface + payload schema + offline mock. NO message has been or
 *  will be submitted to Hedera by this code path until CP-H7. No existing topic
 *  is referenced anywhere in this package: topic ids arrive as configuration,
 *  and `assertTopicAllowed` actively rejects the pre-existing OracleNet topics.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Two properties the design commits to:
 *
 *   ANCHORING IS ADDITIVE. A proof-of-action receipt is complete and verifiable
 *   without an anchor. The anchor adds an independent, timestamped, third-party
 *   observation that the digest existed at a point in time — it does not confer
 *   validity. A failed anchor therefore degrades to `status: "PENDING"` and
 *   never invalidates work that already happened.
 *
 *   ONLY THE DIGEST GOES ON-CHAIN. HCS messages are public and permanent. The
 *   payload type below has no field capable of carrying request or result
 *   content, so there is no code path — not even a buggy one — by which payload
 *   data could be published.
 */
import type { Clock } from "../../shared-schemas/src/index.ts";

/** Topics that must never be written to by this project. */
export const FORBIDDEN_TOPIC_IDS = [
  "0.0.10420280", // OracleNet mainnet beacon topic — production, mainnet, 297 messages
  "0.0.10420282", // OracleNet mainnet join topic
  "0.0.8510520",  // OracleNet testnet beacon topic — key material was exposed
  "0.0.8510521",  // OracleNet testnet join topic
] as const;

export class TopicBoundaryError extends Error {
  constructor(topicId: string) {
    super(
      `refusing to use topic ${topicId}: it belongs to the pre-existing OracleNet deployment ` +
        `(see docs/SECURITY_BOUNDARIES.md). Create a fresh topic in CP-H7.`,
    );
    this.name = "TopicBoundaryError";
  }
}

export function assertTopicAllowed(topicId: string): void {
  if ((FORBIDDEN_TOPIC_IDS as readonly string[]).includes(topicId)) throw new TopicBoundaryError(topicId);
  if (!/^\d+\.\d+\.\d+$/.test(topicId)) throw new Error(`MALFORMED_TOPIC_ID: ${topicId}`);
}

/**
 * The exact bytes that go into an HCS message.
 *
 * Deliberately tiny: schema tag, digest, receipt id, timestamp, environment.
 * Well under the 1024-byte single-chunk limit, so anchoring never depends on
 * the SDK's chunking behaviour.
 */
export interface AnchorPayload {
  t: "nomos.gx402.anchor.v1";
  /** The receipt's record_digest — the only substantive content. */
  d: string;
  /** Receipt id, so an observer can correlate without holding the receipt. */
  r: string;
  /** Emission time, UTC seconds. */
  ts: string;
  /** Environment tag. Anyone reading the topic sees this is a testnet demo. */
  env: "TESTNET_DEMO_ONLY";
}

export interface AnchorRequest {
  record_digest: string;
  receipt_id: string;
  topic_id: string;
  clock?: Clock;
}

export interface AnchorResult {
  schema: string;
  source: "MOCK_OFFLINE" | "HEDERA_HCS";
  status: "ANCHORED" | "PENDING" | "FAILED";
  network: "hedera:testnet";
  anchored_digest: string;
  topic_id: string | null;
  sequence_number: number | null;
  transaction_id: string | null;
  consensus_timestamp: string | null;
  anchored_at: string | null;
  hashscan_url: string | null;
  mirror_url: string | null;
  failure_code: string | null;
}

export interface AnchorVerification {
  ok: boolean;
  reasons: string[];
  /** The digest actually read back from the topic, when readable. */
  observed_digest?: string | null;
}

export interface HcsAnchor {
  /** Submit `record_digest` to a topic. MUST NOT throw on chain failure — degrade to PENDING. */
  anchorReceiptHash(req: AnchorRequest): Promise<AnchorResult>;
  /** Read the message back and confirm it carries the expected digest. */
  verifyAnchor(anchor: AnchorResult, expectedDigest: string): Promise<AnchorVerification>;
}
