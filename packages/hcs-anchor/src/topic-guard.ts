/**
 * CP-H7D — Grant A (topic creation) and the mirror-node read-back.
 *
 * Two separate authorizations exist in this project and they must never be
 * collapsed into one:
 *
 *   GRANT A  creates a topic. Irreversible in configuration: without an admin
 *            key the memo and submit key can never be changed, and the topic
 *            cannot be deleted by a regular delete transaction.
 *
 *   GRANT B  publishes one message to a topic that already exists and has been
 *            verified field by field against what Grant A approved.
 *
 * The separation is not ceremony. Grant B names a real topic id, and a real
 * topic id cannot be known before Grant A has been executed and read back. A
 * single combined grant would therefore have to authorize a submit to a topic
 * nobody had inspected — which is precisely the step where a wrong memo or a
 * wrong submit key would become permanent and unnoticed.
 *
 * This module is pure: it parses documents and compares values. It does not read
 * files, reach the network or consult the clock. The caller gathers the
 * evidence, which is what allows every branch below to be tested without a
 * transaction ever existing.
 */
import { NETWORK } from "../../shared-schemas/src/index.ts";
import {
  TOPIC_CONFIG,
  TOPIC_CREATE_MAX_FEE_TINYBAR,
  assertTopicConfig,
  topicConfigDigest,
  type TopicConfig,
} from "./topic-config.ts";

export const TOPIC_CREATE_GRANT_MAGIC = "NOMOS_GX402_CP_H7_TOPIC_CREATE_GRANT_V1";

/** The longest an operator approval may stay valid. */
export const GRANT_MAX_WINDOW_SECONDS = 30 * 60;

export interface TopicCreateGrant {
  grant: typeof TOPIC_CREATE_GRANT_MAGIC;
  network: string;
  payer_account_id: string;
  /** The full configuration the operator read before signing off. */
  topic_config: TopicConfig;
  /** Digest of that configuration. Must reproduce from `topic_config`. */
  topic_config_digest: string;
  max_transaction_fee_tinybar: string;
  /** UTC, second precision. */
  expires_at: string;
}

/**
 * Parse a Grant A document.
 *
 * Returns null rather than throwing, because "no grant" and "not a valid grant"
 * must lead to the same refusal. A caller that distinguishes them ends up with a
 * catch block that treats one as the other.
 */
export function parseTopicCreateGrant(raw: string | null): TopicCreateGrant | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const g = parsed as Partial<TopicCreateGrant>;
  if (g?.grant !== TOPIC_CREATE_GRANT_MAGIC) return null;
  if (typeof g.network !== "string") return null;
  if (typeof g.payer_account_id !== "string" || !/^\d+\.\d+\.\d+$/.test(g.payer_account_id)) return null;
  if (typeof g.topic_config_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(g.topic_config_digest)) return null;
  if (typeof g.max_transaction_fee_tinybar !== "string" || !/^(0|[1-9][0-9]*)$/.test(g.max_transaction_fee_tinybar)) return null;
  if (typeof g.expires_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(g.expires_at)) return null;
  if (!g.topic_config || typeof g.topic_config !== "object") return null;
  return g as TopicCreateGrant;
}

export interface TopicCreateGuardState {
  grant: TopicCreateGrant | null;
  /** Content of `.local/HCS_TOPIC_CREATED`, or null. Presence means a create already happened. */
  createdMarker: string | null;
  /** `NOMOS_GX402_ANCHOR_ENABLED` from configuration. */
  anchorEnabled: boolean;
  /** `NOMOS_GX402_HCS_TOPIC_ID`. Non-empty means a topic is already configured. */
  configuredTopicId: string;
  payerKeyPresent: boolean;
  /**
   * Public key derived from the payer's key file. Compared against the submit
   * key the configuration names — a topic whose submit key we cannot sign for
   * would be permanently unusable.
   */
  derivedPayerPublicKey: string | null;
  /** Existing `CONSENSUSCREATETOPIC` transactions found for the payer, or null if the lookup failed. */
  existingTopicCreates: number | null;
  nowMs: number;
}

export interface TopicCreateGuardVerdict {
  allowed: boolean;
  blockers: string[];
  notes: string[];
}

/**
 * Decide whether a topic creation may proceed.
 *
 * Every blocker is collected rather than returning at the first. An operator who
 * clears conditions one at a time, discovering each only after the last, ends up
 * granting an authorization for reasons nobody can reconstruct afterwards.
 */
