/**
 * CP-H8 — resolving the HCS anchor for the demo page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THE ANCHOR IS NOT IN THE RECEIPT, AND THAT IS THE POINT.
 *
 *  `poa_60a1c2220acb7ef835dcdca8` is signed over its canonical bytes. Writing an
 *  anchor field into it would change those bytes and break the signature it
 *  exists to carry, so the receipt keeps `anchor: null` forever and the anchor
 *  lives beside it in `docs/evidence/cp-h7/anchor-evidence.json`, bound by
 *  `receipt_id` and `record_digest`.
 *
 *  The demo previously conflated those two facts. `app.js` refused to render at
 *  all unless `receipt.anchor === null`, and the model asserted the same thing
 *  with the comment "CP-H8 may only present HCS as pending". Both read an
 *  *absent field in a signed document* as *no anchor exists*. After CP-H7F that
 *  reading is simply wrong: the digest is on the ledger and the receipt is
 *  unchanged, which is the intended end state rather than a contradiction.
 *
 *  `receipt.anchor === null` is still asserted — but now as evidence that the
 *  signed artifact was left alone, not as a reason to hide the anchor.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module reads nothing and fetches nothing. It takes two documents and
 * returns a verdict, so every branch below is reachable from a test without a
 * network, a ledger or a browser.
 */
import { createHash } from "node:crypto";

import { canonicalDigest } from "../../../packages/shared-schemas/src/canonical.ts";
import {
  anchorEnvelopeBytes,
  anchorKey,
  buildAnchorEnvelope,
} from "../../../packages/hcs-anchor/src/anchor-envelope.ts";

/**
 * What this demonstration anchors, pinned.
 *
 * Hardcoded deliberately. The page presents one specific settled payment and
 * one specific anchor; a model that accepted whatever topic and sequence it was
 * handed could be pointed at a different anchor and would still render a green
 * tick. Pinning turns "some anchor exists" into "this anchor exists".
 */
export const EXPECTED_ANCHOR = {
  network: "hedera:testnet",
  topic_id: "0.0.9703011",
  sequence_number: 1,
  transaction_id: "0.0.9689846@1784818787.803110569",
  receipt_id: "poa_60a1c2220acb7ef835dcdca8",
} as const;

export const HASHSCAN_TOPIC_URL = `https://hashscan.io/testnet/topic/${EXPECTED_ANCHOR.topic_id}`;
export const MIRROR_MESSAGE_URL =
  `https://testnet.mirrornode.hedera.com/api/v1/topics/${EXPECTED_ANCHOR.topic_id}` +
  `/messages/${EXPECTED_ANCHOR.sequence_number}`;

/**
 * The four states the page may show. They are kept distinct because collapsing
 * any two of them tells the reader something untrue:
 *
 *   CONFIRMED_ON_TESTNET          the digest reached consensus, verified offline
 *   NOT_YET_ANCHORED              evidence exists and states no submission was made
 *   ANCHOR_EVIDENCE_NOT_AVAILABLE no evidence document could be read at all
 *   ANCHOR_EVIDENCE_INVALID       evidence exists and does not hold up
 *   LIVE_VERIFICATION_UNAVAILABLE a live re-check could not be performed
 *
 * The last two are statements about this bundle and about the network. Neither
 * is a statement about the ledger. A failed fetch must not read as "not
 * anchored" (which would be false) or as "invalid" (which would be an
 * accusation) — and neither must a missing file.
 *
 * NOT_YET_ANCHORED used to be the verdict for a missing evidence file. That was
 * the same conflation, one layer down: it answered "is this digest on a topic?"
 * with the result of "did this build ship a JSON file?". Before CP-H7F the two
 * happened to coincide, so the error was invisible. After CP-H7F the digest is
 * on topic 0.0.9703011 whether or not the file is packaged, and a dropped
 * artifact would have made the page assert the opposite of the ledger.
 * NOT_YET_ANCHORED is now reserved for a pre-submit state a document actually
 * attests to; absence resolves to ANCHOR_EVIDENCE_NOT_AVAILABLE, which claims
 * nothing about the chain.
 */
export type AnchorState =
  | "CONFIRMED_ON_TESTNET"
  | "NOT_YET_ANCHORED"
  | "ANCHOR_EVIDENCE_NOT_AVAILABLE"
  | "ANCHOR_EVIDENCE_INVALID"
  | "LIVE_VERIFICATION_UNAVAILABLE";

