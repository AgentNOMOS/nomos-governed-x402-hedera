/**
 * NOMOS policy engine — offline, deterministic, key-free.
 *
 * HARD CONSTRAINT: this module holds no key, opens no socket and constructs no
 * transaction. It answers exactly one question — "may this payment be made?" —
 * and answers it the same way every time for the same inputs.
 *
 * The one design decision worth reading twice: ALLOW, DENY and REVIEW all carry
 * the *same* `bound_terms` object with the *same* field set. A denial whose
 * binding is thinner than an approval is a denial no third party can audit, and
 * that asymmetry is the single most common flaw in payment-policy receipts.
 */
import {
  canonicalDigest,
  isDigest,
  type Clock,
  systemClock,
  toIso,
  fromIso,
  utcDayKey,
  assertValid,
  validate,
  POLICY_PREFLIGHT_REQUEST_SCHEMA,
  AGENT_IDENTITY_SHAPE,
  AUTHORITY_SCOPE_SHAPE,
  DOMAIN_PREPAYMENT_DECISION,
  ENVIRONMENT,
  decisionId,
} from "../../shared-schemas/src/index.ts";

export type Decision = "ALLOW" | "DENY" | "REVIEW";
export type CheckClass = "hard" | "review" | "technical";

export interface Check {
  code: string;
  class: CheckClass;
  passed: boolean;
  detail?: string;
}

/**
 * The effective policy. Versioned and hashed so a receipt can prove *which*
 * rules produced the decision without publishing the rules themselves.
 */
export interface PolicyDocument {
  policy_version: string;
  /** CAIP-style network ids the agent may pay on. */
  allowed_networks: string[];
  /** `HBAR` or HTS token ids. */
  allowed_assets: string[];
  /** Receiver account ids the agent may pay. */
  allowed_payees: string[];
  /** Capability strings the request must be covered by. */
  required_scopes: string[];
  /** Per-payment ceiling, atomic units, decimal string. */
  max_atomic_per_payment: string;
  /** Cumulative ceiling across the whole demo run, atomic units. */
  max_atomic_cumulative: string;
  /** Payments per UTC day, SKU-wide. */
  max_payments_per_utc_day: number;
  /** Quote lifetime. Also the receipt's `valid_until` offset. */
  quote_ttl_seconds: number;
  /**
   * Amounts at or above this fraction of `max_atomic_per_payment` are routed to
   * REVIEW rather than ALLOW. Expressed as a percentage integer to keep floats
   * out of the policy document entirely.
   */
  review_threshold_percent: number;
}

export const DEMO_POLICY: PolicyDocument = {
  policy_version: "nomos-gx402-demo-1.0.0",
  allowed_networks: ["hedera:testnet"],
  allowed_assets: ["HBAR"],
  allowed_payees: [],           // filled per deployment; empty means "deny everything"
  required_scopes: ["evidence:read"],
  max_atomic_per_payment: "10000000",      // 0.1 HBAR
  max_atomic_cumulative: "200000000",      // 2 HBAR across the whole demo
  max_payments_per_utc_day: 50,
  quote_ttl_seconds: 180,
  review_threshold_percent: 80,
};

/** Digest of the policy document — the value that goes into receipts. */
export function policyHash(policy: PolicyDocument): string {
  return canonicalDigest(policy);
}

// ── spend ledger ────────────────────────────────────────────────────────────

/**
 * Cumulative + per-UTC-day spend accounting.
 *
 * Counted BEFORE the payment is made, never after. A cap that is enforced after
 * settlement is not a cap, it is a report.
 */
export interface SpendSnapshot {
  cumulative_atomic: string;
  day_key: string;
  day_count: number;
}

export class SpendLedger {
  #cumulative = 0n;
  #dayKey = "";
  #dayCount = 0;

  snapshot(nowMs: number): SpendSnapshot {
    const key = utcDayKey(nowMs);
    return {
      cumulative_atomic: this.#cumulative.toString(),
      day_key: key,
      day_count: key === this.#dayKey ? this.#dayCount : 0,
    };
  }

  /** Record an authorised payment. Call this only once a payment is committed. */
  commit(nowMs: number, atomicAmount: string): void {
    const key = utcDayKey(nowMs);
    if (key !== this.#dayKey) {
      this.#dayKey = key;
      this.#dayCount = 0;
    }
    this.#cumulative += BigInt(atomicAmount);
    this.#dayCount += 1;
  }
}

