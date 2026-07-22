/**
 * Deterministic test fixtures.
 *
 * Everything here is synthetic. The account ids are in an obviously-fake
 * `0.0.999xxx` range that does not correspond to any account this project has
 * ever controlled, the signing key comes from a fixed all-zero-ish seed, and
 * the clock is frozen. No fixture value is derived from the production stack.
 */
import { fixedClock, type Clock } from "../../packages/shared-schemas/src/index.ts";
import { LocalEd25519Signer } from "../../packages/evidence-receipt/src/index.ts";
import { DEMO_POLICY, type PolicyDocument } from "../../packages/nomos-policy/src/index.ts";
import { MockHederaX402Adapter, type MockAdapterOptions } from "../../packages/hedera-x402-adapter/src/index.ts";
import { MockHcsAnchor, type MockAnchorOptions } from "../../packages/hcs-anchor/src/index.ts";
import { GovernedFlow, type ServiceOffer } from "../../services/resource-server/src/flow.ts";
import { GovernedAgent } from "../../services/agent-client/src/agent.ts";

export const T0 = "2026-07-22T12:00:00Z";
export const PAYER = "0.0.999001";
export const PAYEE = "0.0.999100";
/** A fresh, project-owned topic id placeholder. Never one of the OracleNet topics. */
export const DEMO_TOPIC = "0.0.999200";

export function testClock(iso: string = T0): Clock {
  return fixedClock(iso);
}

/** A clock the test can advance, for exercising expiry without a second server. */
export interface MutableClock extends Clock {
  advanceSeconds(n: number): void;
  setIso(iso: string): void;
}

export function mutableClock(iso: string = T0): MutableClock {
  let ms = Date.parse(iso);
  return {
    nowMs: () => ms,
    advanceSeconds: (n) => {
      ms += n * 1000;
    },
    setIso: (next) => {
      ms = Date.parse(next);
    },
  };
}

export function testSigner(kid = "nomos-gx402-test-ed25519-1"): LocalEd25519Signer {
  return LocalEd25519Signer.fromSeed(Buffer.alloc(32, 7), kid);
}

export const OFFER: ServiceOffer = {
  schema: "nomos.gx402.service_offer.v1",
  offer_id: "evidence.basic.v1",
  service: {
    service_id: "nomos-gx402-evidence",
    resource_url: "https://demo.invalid/v1/evidence",
    http_method: "POST",
  },
  description: "Synthetic agent-readiness evidence lookup (deterministic fixture corpus).",
  network: "hedera:testnet",
  asset: "HBAR",
  atomic_amount: "5000000", // 0.05 HBAR
  pay_to: PAYEE,
  quote_ttl_seconds: 180,
};

export function testPolicy(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return { ...DEMO_POLICY, allowed_payees: [PAYEE], ...overrides };
}

export const AGENT_IDENTITY = {
  did: "did:nomos:demo-agent-001",
  public_key_hex: "a".repeat(64),
  key_type: "Ed25519" as const,
  label: "demo-buyer",
};

export function authorityScope(validUntil = "2026-07-23T12:00:00Z") {
  return {
    scopes: ["evidence:read"],
    granted_by: "did:nomos:demo-operator",
    valid_until: validUntil,
    delegation_hash: null,
  };
}

export const REQUEST_BODY = {
  subject: "example-agent.invalid",
  checks: ["declares_x402", "has_agent_card", "publishes_jwks"],
};

export interface Harness {
  flow: GovernedFlow;
  agent: GovernedAgent;
  adapter: MockHederaX402Adapter;
  anchor: MockHcsAnchor;
  signer: LocalEd25519Signer;
  clock: Clock;
  trustedKeys: Record<string, string>;
}

export function makeHarness(opts: {
  clockIso?: string;
  policy?: Partial<PolicyDocument>;
  adapter?: MockAdapterOptions;
  anchor?: MockAnchorOptions;
  offer?: Partial<ServiceOffer>;
  clock?: Clock;
} = {}): Harness {
  const clock = opts.clock ?? testClock(opts.clockIso ?? T0);
  const signer = testSigner();
  const adapter = new MockHederaX402Adapter(PAYER, { clock, ...opts.adapter });
  const anchor = new MockHcsAnchor({ clock, ...opts.anchor });
  const offer: ServiceOffer = { ...OFFER, ...opts.offer };

  const flow = new GovernedFlow({
    offer,
    policy: testPolicy(opts.policy),
    adapter,
    signer,
    anchor,
    anchorTopicId: DEMO_TOPIC,
    clock,
  });

  const agent = new GovernedAgent(AGENT_IDENTITY, authorityScope(), {
    payerAccountId: PAYER,
    sign: (quote) => adapter.mockSign(quote),
  });

  return { flow, agent, adapter, anchor, signer, clock, trustedKeys: { [signer.kid]: signer.publicKeyHex } };
}

let counter = 0;
/** Unique-per-call request id / nonce, deterministic within a run. */
export function nextIds(): { request_id: string; nonce: string } {
  counter += 1;
  return { request_id: `req_test_${String(counter).padStart(6, "0")}`, nonce: `n_test_${String(counter).padStart(6, "0")}` };
}
