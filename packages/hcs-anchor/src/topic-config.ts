/**
 * CP-H7D — the frozen topic configuration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  NOTHING HERE TOUCHES THE NETWORK. This module describes a topic; it cannot
 *  create one.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The operator decided every field below. They are literals in source, not
 * defaults, not environment lookups, and not SDK fallbacks — because a topic
 * created without an admin key cannot be reconfigured afterwards, so a value
 * that arrived by default would be a value nobody chose, permanently.
 *
 * `topicConfigDigest()` is what an authorization binds to. A grant that names a
 * digest authorizes exactly one configuration: change the memo by one character,
 * the auto-renew period by one second, or the submit key at all, and the digest
 * moves and the grant stops applying. That is the whole point of hashing the
 * configuration rather than restating its fields in the grant.
 *
 * ── On permanence, stated precisely ─────────────────────────────────────────
 *
 * Without an admin key:
 *   - the memo, the submit key and the rest of the configuration CANNOT be
 *     changed, by anyone, including us;
 *   - the topic CANNOT be removed by a regular `TopicDeleteTransaction`.
 *
 * What does NOT follow, and must not be written anywhere:
 *   - that the topic "exists forever". Expiration and auto-renew remain
 *     independent ledger properties. A topic whose auto-renew account cannot
 *     pay the renewal fee can expire, and expired entities are subject to the
 *     network's own lifecycle rules.
 *   - that consensus history is guaranteed to remain retrievable. Reaching
 *     consensus is a fact about a moment. Mirror nodes are operated by third
 *     parties under their own retention policies; their availability is not a
 *     property the topic configuration can confer.
 *
 * The honest claim is narrow and still worth having: at a consensus timestamp,
 * these bytes were accepted by the network, and the configuration under which
 * they were accepted cannot be rewritten later to say something else.
 */
import { canonicalDigest, canonicalize, NETWORK } from "../../shared-schemas/src/index.ts";

/** Hedera's hard limit on a topic memo. */
export const TOPIC_MEMO_MAX_BYTES = 100;

/**
 * Hedera's permitted auto-renew window, in seconds. 8000001 is the ceiling —
 * chosen deliberately so the topic goes as long as the network allows between
 * renewals.
 */
export const AUTO_RENEW_PERIOD_MIN_SECONDS = 6_999_999;
export const AUTO_RENEW_PERIOD_MAX_SECONDS = 8_000_001;

/** Fee ceilings, in tinybar. Decimal strings, never numbers — the money rule. */
export const TOPIC_CREATE_MAX_FEE_TINYBAR = "50000000"; // 0.50 HBAR
export const MESSAGE_SUBMIT_MAX_FEE_TINYBAR = "2000000"; // 0.02 HBAR

export interface TopicSubmitKey {
  type: "ECDSA_SECP256K1";
  /** Compressed secp256k1 public key, 33 bytes as 66 lowercase hex characters. */
  public_key: string;
}

export interface TopicConfig {
  schema: "nomos.gx402.hcs_topic_config.v1";
  network: typeof NETWORK;
  payer_account_id: string;
  memo: string;
  memo_bytes: number;
  /** Explicitly null. The absence of an admin key is a decision, so it is recorded as one. */
  admin_key: null;
  submit_key: TopicSubmitKey;
  auto_renew_account_id: string;
  auto_renew_period_seconds: number;
  max_transaction_fee_tinybar: string;
}

/**
 * The one configuration this project will create.
 *
 * Frozen so that no code path can mutate it between the digest being computed
 * and the transaction being built.
 */
export const TOPIC_CONFIG: TopicConfig = Object.freeze({
  schema: "nomos.gx402.hcs_topic_config.v1",
  network: NETWORK,
  payer_account_id: "0.0.9689846",
  memo: "NOMOS CP-H7 PoA anchor v2 | TESTNET_DEMO_ONLY | poa_60a1c2220acb7ef835dcdca8",
  memo_bytes: 76,
  admin_key: null,
  submit_key: Object.freeze({
    type: "ECDSA_SECP256K1",
    // The account's existing key. No new key is generated for this project;
    // one fewer secret to hold is one fewer secret to lose.
    public_key: "025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17",
  }),
  auto_renew_account_id: "0.0.9689846",
  auto_renew_period_seconds: 8_000_001,
  max_transaction_fee_tinybar: TOPIC_CREATE_MAX_FEE_TINYBAR,
}) as TopicConfig;

export class TopicConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "TopicConfigError";
    this.code = code;
  }
}

/**
 * Validate a configuration against every rule the operator fixed.
 *
 * Collects nothing and throws on the first problem, unlike the guard: this is
 * about a document being well-formed, and a half-valid configuration has no
 * useful partial reading.
 */