export const ANCHOR_LABELS: Record<AnchorState, string> = {
  CONFIRMED_ON_TESTNET: "CONFIRMED ON HEDERA TESTNET",
  NOT_YET_ANCHORED: "NOT YET ANCHORED",
  ANCHOR_EVIDENCE_NOT_AVAILABLE: "ANCHOR EVIDENCE NOT AVAILABLE",
  ANCHOR_EVIDENCE_INVALID: "ANCHOR EVIDENCE INVALID",
  LIVE_VERIFICATION_UNAVAILABLE: "LIVE VERIFICATION UNAVAILABLE",
};

/**
 * Statuses that positively assert nothing was submitted yet. A document with
 * one of these AND no transaction id is the only way to reach
 * NOT_YET_ANCHORED. A pending document that DOES carry a transaction id was
 * submitted and is simply unconfirmed — that falls through to the checks below
 * and fails closed, rather than being reported as never attempted.
 */
const PRE_SUBMIT_STATUSES = new Set(["NOT_SUBMITTED", "PENDING", "PREPARED"]);

export interface AnchorPresentation {
  readonly state: AnchorState;
  readonly label: string;
  /** Machine-readable failures. Empty when confirmed. */
  readonly reasons: readonly string[];
  /** Which of the fail-closed checks ran and how each came out. */
  readonly checks: readonly { readonly id: string; readonly ok: boolean }[];
  readonly network: string | null;
  readonly topic_id: string | null;
  readonly sequence_number: number | null;
  readonly transaction_id: string | null;
  readonly transaction_id_short: string | null;
  readonly consensus_timestamp: string | null;
  readonly consensus_utc: string | null;
  readonly record_digest: string | null;
  readonly record_digest_short: string | null;
  readonly envelope_sha256: string | null;
  readonly envelope_sha256_short: string | null;
  readonly envelope_bytes: number | null;
  readonly anchor_key: string | null;
  readonly running_hash_version: number | null;
  readonly charged_fee_display: string | null;
  /** The exact bytes on the topic, so a browser can compare a live read without a canonicalizer. */
  readonly envelope_canonical: string | null;
  readonly hashscan_url: string;
  readonly mirror_url: string;
  readonly mirror_verified: boolean;
  readonly receipt_unmodified: boolean;
  readonly testnet_notice: string;
}

const TESTNET_NOTICE = "Testnet demonstration — not a mainnet production attestation";