// ── replay / idempotency ────────────────────────────────────────────────────

export type ReplayState = "in_flight" | "consumed" | "failed";

/**
 * Fail-CLOSED replay guard.
 *
 * Deliberately stricter than the production Base gateway's guard, which fails
 * *open* when it cannot derive a key — a reasonable choice there, because it
 * protects a live revenue stream where a false rejection costs a real customer.
 * Here there is no legitimate traffic to protect, so an underivable key is an
 * error, not a pass.
 */
export class ReplayGuard {
  #seen = new Map<string, { state: ReplayState; atMs: number }>();

  check(key: string): { fresh: boolean; state?: ReplayState } {
    if (!key || typeof key !== "string") {
      throw new Error("REPLAY_KEY_UNDERIVABLE: refusing to fail open");
    }
    const hit = this.#seen.get(key);
    return hit ? { fresh: false, state: hit.state } : { fresh: true };
  }

  claim(key: string, nowMs: number): void {
    const hit = this.#seen.get(key);
    if (hit && hit.state !== "failed") {
      throw new Error(`REPLAY_DETECTED: ${key} already ${hit.state}`);
    }
    this.#seen.set(key, { state: "in_flight", atMs: nowMs });
  }

  settle(key: string, state: Exclude<ReplayState, "in_flight">, nowMs: number): void {
    this.#seen.set(key, { state, atMs: nowMs });
  }

  get size(): number {
    return this.#seen.size;
  }
}

// ── evaluation ──────────────────────────────────────────────────────────────

export interface PolicyContext {
  policy: PolicyDocument;
  ledger: SpendLedger;
  clock?: Clock;
  /** Nonces already used for a preflight decision — anti-replay at the policy layer. */
  usedNonces?: Set<string>;
}

export interface BoundTerms {
  offer_id: string;
  resource_url: string;
  http_method: string;
  request_hash: string;
  quote_hash: string;
  network: string;
  asset: string;
  atomic_amount: string;
  pay_to: string;
  request_id: string;
  nonce: string;
  decision: Decision;
  decision_code: string;
  policy_version: string;
}

export interface PolicyResult {
  decision: Decision;
  decision_code: string;
  checks: Check[];
  bound_terms: BoundTerms;
  bound_terms_digest: string;
  /** Unsigned record, ready for the evidence-receipt signer. */
  record: Record<string, unknown>;
  decision_id: string;
}

/** Sentinel for "no value existed here". Never null, never absent — a missing key is a hole in the binding. */
export const NO_VALUE = "__none__";

/**
 * Substitutes used when the request is too malformed to read an identity from.
 *
 * A structurally broken request must still produce a *complete, schema-valid,
 * signed* DENY. Emitting no receipt at all would mean the one case where an
 * attacker controls the input is also the one case with no evidence trail.
 */
const UNKNOWN_AGENT = {
  did: "did:nomos:unknown-agent",
  public_key_hex: "0".repeat(64),
  key_type: "Ed25519" as const,
};
const UNKNOWN_AUTHORITY = {
  scopes: ["none:none"],
  granted_by: "did:nomos:unknown-authority",
  valid_until: "1970-01-01T00:00:00Z",
};

/** Check details are diagnostic, not contractual — clamp them to the schema bound. */
function clampDetail(s: string): string {
  return s.length <= 256 ? s : `${s.slice(0, 253)}...`;
}

function safeAgentIdentity(v: unknown): Record<string, unknown> {
  return validate(v, AGENT_IDENTITY_SHAPE).length === 0
    ? (v as Record<string, unknown>)
    : { ...UNKNOWN_AGENT };
}

function safeAuthorityScope(v: unknown): Record<string, unknown> {
  return validate(v, AUTHORITY_SCOPE_SHAPE).length === 0
    ? (v as Record<string, unknown>)
    : { ...UNKNOWN_AUTHORITY, scopes: [...UNKNOWN_AUTHORITY.scopes] };
}

