import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  evaluate,
  policyHash,
  SpendLedger,
  ReplayGuard,
  DEMO_POLICY,
  NO_VALUE,
  type PolicyDocument,
} from "../../packages/nomos-policy/src/index.ts";
import { canonicalDigest, fixedClock, SCHEMA_VERSION } from "../../packages/shared-schemas/src/index.ts";
import { OFFER, PAYEE, T0, testPolicy, AGENT_IDENTITY, authorityScope, REQUEST_BODY } from "../helpers/fixtures.ts";
import { hashEvidenceRequest, validateEvidenceRequest } from "../../services/resource-server/src/evidence-service.ts";

const clock = fixedClock(T0);
const requestHash = hashEvidenceRequest(validateEvidenceRequest(REQUEST_BODY));

function req(overrides: Record<string, unknown> = {}, offerOverrides: Record<string, unknown> = {}) {
  return {
    schema: `nomos.gx402.policy_preflight_request.${SCHEMA_VERSION}`,
    request_id: "req_policy_000001",
    nonce: "n_policy_000001",
    agent_identity: AGENT_IDENTITY,
    authority_scope: authorityScope(),
    offer: { ...OFFER, ...offerOverrides },
    request_hash: requestHash,
    requested_at: T0,
    ...overrides,
  };
}

function ctx(policy: PolicyDocument = testPolicy(), ledger = new SpendLedger()) {
  return { policy, ledger, clock, usedNonces: new Set<string>() };
}

describe("policy — the happy path", () => {
  test("a compliant request is ALLOWed", () => {
    const r = evaluate(req(), ctx());
    assert.equal(r.decision, "ALLOW");
    assert.equal(r.decision_code, "ALLOW_WITHIN_POLICY");
    assert.ok(r.checks.every((c) => c.class !== "hard" || c.passed));
  });

  test("the decision record never claims payment authority", () => {
    assert.equal(evaluate(req(), ctx()).record.authorizes_payment, false);
  });

  test("the policy hash is a stable function of the document", () => {
    const p = testPolicy();
    assert.equal(policyHash(p), canonicalDigest(p));
    assert.notEqual(policyHash(p), policyHash({ ...p, max_atomic_per_payment: "1" }));
  });
});

describe("policy — allowlists", () => {
  test("wrong network is a hard DENY", () => {
    const r = evaluate(req({}, { network: "eip155:8453" }), ctx());
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_NETWORK_ALLOWED");
  });

  test("hedera mainnet is denied just as firmly as an EVM chain", () => {
    assert.equal(evaluate(req({}, { network: "hedera:mainnet" }), ctx()).decision, "DENY");
  });

  test("wrong asset is a hard DENY", () => {
    const r = evaluate(req({}, { asset: "0.0.456858" }), ctx());
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_ASSET_ALLOWED");
  });

  test("wrong payee is a hard DENY", () => {
    const r = evaluate(req({}, { pay_to: "0.0.999999" }), ctx());
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_PAYEE_ALLOWED");
  });

  test("an empty payee allowlist denies everything — no implicit trust", () => {
    const r = evaluate(req(), ctx({ ...DEMO_POLICY, allowed_payees: [] }));
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_PAYEE_ALLOWED");
  });
});

describe("policy — spend caps, counted before the payment", () => {
  test("an amount over the per-payment cap is denied", () => {
    const r = evaluate(req({}, { atomic_amount: "99000000" }), ctx());
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_AMOUNT_WITHIN_PER_PAYMENT_CAP");
  });

  test("the cumulative cap denies the payment that would breach it", () => {
    const ledger = new SpendLedger();
    const policy = testPolicy({ max_atomic_cumulative: "8000000" });
    ledger.commit(Date.parse(T0), "5000000");
    const r = evaluate(req(), ctx(policy, ledger));
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_CUMULATIVE_CAP");
  });

  test("a payment that exactly reaches the cumulative cap is still allowed", () => {
    const ledger = new SpendLedger();
    const policy = testPolicy({ max_atomic_cumulative: "10000000" });
    ledger.commit(Date.parse(T0), "5000000");
    assert.equal(evaluate(req(), ctx(policy, ledger)).decision, "ALLOW");
  });

  test("the per-UTC-day count cap denies once it is reached", () => {
    const ledger = new SpendLedger();
    const policy = testPolicy({ max_payments_per_utc_day: 2 });
    ledger.commit(Date.parse(T0), "1");
    ledger.commit(Date.parse(T0), "1");
    const r = evaluate(req(), ctx(policy, ledger));
    assert.equal(r.decision_code, "DENY_DAILY_COUNT_CAP");
  });

  test("the day counter resets across a UTC day boundary", () => {
    const ledger = new SpendLedger();
    ledger.commit(Date.parse("2026-07-22T23:59:59Z"), "1");
    assert.equal(ledger.snapshot(Date.parse("2026-07-23T00:00:01Z")).day_count, 0);
    assert.equal(ledger.snapshot(Date.parse("2026-07-22T23:59:59Z")).day_count, 1);
  });

  test("cumulative spend is exact at large magnitudes (BigInt, not float)", () => {
    const ledger = new SpendLedger();
    ledger.commit(Date.parse(T0), "9007199254740993");
    ledger.commit(Date.parse(T0), "1");
    assert.equal(ledger.snapshot(Date.parse(T0)).cumulative_atomic, "9007199254740994");
  });
});

