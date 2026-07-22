/**
 * Deterministic identifier construction.
 *
 * Every id in this project is a truncated SHA-256 over a canonical tuple, never
 * a random value. Two consequences that matter:
 *   - the same logical thing always gets the same id, on any machine, which is
 *     what makes idempotency and replay detection possible at all;
 *   - an id can be recomputed by a verifier, so a mismatched id is itself
 *     tamper evidence.
 *
 * Truncation length is 24 hex chars (96 bits) for display ids and 32 (128 bits)
 * for the idempotency key, which is the one an attacker would want to collide.
 */
import { canonicalize, sha256Hex } from "./canonical.ts";

function tag(prefix: string, parts: readonly unknown[], hexLen: number): string {
  return `${prefix}${sha256Hex(canonicalize(parts)).slice(0, hexLen)}`;
}

/** ppd_… — one per policy decision. */
export function decisionId(requestId: string, boundTermsDigest: string, domain: string): string {
  return tag("ppd_", [requestId, boundTermsDigest, domain], 24);
}

/** q_… — one per issued quote. */
export function quoteId(offerId: string, requestHash: string, nonce: string, issuedAt: string): string {
  return tag("q_", [offerId, requestHash, nonce, issuedAt], 24);
}

/**
 * idem_… — the execution key.
 *
 * Bound to quote + request + payer, and to nothing else. Notably NOT bound to
 * the transaction id: the same logical purchase must map to the same key
 * *before* a payment exists, otherwise a retry after a network blip would
 * execute twice.
 */
export function idempotencyKey(quoteIdValue: string, requestHash: string, payerAccountId: string): string {
  return tag("idem_", [quoteIdValue, requestHash, payerAccountId], 32);
}

/** poa_… — one per proof-of-action receipt. */
export function receiptId(idemKey: string, transactionId: string, recordDigest: string): string {
  return tag("poa_", [idemKey, transactionId, recordDigest], 24);
}

/**
 * Replay key for a settled payment.
 *
 * Bound to (network, transaction_id): one on-chain transaction may release
 * work exactly once, no matter how many times it is presented.
 */
export function replayKey(network: string, transactionId: string): string {
  return sha256Hex(canonicalize([network, transactionId])).slice(0, 32);
}
