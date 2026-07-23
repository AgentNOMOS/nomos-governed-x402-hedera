/**
 * The gate every CP-H7 transaction has to pass.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A GRANT IS A DOCUMENT, NOT A FILE THAT EXISTS.
 *
 *  A sibling system in this codebase's lineage gated a paid endpoint on
 *  `os.path.exists("preflight.allow")`. The file was deleted by an unrelated
 *  rollback, and because existence was the entire authorization language, there
 *  was no way to reissue it with a scope or an expiry — the service could only
 *  be switched fully on or left fully off. Recovery failed closed twice.
 *
 *  So the grant here is parsed, not sensed. It names the topic it authorizes,
 *  the receipt it authorizes, how many transactions it covers and when it
 *  expires, and every one of those is checked against what is actually about to
 *  happen. A grant for a different topic authorizes nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The guard is pure: it takes a state description and returns a verdict. It does
 * not read files, touch the clock or reach the network — the caller gathers that
 * evidence, which is what lets every branch below be tested without one.
 */
import { NETWORK } from "../../shared-schemas/src/index.ts";
import { FORBIDDEN_TOPIC_IDS } from "./interfaces.ts";

/** What an operator signs off on. Parsed from `.local/HCS_ANCHOR_AUTHORIZED`. */
export interface AnchorGrant {
  /** Must equal the string below, so an unrelated file cannot be read as a grant. */
  grant: "NOMOS_GX402_CP_H7_ANCHOR_GRANT_V1";
  /** The one topic this grant covers. `"CREATE"` authorizes creating a new topic first. */
  topic_id: string | "CREATE";
  /** The one receipt this grant covers. */
  receipt_id: string;
  /** Digest of that receipt's record. Belt and braces against a swapped receipt file. */
  record_digest: string;
  /** How many chain transactions the grant covers in total (topic create counts as one). */
  max_transactions: number;
  /** UTC expiry. A grant without one would be a permanent standing authorization. */
  expires_at: string;
  network: string;
}

export interface AnchorGuardState {
  /** Parsed grant, or null when the file is absent or unparsable. */
  grant: AnchorGrant | null;
  /** Content of `.local/HCS_ANCHOR_EXECUTED`, or null. Presence means a submit already happened. */
  executedMarker: string | null;
  /** `NOMOS_GX402_ANCHOR_ENABLED` from configuration. */
  anchorEnabled: boolean;
  /** `NOMOS_GX402_HCS_TOPIC_ID`, empty when unset. */
  configuredTopicId: string;
  /** Whether the payer key file is present. Contents are never read by the guard. */
  payerKeyPresent: boolean;
  network: string;
  receiptId: string;
  recordDigest: string;
  /** Transactions this run intends to submit. */
  plannedTransactions: number;
  /** A duplicate found on the topic itself, when the topic was scanned. */
  duplicateOnTopic: boolean;
  /** Whether the topic was scanned at all. Not scanning is itself a blocker. */
  topicScanned: boolean;
  nowMs: number;
}

export interface AnchorGuardVerdict {
  allowed: boolean;
  /** Machine-readable blockers, most fundamental first. */
  blockers: string[];
  /** Non-blocking observations worth printing. */
  notes: string[];
}

export const GRANT_MAGIC = "NOMOS_GX402_CP_H7_ANCHOR_GRANT_V1";

/**
 * Parse a grant document. Returns null rather than throwing, because "no valid
 * grant" and "no grant at all" must lead to the same refusal — a caller that
 * distinguishes them invites a catch block that treats one as the other.
 */
export function parseAnchorGrant(raw: string | null): AnchorGrant | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const g = parsed as Partial<AnchorGrant>;
  if (g?.grant !== GRANT_MAGIC) return null;
  if (typeof g.topic_id !== "string" || g.topic_id.length === 0) return null;
  if (typeof g.receipt_id !== "string" || !/^poa_[0-9a-f]{24}$/.test(g.receipt_id)) return null;
  if (typeof g.record_digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(g.record_digest)) return null;
  if (typeof g.max_transactions !== "number" || !Number.isInteger(g.max_transactions) || g.max_transactions < 1) return null;
  if (typeof g.expires_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(g.expires_at)) return null;
  if (typeof g.network !== "string") return null;
  return g as AnchorGrant;
}