export function evaluateTopicCreateGuard(state: TopicCreateGuardState): TopicCreateGuardVerdict {
  const blockers: string[] = [];
  const notes: string[] = [];

  if (!state.anchorEnabled) blockers.push("ANCHOR_DISABLED:NOMOS_GX402_ANCHOR_ENABLED is not true");

  // ── the configuration itself must still be valid ──────────────────────────
  try {
    assertTopicConfig(TOPIC_CONFIG);
  } catch (err) {
    blockers.push(`CONFIG_INVALID:${err instanceof Error ? err.message : String(err)}`);
  }

  // ── duplicate creation, three independent ways ────────────────────────────
  if (state.createdMarker !== null) {
    blockers.push("ALREADY_CREATED:.local/HCS_TOPIC_CREATED exists — a topic was already created");
  }
  if (state.configuredTopicId) {
    blockers.push(`TOPIC_ALREADY_CONFIGURED:${state.configuredTopicId} — creating a second one is not the fix`);
  }
  if (state.existingTopicCreates === null) {
    // An unanswered question about the ledger is not a "no".
    blockers.push("LEDGER_STATE_UNKNOWN:could not list existing topic creations — refusing while unclear");
  } else if (state.existingTopicCreates > 0) {
    blockers.push(`TOPIC_EXISTS_ON_LEDGER:${state.existingTopicCreates} CONSENSUSCREATETOPIC already on the payer`);
  }

  // ── credentials, and the key that would be locked in ──────────────────────
  if (!state.payerKeyPresent) blockers.push("NO_CREDENTIALS:payer key file is absent");
  if (!state.derivedPayerPublicKey) {
    blockers.push("SUBMIT_KEY_UNVERIFIED:could not derive the payer public key");
  } else if (state.derivedPayerPublicKey.toLowerCase() !== TOPIC_CONFIG.submit_key.public_key.toLowerCase()) {
    blockers.push("SUBMIT_KEY_MISMATCH:the payer key does not derive the configured submit key");
  } else {
    notes.push("submit key verified against the payer's own key — the topic will be writable by us");
  }

  // ── the grant ─────────────────────────────────────────────────────────────
  const grant = state.grant;
  if (!grant) {
    blockers.push("NO_GRANT_A:.local/HCS_TOPIC_CREATE_AUTHORIZED is absent or not a valid grant document");
    return { allowed: false, blockers, notes };
  }

  if (grant.network !== NETWORK) blockers.push(`GRANT_NETWORK_MISMATCH:${grant.network}`);
  if (grant.payer_account_id !== TOPIC_CONFIG.payer_account_id) {
    blockers.push(`GRANT_PAYER_MISMATCH:${grant.payer_account_id}`);
  }

  // The grant embeds a configuration AND its digest. Both are checked, against
  // each other and against ours: the first catches a hand-edited grant, the
  // second catches a grant that approved a different configuration entirely.
  let embeddedDigest: string | null = null;
  try {
    assertTopicConfig(grant.topic_config);
    embeddedDigest = topicConfigDigest(grant.topic_config);
  } catch (err) {
    blockers.push(`GRANT_CONFIG_INVALID:${err instanceof Error ? err.message : String(err)}`);
  }
  if (embeddedDigest && embeddedDigest !== grant.topic_config_digest) {
    blockers.push("GRANT_DIGEST_NOT_REPRODUCIBLE:the embedded config does not hash to the stated digest");
  }
  if (grant.topic_config_digest !== topicConfigDigest(TOPIC_CONFIG)) {
    blockers.push("GRANT_CONFIG_DIGEST_MISMATCH:the grant approves a different configuration than the one in source");
  }

  // ── fee ceiling ───────────────────────────────────────────────────────────
  try {
    if (BigInt(grant.max_transaction_fee_tinybar) > BigInt(TOPIC_CREATE_MAX_FEE_TINYBAR)) {
      blockers.push(
        `GRANT_FEE_CAP_EXCEEDED:grant allows ${grant.max_transaction_fee_tinybar}, ceiling is ${TOPIC_CREATE_MAX_FEE_TINYBAR}`,
      );
    }
    if (BigInt(grant.max_transaction_fee_tinybar) !== BigInt(TOPIC_CONFIG.max_transaction_fee_tinybar)) {
      blockers.push("GRANT_FEE_CAP_MISMATCH:grant and configuration disagree on the fee ceiling");
    }
  } catch {
    blockers.push("GRANT_FEE_CAP_MALFORMED");
  }

  // ── expiry ────────────────────────────────────────────────────────────────
  const expiry = Date.parse(grant.expires_at);
  if (!Number.isFinite(expiry)) {
    blockers.push("GRANT_EXPIRY_UNPARSABLE");
  } else if (expiry <= state.nowMs) {
    blockers.push(`GRANT_EXPIRED:${grant.expires_at}`);
  } else if (expiry - state.nowMs > GRANT_MAX_WINDOW_SECONDS * 1000) {
    // A long window is a standing authorization wearing a timestamp.
    blockers.push(
      `GRANT_WINDOW_TOO_LONG:${Math.round((expiry - state.nowMs) / 1000)}s remaining, maximum is ${GRANT_MAX_WINDOW_SECONDS}s`,
    );
  }

  return { allowed: blockers.length === 0, blockers, notes };
}