describe("policy — authority and freshness", () => {
  test("a request outside the granted scope is denied", () => {
    const r = evaluate(req({ authority_scope: { ...authorityScope(), scopes: ["other:thing"] } }), ctx());
    assert.equal(r.decision_code, "DENY_AUTHORITY_SCOPE_COVERS_REQUEST");
  });

  test("a wildcard scope covers the requirement", () => {
    const r = evaluate(req({ authority_scope: { ...authorityScope(), scopes: ["evidence:*"] } }), ctx());
    assert.equal(r.decision, "ALLOW");
  });

  test("an expired delegation is denied against the ENGINE clock", () => {
    const r = evaluate(req({ authority_scope: authorityScope("2026-07-22T11:59:59Z") }), ctx());
    assert.equal(r.decision_code, "DENY_AUTHORITY_NOT_EXPIRED");
  });

  test("a reused nonce is denied", () => {
    const c = ctx();
    assert.equal(evaluate(req(), c).decision, "ALLOW");
    assert.equal(evaluate(req(), c).decision_code, "DENY_NONCE_UNUSED");
  });
});

describe("policy — REVIEW is distinct from DENY", () => {
  test("a large but legal amount routes to REVIEW, not DENY", () => {
    const r = evaluate(req({}, { atomic_amount: "9000000" }), ctx());
    assert.equal(r.decision, "REVIEW");
    assert.equal(r.decision_code, "REVIEW_AMOUNT_BELOW_REVIEW_THRESHOLD");
  });

  test("a hard failure outranks a review failure", () => {
    const r = evaluate(req({}, { atomic_amount: "9000000", asset: "0.0.1" }), ctx());
    assert.equal(r.decision, "DENY");
  });
});

describe("policy — symmetric binding for ALLOW, DENY and REVIEW", () => {
  const shapes = [
    ["ALLOW", evaluate(req(), ctx())],
    ["DENY", evaluate(req({}, { network: "eip155:8453" }), ctx())],
    ["REVIEW", evaluate(req({}, { atomic_amount: "9000000" }), ctx())],
  ] as const;

  test("all three carry exactly the same bound_terms key set", () => {
    const keySets = shapes.map(([, r]) => Object.keys(r.bound_terms).sort().join(","));
    assert.equal(new Set(keySets).size, 1, "a DENY with a thinner binding is a DENY nobody can audit");
  });

  test("all three carry a recomputable bound_terms_digest", () => {
    for (const [label, r] of shapes) {
      assert.equal(canonicalDigest(r.bound_terms), r.bound_terms_digest, `${label} digest must recompute`);
    }
  });

  test("no bound term is ever null, undefined or empty", () => {
    for (const [label, r] of shapes) {
      for (const [k, v] of Object.entries(r.bound_terms)) {
        assert.ok(v !== null && v !== undefined && v !== "", `${label}.${k} must not be a hole`);
      }
    }
  });

  test("the three digests differ from each other", () => {
    const digests = shapes.map(([, r]) => r.bound_terms_digest);
    assert.equal(new Set(digests).size, 3);
  });
});

describe("policy — malformed input still yields a complete, bound DENY", () => {
  test("a structurally broken request does not throw", () => {
    const r = evaluate({ garbage: true }, ctx());
    assert.equal(r.decision, "DENY");
    assert.equal(r.decision_code, "DENY_SCHEMA_VALID");
  });

  test("missing fields become the explicit sentinel, never absent keys", () => {
    const r = evaluate({}, ctx());
    assert.equal(r.bound_terms.offer_id, NO_VALUE);
    assert.equal(r.bound_terms.request_hash, NO_VALUE);
    assert.equal(Object.keys(r.bound_terms).length, 14);
  });

  test("an unreadable identity is replaced by a sentinel identity, not omitted", () => {
    const r = evaluate({}, ctx());
    assert.equal((r.record.agent_identity as any).did, "did:nomos:unknown-agent");
    assert.equal((r.record.authority_scope as any).valid_until, "1970-01-01T00:00:00Z");
  });
});

describe("replay guard — fail-closed", () => {
  test("a fresh key passes once", () => {
    const g = new ReplayGuard();
    assert.equal(g.check("k1").fresh, true);
    g.claim("k1", 0);
    assert.equal(g.check("k1").fresh, false);
  });

  test("claiming twice throws", () => {
    const g = new ReplayGuard();
    g.claim("k1", 0);
    assert.throws(() => g.claim("k1", 1), /REPLAY_DETECTED/);
  });

  test("a failed attempt may be retried — a failure is not a consumption", () => {
    const g = new ReplayGuard();
    g.claim("k1", 0);
    g.settle("k1", "failed", 1);
    assert.doesNotThrow(() => g.claim("k1", 2));
  });

  test("a consumed key can never be reclaimed", () => {
    const g = new ReplayGuard();
    g.claim("k1", 0);
    g.settle("k1", "consumed", 1);
    assert.throws(() => g.claim("k1", 2), /REPLAY_DETECTED/);
  });

  test("an underivable key throws rather than failing open", () => {
    const g = new ReplayGuard();
    assert.throws(() => g.check(""), /refusing to fail open/);
  });
});