function short(value: string | null, head = 10, tail = 6): string | null {
  if (!value) return null;
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** `1784818806.041876104` → `2026-07-23T14:59:26Z`. Seconds only; nanos are not clock precision. */
export function consensusToUtc(consensus: string | null): string | null {
  if (!consensus || !/^\d+\.\d+$/.test(consensus)) return null;
  const seconds = Number(consensus.split(".")[0]);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function tinybarToHbar(tinybar: string | null): string | null {
  if (!tinybar || !/^(0|[1-9][0-9]*)$/.test(tinybar)) return null;
  return `${(Number(tinybar) / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} HBAR`;
}

function empty(state: AnchorState, reasons: string[], checks: { id: string; ok: boolean }[]): AnchorPresentation {
  return {
    state,
    label: ANCHOR_LABELS[state],
    reasons,
    checks,
    network: null,
    topic_id: null,
    sequence_number: null,
    transaction_id: null,
    transaction_id_short: null,
    consensus_timestamp: null,
    consensus_utc: null,
    record_digest: null,
    record_digest_short: null,
    envelope_sha256: null,
    envelope_sha256_short: null,
    envelope_bytes: null,
    anchor_key: null,
    running_hash_version: null,
    charged_fee_display: null,
    envelope_canonical: null,
    hashscan_url: HASHSCAN_TOPIC_URL,
    mirror_url: MIRROR_MESSAGE_URL,
    mirror_verified: false,
    receipt_unmodified: false,
    testnet_notice: TESTNET_NOTICE,
  };
}

/**
 * Decide what the page may say about the anchor.
 *
 * Thirteen checks, all of which must hold. They are collected rather than
 * short-circuited: an operator looking at a broken anchor wants the whole list,
 * and the second failure is usually the one that explains the first.
 */
export function resolveAnchorState(
  receipt: Record<string, unknown> | null,
  evidence: Record<string, unknown> | null,
): AnchorPresentation {
  if (!evidence) {
    // Not a failure, and — since CP-H7F — not a statement about the ledger
    // either. All this says is that this bundle carries no anchor document.
    return empty("ANCHOR_EVIDENCE_NOT_AVAILABLE", ["anchor_evidence_missing"], []);
  }
  if (!receipt) {
    return empty("ANCHOR_EVIDENCE_INVALID", ["receipt_missing"], []);
  }
  if (
    typeof evidence.status === "string" &&
    PRE_SUBMIT_STATUSES.has(evidence.status) &&
    !evidence.transaction_id
  ) {
    // The one case that may claim the chain holds nothing: a document that
    // says so itself, and has no transaction to contradict it.
    return empty("NOT_YET_ANCHORED", [], []);
  }

  const reasons: string[] = [];
  const checks: { id: string; ok: boolean }[] = [];
  const check = (id: string, ok: boolean): boolean => {
    checks.push({ id, ok });
    if (!ok) reasons.push(id);
    return ok;
  };

  const env = (evidence.envelope ?? null) as Record<string, unknown> | null;
  const record = (receipt.record ?? null) as Record<string, unknown> | null;

  // 1. the evidence itself must claim confirmation
  check("status_confirmed", evidence.status === "CONFIRMED");

  // 2–3. it must be about this receipt
  check("receipt_id_matches", env?.receipt_id === receipt.receipt_id && env?.receipt_id === EXPECTED_ANCHOR.receipt_id);
  check("record_digest_matches", env?.record_digest === receipt.record_digest);

  // 4. and the receipt must still hash to what was anchored — the strongest
  //    check here, because it re-derives rather than compares stored strings
  let reproducible = false;
  if (record) {
    try {
      reproducible = canonicalDigest(record) === receipt.record_digest && receipt.record_digest === env?.record_digest;
    } catch {
      reproducible = false;
    }
  }
  check("receipt_digest_reproducible", reproducible);

  // 5–8. the ledger coordinates must be the pinned ones
  check("topic_id_matches", evidence.topic_id === EXPECTED_ANCHOR.topic_id);
  check("sequence_number_matches", evidence.sequence_number === EXPECTED_ANCHOR.sequence_number);
  check("transaction_id_matches", evidence.transaction_id === EXPECTED_ANCHOR.transaction_id);
  check(
    "consensus_timestamp_present",
    typeof evidence.consensus_timestamp === "string" && /^\d+\.\d+$/.test(evidence.consensus_timestamp),
  );

  // 9–11. the message must be rebuildable from the receipt, byte for byte
  let rebuiltSha: string | null = null;
  let rebuiltBytes: number | null = null;
  let canonical: string | null = null;
  const createdAt = typeof env?.created_at === "string" ? env.created_at : null;
  if (createdAt) {
    try {
      const rebuilt = buildAnchorEnvelope(receipt as never, Date.parse(createdAt));
      const bytes = anchorEnvelopeBytes(rebuilt);
      rebuiltBytes = bytes.length;
      canonical = bytes.toString("utf8");
      rebuiltSha = canonicalDigestOfBytes(bytes);
    } catch {
      rebuiltSha = null;
    }
  }
  check("envelope_sha256_matches", rebuiltSha !== null && evidence.envelope_digest === rebuiltSha);
  check("envelope_bytes_match", rebuiltBytes !== null && evidence.envelope_bytes === rebuiltBytes);

  let derivedKey: string | null = null;
  if (typeof env?.receipt_id === "string" && typeof env?.record_digest === "string") {
    derivedKey = anchorKey(EXPECTED_ANCHOR.network, env.receipt_id, env.record_digest);
  }
  check("anchor_key_reproducible", derivedKey !== null && evidence.anchor_key === derivedKey);

  // 12. network, pinned by const in every schema and re-asserted here
  check("network_is_testnet", evidence.network === EXPECTED_ANCHOR.network && env?.network === EXPECTED_ANCHOR.network);

  // 13. someone other than the submitting tool must have looked
  const iv = (evidence.independent_verification ?? null) as Record<string, unknown> | null;
  const mirrorVerified = iv?.byte_exact_match === true && iv?.result === "ALL_PASS";
  check("independent_mirror_verified", mirrorVerified);

  // Not one of the thirteen, but worth showing: the signed receipt was not
  // edited to carry the anchor. A demo that anchored by rewriting the artifact
  // would have proved the opposite of what it claims.
  const receiptUnmodified = receipt.anchor === null;
  check("receipt_left_unmodified", receiptUnmodified);

  if (reasons.length > 0) {
    const failed = empty("ANCHOR_EVIDENCE_INVALID", reasons, checks);
    return { ...failed, receipt_unmodified: receiptUnmodified };
  }

  const consensus = String(evidence.consensus_timestamp);
  const fee = typeof evidence.charged_tx_fee_tinybar === "string" ? evidence.charged_tx_fee_tinybar : null;

  return {
    state: "CONFIRMED_ON_TESTNET",
    label: ANCHOR_LABELS.CONFIRMED_ON_TESTNET,
    reasons: [],
    checks,
    network: EXPECTED_ANCHOR.network,
    topic_id: EXPECTED_ANCHOR.topic_id,
    sequence_number: EXPECTED_ANCHOR.sequence_number,
    transaction_id: EXPECTED_ANCHOR.transaction_id,
    transaction_id_short: short(EXPECTED_ANCHOR.transaction_id, 14, 8),
    consensus_timestamp: consensus,
    consensus_utc: consensusToUtc(consensus),
    record_digest: String(env?.record_digest),
    record_digest_short: short(String(env?.record_digest), 14, 8),
    envelope_sha256: String(evidence.envelope_digest),
    envelope_sha256_short: short(String(evidence.envelope_digest), 14, 8),
    envelope_bytes: Number(evidence.envelope_bytes),
    anchor_key: String(evidence.anchor_key),
    running_hash_version:
      typeof evidence.running_hash_version === "number" ? evidence.running_hash_version : null,
    charged_fee_display: tinybarToHbar(fee),
    envelope_canonical: canonical,
    hashscan_url: HASHSCAN_TOPIC_URL,
    mirror_url: MIRROR_MESSAGE_URL,
    mirror_verified: true,
    receipt_unmodified: true,
    testnet_notice: TESTNET_NOTICE,
  };
}

/** Same shape as `canonicalDigest`, but over bytes that are already canonical. */
function canonicalDigestOfBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The live re-check, as a pure function
// ─────────────────────────────────────────────────────────────────────────────

export type LiveOutcome =
  | { kind: "fetched"; messageBase64: string }
  | { kind: "network_error"; detail?: string }
  | { kind: "http_error"; status: number };

export interface LiveVerdict {
  readonly state: "CONFIRMED_ON_TESTNET" | "ANCHOR_EVIDENCE_INVALID" | "LIVE_VERIFICATION_UNAVAILABLE";
  readonly label: string;
  readonly detail: string;
}

/**
 * Classify a live mirror-node read.
 *
 * The rule this function exists to enforce: an unreachable network is never
 * evidence about the anchor. A page served from `file://` cannot reach a mirror
 * node at all, and that must read as "could not check", not as "not anchored"
 * and not as "invalid".
 */
export function classifyLiveCheck(outcome: LiveOutcome, expectedCanonical: string | null): LiveVerdict {
  if (outcome.kind === "network_error" || outcome.kind === "http_error") {
    const why = outcome.kind === "http_error" ? `mirror node returned HTTP ${outcome.status}` : "the mirror node could not be reached";
    return {
      state: "LIVE_VERIFICATION_UNAVAILABLE",
      label: ANCHOR_LABELS.LIVE_VERIFICATION_UNAVAILABLE,
      detail:
        `${why}. This says nothing about the anchor: the recorded verification above was ` +
        `performed offline against committed evidence and is unaffected.`,
    };
  }

  if (!expectedCanonical) {
    return {
      state: "LIVE_VERIFICATION_UNAVAILABLE",
      label: ANCHOR_LABELS.LIVE_VERIFICATION_UNAVAILABLE,
      detail: "no expected message is available to compare against.",
    };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(outcome.messageBase64, "base64").toString("utf8");
  } catch {
    return {
      state: "LIVE_VERIFICATION_UNAVAILABLE",
      label: ANCHOR_LABELS.LIVE_VERIFICATION_UNAVAILABLE,
      detail: "the mirror node returned a message that could not be decoded.",
    };
  }

  if (decoded !== expectedCanonical) {
    // Reachable, answered, and disagreed. That is a real finding.
    return {
      state: "ANCHOR_EVIDENCE_INVALID",
      label: ANCHOR_LABELS.ANCHOR_EVIDENCE_INVALID,
      detail: "the message on the topic differs from the recorded envelope, byte for byte.",
    };
  }

  return {
    state: "CONFIRMED_ON_TESTNET",
    label: ANCHOR_LABELS.CONFIRMED_ON_TESTNET,
    detail: `the message on the topic matches the recorded envelope exactly (${expectedCanonical.length} bytes).`,
  };
}