// ── mirror-node read-back ───────────────────────────────────────────────────

/** A topic as a mirror node reports it. */
export interface ObservedTopic {
  topic_id?: unknown;
  memo?: unknown;
  admin_key?: unknown;
  submit_key?: unknown;
  auto_renew_account?: unknown;
  auto_renew_period?: unknown;
  deleted?: unknown;
}

export interface TopicReadbackVerdict {
  ok: boolean;
  reasons: string[];
  /** Field-by-field comparison, for printing. */
  checked: Array<{ field: string; expected: string; observed: string; ok: boolean }>;
}

/**
 * Confirm that the topic the ledger actually holds is the topic that was
 * approved.
 *
 * This is the step that makes Grant B possible. Until it passes, no topic id may
 * leave this system as something to authorize a submit against: the whole risk
 * of an immutable topic is that a wrong field becomes permanent, and the only
 * moment to catch it is between creating the topic and using it.
 *
 * `transactionSucceeded` is a separate argument rather than something inferred
 * from the topic existing, because a topic that exists proves a transaction
 * reached consensus but not that it was ours.
 */
export function verifyTopicReadback(
  observed: ObservedTopic | null,
  topicId: string,
  transactionSucceeded: boolean,
  cfg: TopicConfig = TOPIC_CONFIG,
): TopicReadbackVerdict {
  const reasons: string[] = [];
  const checked: TopicReadbackVerdict["checked"] = [];

  if (!observed) {
    return { ok: false, reasons: ["topic_not_found_on_mirror"], checked };
  }

  const compare = (field: string, expected: string, observedValue: string): void => {
    const ok = expected === observedValue;
    checked.push({ field, expected, observed: observedValue, ok });
    if (!ok) reasons.push(`${field}_mismatch`);
  };

  compare("topic_id", topicId, String(observed.topic_id ?? ""));
  compare("memo", cfg.memo, String(observed.memo ?? ""));

  // Admin key: the mirror node reports an unset key as null, or as a key object
  // whose `key` is empty. Both readings are treated as "absent"; anything with
  // actual key material is a hard failure, because it means the topic is
  // mutable by someone.
  const adminKeyMaterial = extractKey(observed.admin_key);
  const adminAbsent = adminKeyMaterial === null || adminKeyMaterial === "";
  checked.push({
    field: "admin_key",
    expected: "<absent>",
    observed: adminAbsent ? "<absent>" : adminKeyMaterial,
    ok: adminAbsent,
  });
  if (!adminAbsent) reasons.push("admin_key_present");

  const submitKeyMaterial = extractKey(observed.submit_key);
  compare("submit_key", cfg.submit_key.public_key.toLowerCase(), (submitKeyMaterial ?? "").toLowerCase());

  compare("auto_renew_account", cfg.auto_renew_account_id, String(observed.auto_renew_account ?? ""));
  compare("auto_renew_period", String(cfg.auto_renew_period_seconds), String(observed.auto_renew_period ?? ""));

  if (observed.deleted === true) {
    checked.push({ field: "deleted", expected: "false", observed: "true", ok: false });
    reasons.push("topic_deleted");
  }

  if (!transactionSucceeded) reasons.push("create_transaction_not_successful");

  return { ok: reasons.length === 0, reasons, checked };
}

/** Mirror nodes wrap keys as `{_type, key}`. Returns the raw hex, or null when unset. */
function extractKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const k = (value as { key?: unknown }).key;
    return typeof k === "string" ? k : null;
  }
  return null;
}