function toBigIntOrNull(s: unknown): bigint | null {
  if (typeof s !== "string" || !/^(0|[1-9][0-9]*)$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

/**
 * Evaluate a preflight request.
 *
 * Never throws on a *policy* failure — a rejected payment is a normal outcome
 * that must produce a signed, bound DENY. It throws only when the input is so
 * malformed that no honest binding could be constructed.
 */
export function evaluate(request: unknown, ctx: PolicyContext): PolicyResult {
  const clock = ctx.clock ?? systemClock;
  const nowMs = clock.nowMs();
  const policy = ctx.policy;
  const checks: Check[] = [];

  const schemaIssues = validate(request, POLICY_PREFLIGHT_REQUEST_SCHEMA);
  checks.push({
    code: "schema_valid",
    class: "hard",
    passed: schemaIssues.length === 0,
    detail: schemaIssues.length === 0 ? "ok" : schemaIssues.slice(0, 3).map((i) => `${i.path} ${i.code}`).join("; "),
  });

  // A structurally invalid request still gets a bound DENY, built from whatever
  // is safely readable. That is the whole point of the sentinel.
  const r = (request ?? {}) as Record<string, any>;
  const offer = (r.offer ?? {}) as Record<string, any>;
  const service = (offer.service ?? {}) as Record<string, any>;

  const offerId = typeof offer.offer_id === "string" ? offer.offer_id : NO_VALUE;
  const resourceUrl = typeof service.resource_url === "string" ? service.resource_url : NO_VALUE;
  const httpMethod = typeof service.http_method === "string" ? service.http_method : NO_VALUE;
  const network = typeof offer.network === "string" ? offer.network : NO_VALUE;
  const asset = typeof offer.asset === "string" ? offer.asset : NO_VALUE;
  const amountStr = typeof offer.atomic_amount === "string" ? offer.atomic_amount : NO_VALUE;
  const payTo = typeof offer.pay_to === "string" ? offer.pay_to : NO_VALUE;
  const requestId = typeof r.request_id === "string" ? r.request_id : NO_VALUE;
  const nonce = typeof r.nonce === "string" ? r.nonce : NO_VALUE;
  const requestHash = isDigest(r.request_hash) ? r.request_hash : NO_VALUE;
  const quoteHash = canonicalDigest(offer);

  // ── hard checks ───────────────────────────────────────────────────────────
  checks.push({
    code: "network_allowed",
    class: "hard",
    passed: policy.allowed_networks.includes(network),
    detail: `offered=${network} allowed=${policy.allowed_networks.join(",")}`,
  });

  checks.push({
    code: "asset_allowed",
    class: "hard",
    passed: policy.allowed_assets.includes(asset),
    detail: `offered=${asset} allowed=${policy.allowed_assets.join(",")}`,
  });

  checks.push({
    code: "payee_allowed",
    class: "hard",
    passed: policy.allowed_payees.includes(payTo),
    detail:
      policy.allowed_payees.length === 0
        ? "payee allowlist empty — denying by construction"
        : `offered=${payTo}`,
  });

  const amount = toBigIntOrNull(amountStr);
  checks.push({
    code: "amount_wellformed",
    class: "hard",
    passed: amount !== null && amount > 0n,
    detail: `atomic_amount=${amountStr} (decimal string, integer only)`,
  });

  const maxPer = BigInt(policy.max_atomic_per_payment);
  checks.push({
    code: "amount_within_per_payment_cap",
    class: "hard",
    passed: amount !== null && amount <= maxPer,
    detail: `amount=${amountStr} cap=${policy.max_atomic_per_payment}`,
  });

  const snap = ctx.ledger.snapshot(nowMs);
  const projected = amount === null ? null : BigInt(snap.cumulative_atomic) + amount;
  checks.push({
    code: "cumulative_cap",
    class: "hard",
    passed: projected !== null && projected <= BigInt(policy.max_atomic_cumulative),
    detail: `spent=${snap.cumulative_atomic} + ${amountStr} vs cap=${policy.max_atomic_cumulative}`,
  });

  checks.push({
    code: "daily_count_cap",
    class: "hard",
    passed: snap.day_count < policy.max_payments_per_utc_day,
    detail: `day=${snap.day_key} count=${snap.day_count} cap=${policy.max_payments_per_utc_day}`,
  });

  // Authority: scopes must cover every required scope, and the delegation must
  // not have expired against the *engine's* clock.
  const scopes: string[] = Array.isArray(r.authority_scope?.scopes) ? r.authority_scope.scopes : [];
  const scopeOk = policy.required_scopes.every(
    (need) => scopes.includes(need) || scopes.includes(`${need.split(":")[0]}:*`),
  );
  checks.push({
    code: "authority_scope_covers_request",
    class: "hard",
    passed: scopeOk,
    detail: `have=[${scopes.join(",")}] need=[${policy.required_scopes.join(",")}]`,
  });

  let authorityFresh = false;
  try {
    authorityFresh = fromIso(String(r.authority_scope?.valid_until)) > nowMs;
  } catch {
    authorityFresh = false;
  }
  checks.push({
    code: "authority_not_expired",
    class: "hard",
    passed: authorityFresh,
    detail: `valid_until=${r.authority_scope?.valid_until ?? NO_VALUE} now=${toIso(nowMs)}`,
  });

  const nonceFresh = nonce !== NO_VALUE && !(ctx.usedNonces?.has(nonce) ?? false);
  checks.push({
    code: "nonce_unused",
    class: "hard",
    passed: nonceFresh,
    detail: nonceFresh ? "fresh" : "nonce already used for a decision",
  });

  // ── review checks ─────────────────────────────────────────────────────────
  // A large-but-legal amount is not a denial; it is a decision a human should
  // see. REVIEW exists so that "unusual" and "forbidden" stay distinguishable.
  const reviewFloor = (maxPer * BigInt(policy.review_threshold_percent)) / 100n;
  const nearCap = amount !== null && amount >= reviewFloor;
  checks.push({
    code: "amount_below_review_threshold",
    class: "review",
    passed: !nearCap,
    detail: `amount=${amountStr} review_at>=${reviewFloor.toString()} (${policy.review_threshold_percent}% of per-payment cap)`,
  });

  // ── verdict ───────────────────────────────────────────────────────────────
  //
  // Which failure gets to name the decision matters more than it looks. The
  // schema check fires first and would otherwise mask every semantic reason:
  // an offer on the wrong network fails `schema_valid` (the network is pinned
  // by const) before it ever reaches `network_allowed`, and a receipt reading
  // DENY_SCHEMA_VALID tells an auditor nothing about *why* the payment was
  // wrong. So a specific semantic failure outranks the structural one — unless
  // the request was too broken to read an offer from at all, in which case the
  // structural failure genuinely IS the root cause.
  //
  // Either way `checks` lists every outcome, so nothing is hidden; only the
  // headline code changes.
  const hardFails = checks.filter((c) => c.class === "hard" && !c.passed);
  const structuralOnly = offerId === NO_VALUE;
  const firstHardFail =
    hardFails.find((c) => c.code !== "schema_valid" && !structuralOnly) ?? hardFails[0];
  const firstReviewFail = checks.find((c) => c.class === "review" && !c.passed);

  const decision: Decision = firstHardFail ? "DENY" : firstReviewFail ? "REVIEW" : "ALLOW";
  const decision_code = firstHardFail
    ? `DENY_${firstHardFail.code.toUpperCase()}`
    : firstReviewFail
      ? `REVIEW_${firstReviewFail.code.toUpperCase()}`
      : "ALLOW_WITHIN_POLICY";

  const bound_terms: BoundTerms = {
    offer_id: offerId,
    resource_url: resourceUrl,
    http_method: httpMethod,
    request_hash: requestHash,
    quote_hash: quoteHash,
    network,
    asset,
    atomic_amount: amountStr,
    pay_to: payTo,
    request_id: requestId,
    nonce,
    decision,
    decision_code,
    policy_version: policy.policy_version,
  };
  const bound_terms_digest = canonicalDigest(bound_terms);
  const decision_id = decisionId(requestId, bound_terms_digest, DOMAIN_PREPAYMENT_DECISION);

  const issuedAtMs = nowMs;
  const record = {
    request_id: requestId,
    nonce,
    decision,
    decision_code,
    checks: checks.map((c) => (c.detail === undefined ? { ...c } : { ...c, detail: clampDetail(c.detail) })),
    agent_identity: safeAgentIdentity(r.agent_identity),
    authority_scope: safeAuthorityScope(r.authority_scope),
    bound_terms,
    bound_terms_digest,
    policy_version: policy.policy_version,
    policy_hash: policyHash(policy),
    issued_at: toIso(issuedAtMs),
    valid_until: toIso(issuedAtMs + policy.quote_ttl_seconds * 1000),
    authorizes_payment: false as const,
    environment: ENVIRONMENT,
  };

  ctx.usedNonces?.add(nonce);

  return { decision, decision_code, checks, bound_terms, bound_terms_digest, record, decision_id };
}

/** Convenience: throw if the request is not even schema-valid. Used by callers that want fail-fast. */
export function assertPreflightRequest(request: unknown): void {
  assertValid(request, POLICY_PREFLIGHT_REQUEST_SCHEMA);
}