/**
 * Decide whether a submit may proceed.
 *
 * Collects every blocker instead of returning at the first: an operator fixing
 * one condition at a time, discovering the next only after the previous is
 * cleared, is how an authorization gets worn down until it is granted for
 * reasons nobody remembers.
 */
export function evaluateAnchorGuard(state: AnchorGuardState): AnchorGuardVerdict {
  const blockers: string[] = [];
  const notes: string[] = [];

  if (state.network !== NETWORK) blockers.push(`NETWORK_NOT_TESTNET:${state.network}`);

  if (!state.anchorEnabled) blockers.push("ANCHOR_DISABLED:NOMOS_GX402_ANCHOR_ENABLED is not true");

  if (state.executedMarker !== null) {
    blockers.push("ALREADY_EXECUTED:.local/HCS_ANCHOR_EXECUTED exists — this receipt's anchor budget is spent");
  }

  const grant = state.grant;
  if (!grant) {
    blockers.push("NO_GRANT:.local/HCS_ANCHOR_AUTHORIZED is absent or not a valid grant document");
  } else {
    if (grant.network !== state.network) blockers.push(`GRANT_NETWORK_MISMATCH:${grant.network}`);
    if (grant.receipt_id !== state.receiptId) blockers.push(`GRANT_RECEIPT_MISMATCH:${grant.receipt_id}`);
    if (grant.record_digest !== state.recordDigest) blockers.push("GRANT_DIGEST_MISMATCH");
    if (grant.max_transactions < state.plannedTransactions) {
      blockers.push(`GRANT_TX_BUDGET_EXCEEDED:covers ${grant.max_transactions}, run plans ${state.plannedTransactions}`);
    }
    const expiry = Date.parse(grant.expires_at);
    if (!Number.isFinite(expiry)) blockers.push("GRANT_EXPIRY_UNPARSABLE");
    else if (expiry <= state.nowMs) blockers.push(`GRANT_EXPIRED:${grant.expires_at}`);

    // The grant names the topic. Configuration must agree, or the operator
    // approved one thing and the machine is about to do another.
    if (grant.topic_id === "CREATE") {
      if (state.configuredTopicId) {
        blockers.push(`GRANT_SAYS_CREATE_BUT_TOPIC_CONFIGURED:${state.configuredTopicId}`);
      } else {
        notes.push("grant authorizes creating a fresh topic");
      }
    } else {
      if (!state.configuredTopicId) blockers.push("TOPIC_NOT_CONFIGURED:NOMOS_GX402_HCS_TOPIC_ID is empty");
      else if (state.configuredTopicId !== grant.topic_id) {
        blockers.push(`GRANT_TOPIC_MISMATCH:grant ${grant.topic_id}, config ${state.configuredTopicId}`);
      }
    }
  }

  const topic = state.configuredTopicId;
  if (topic) {
    if ((FORBIDDEN_TOPIC_IDS as readonly string[]).includes(topic)) blockers.push(`TOPIC_FORBIDDEN:${topic}`);
    else if (!/^\d+\.\d+\.\d+$/.test(topic)) blockers.push(`TOPIC_MALFORMED:${topic}`);
  }

  if (!state.payerKeyPresent) blockers.push("NO_CREDENTIALS:payer key file is absent");

  // A topic we never looked at might already carry this anchor. Refusing to
  // proceed on an unscanned topic is the difference between idempotent and
  // lucky.
  if (state.duplicateOnTopic) blockers.push("DUPLICATE_ON_TOPIC:this receipt is already anchored there");
  else if (!state.topicScanned && state.configuredTopicId) blockers.push("TOPIC_NOT_SCANNED:duplicate check did not run");

  return { allowed: blockers.length === 0, blockers, notes };
}