export function assertTopicConfig(cfg: unknown): asserts cfg is TopicConfig {
  const c = cfg as Partial<TopicConfig>;

  if (c?.schema !== "nomos.gx402.hcs_topic_config.v1") {
    throw new TopicConfigError("CONFIG_SCHEMA_MISMATCH", `got ${String(c?.schema)}`);
  }
  if (c.network !== NETWORK) {
    throw new TopicConfigError("CONFIG_NETWORK_MISMATCH", `refusing ${String(c.network)}; this project is ${NETWORK}-only`);
  }

  // ── admin key: absent, and absent in the one way that is checkable ────────
  // `null` and "missing" are different states, and only one of them proves the
  // author considered the question.
  if (!("admin_key" in (c as object))) {
    throw new TopicConfigError("ADMIN_KEY_FIELD_MISSING", "admin_key must be present and explicitly null");
  }
  if (c.admin_key !== null) {
    throw new TopicConfigError("ADMIN_KEY_PRESENT", "this topic is created immutable — admin_key must be null");
  }

  // ── memo ─────────────────────────────────────────────────────────────────
  if (typeof c.memo !== "string" || c.memo.length === 0) {
    throw new TopicConfigError("MEMO_MISSING", "memo is required");
  }
  const actualBytes = Buffer.byteLength(c.memo, "utf8");
  if (typeof c.memo_bytes !== "number" || c.memo_bytes !== actualBytes) {
    throw new TopicConfigError(
      "MEMO_BYTE_COUNT_MISMATCH",
      `memo_bytes says ${String(c.memo_bytes)}, the memo is ${actualBytes} bytes`,
    );
  }
  if (actualBytes > TOPIC_MEMO_MAX_BYTES) {
    throw new TopicConfigError("MEMO_TOO_LONG", `${actualBytes} bytes exceeds the ${TOPIC_MEMO_MAX_BYTES}-byte limit`);
  }

  // ── submit key ───────────────────────────────────────────────────────────
  const sk = c.submit_key;
  if (!sk || sk.type !== "ECDSA_SECP256K1") {
    throw new TopicConfigError("SUBMIT_KEY_TYPE_MISMATCH", `expected ECDSA_SECP256K1, got ${String(sk?.type)}`);
  }
  if (typeof sk.public_key !== "string" || !/^0[23][0-9a-f]{64}$/.test(sk.public_key)) {
    throw new TopicConfigError(
      "SUBMIT_KEY_MALFORMED",
      "submit key must be a compressed secp256k1 public key: 02/03 prefix + 64 lowercase hex",
    );
  }

  // ── accounts and renewal ─────────────────────────────────────────────────
  for (const [field, value] of [
    ["payer_account_id", c.payer_account_id],
    ["auto_renew_account_id", c.auto_renew_account_id],
  ] as const) {
    if (typeof value !== "string" || !/^\d+\.\d+\.\d+$/.test(value)) {
      throw new TopicConfigError("ACCOUNT_ID_MALFORMED", `${field} is ${String(value)}`);
    }
  }
  if (
    typeof c.auto_renew_period_seconds !== "number" ||
    !Number.isInteger(c.auto_renew_period_seconds) ||
    c.auto_renew_period_seconds < AUTO_RENEW_PERIOD_MIN_SECONDS ||
    c.auto_renew_period_seconds > AUTO_RENEW_PERIOD_MAX_SECONDS
  ) {
    throw new TopicConfigError(
      "AUTO_RENEW_PERIOD_OUT_OF_RANGE",
      `${String(c.auto_renew_period_seconds)} is outside ` +
        `[${AUTO_RENEW_PERIOD_MIN_SECONDS}, ${AUTO_RENEW_PERIOD_MAX_SECONDS}]`,
    );
  }

  // ── fee ceiling ──────────────────────────────────────────────────────────
  if (typeof c.max_transaction_fee_tinybar !== "string" || !/^(0|[1-9][0-9]*)$/.test(c.max_transaction_fee_tinybar)) {
    throw new TopicConfigError("FEE_CAP_MALFORMED", "max_transaction_fee_tinybar must be a decimal integer string");
  }
  if (BigInt(c.max_transaction_fee_tinybar) > BigInt(TOPIC_CREATE_MAX_FEE_TINYBAR)) {
    throw new TopicConfigError(
      "FEE_CAP_EXCEEDED",
      `${c.max_transaction_fee_tinybar} tinybar exceeds the approved ceiling of ${TOPIC_CREATE_MAX_FEE_TINYBAR}`,
    );
  }
}

/** Canonical UTF-8 bytes of a configuration. */
export function topicConfigBytes(cfg: TopicConfig = TOPIC_CONFIG): Buffer {
  return canonicalize(cfg);
}

/** The value an authorization binds to. */
export function topicConfigDigest(cfg: TopicConfig = TOPIC_CONFIG): string {
  return canonicalDigest(cfg);
}
