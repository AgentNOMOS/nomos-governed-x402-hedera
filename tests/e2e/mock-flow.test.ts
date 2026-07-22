/**
 * End-to-end walk of the full chain, driven by the agent.
 *
 *   Discovery → Policy Preflight → HTTP 402 → Payment Authorization
 *   → Settlement Verification → Execution → Delivery Hash
 *   → Signed Proof-of-Action Receipt → HCS Anchor → Verification
 *
 * ⚠ MOCK/OFFLINE. The settlement and the anchor are simulated. Every artifact
 * this test produces is stamped `MOCK_OFFLINE`, and the final assertion in this
 * file exists specifically to fail if that stamp ever disappears without a real
 * Hedera integration behind it.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { verifyProofOfActionReceipt } from "../../packages/evidence-receipt/src/index.ts";
import { canonicalDigest } from "../../packages/shared-schemas/src/index.ts";
import { executeEvidenceRequest, validateEvidenceRequest, hashEvidenceResult } from "../../services/resource-server/src/evidence-service.ts";
import { makeHarness, nextIds, REQUEST_BODY, PAYEE, DEMO_TOPIC } from "../helpers/fixtures.ts";

describe("E2E (MOCK) — 402 → policy → settlement → delivery → receipt → anchor", () => {
  test("the whole chain completes and every link is verifiable", async () => {
    const h = makeHarness();
    const { request_id, nonce } = nextIds();

    // ── 1. Discovery ──────────────────────────────────────────────────────
    const offer = h.flow.discover();
    assert.equal(offer.network, "hedera:testnet");
    assert.equal(offer.pay_to, PAYEE);

    // ── 2..10. the agent buys ─────────────────────────────────────────────
    const out = await h.agent.purchase(h.flow, {
      request_body: REQUEST_BODY,
      request_id,
      nonce,
      anchor: true,
      trustedKeys: h.trustedKeys,
    });

    assert.equal(out.ok, true, `purchase failed: ${out.code} ${JSON.stringify(out.verification?.reasons ?? [])}`);
    assert.equal(out.stage, "DONE");
    assert.equal(out.code, "DELIVERED");

    const receipt = out.receipt!;
    const rec = receipt.record as Record<string, any>;

    // ── policy decision is bound into the receipt ─────────────────────────
    assert.equal(rec.policy_decision, "ALLOW");
    assert.equal(rec.decision_id, out.preflight.quote!.decision_id);
    assert.match(rec.policy_hash, /^sha256:[0-9a-f]{64}$/);

    // ── request binding ───────────────────────────────────────────────────
    assert.equal(rec.request_hash, out.preflight.quote!.request_hash);
    assert.equal(rec.quote_hash, out.preflight.quote!.quote_hash);
    assert.equal(rec.quote_id, out.preflight.quote!.quote_id);
    assert.equal(rec.idempotency_key, out.preflight.quote!.idempotency_key);

    // ── payment binding ───────────────────────────────────────────────────
    assert.equal(rec.network, "hedera:testnet");
    assert.equal(rec.asset, "HBAR");
    assert.equal(rec.atomic_amount, offer.atomic_amount);
    assert.equal(rec.payee, PAYEE);
    assert.match(rec.hedera_transaction_id, /^\d+\.\d+\.\d+@\d+\.\d+$/);
    assert.equal(rec.settlement_finality, "FINAL");

    // ── delivery binding: the result hash must match a fresh execution ─────
    const recomputed = hashEvidenceResult(executeEvidenceRequest(validateEvidenceRequest(REQUEST_BODY)));
    assert.equal(rec.result_hash, recomputed, "the receipt must commit to the result that was actually delivered");
    assert.equal(rec.result_hash, canonicalDigest(out.result));
    assert.equal(rec.delivery_status, "DELIVERED");
    assert.equal(rec.execution_status, "SUCCEEDED");
    assert.equal(rec.refund_due, false);

    // ── anchor ────────────────────────────────────────────────────────────
    assert.equal(receipt.anchor!.status, "ANCHORED");
    assert.equal(receipt.anchor!.anchored_digest, receipt.record_digest);
    assert.equal(receipt.anchor!.topic_id, DEMO_TOPIC);
    assert.ok(receipt.anchor!.sequence_number! >= 1);
    const anchorCheck = await h.anchor.verifyAnchor(receipt.anchor as any, receipt.record_digest);
    assert.equal(anchorCheck.ok, true);

    // ── verification links ────────────────────────────────────────────────
    assert.ok(receipt.verification.hashscan_transaction_url.startsWith("https://hashscan.io/testnet/transaction/"));
    assert.ok(!JSON.stringify(receipt.verification).includes("mainnet"));

    // ── a third party, holding only the receipt and the key set, agrees ────
    const third = verifyProofOfActionReceipt(receipt, { trustedKeys: h.trustedKeys });
    assert.deepEqual(third.reasons, []);
    assert.equal(third.ok, true);
  });

  test("the artifacts are unmistakably labelled as offline mocks", async () => {
    const h = makeHarness();
    const { request_id, nonce } = nextIds();
    const out = await h.agent.purchase(h.flow, { request_body: REQUEST_BODY, request_id, nonce, anchor: true, trustedKeys: h.trustedKeys });

    assert.equal((out.receipt!.record as any).settlement_source, "MOCK_OFFLINE");
    assert.equal(out.paid!.settlement!.source, "MOCK_OFFLINE");
    assert.equal(out.receipt!.anchor!.source, "MOCK_OFFLINE");
    assert.equal(out.verification!.mock_settlement, true);
    assert.equal((out.receipt!.record as any).environment, "TESTNET_DEMO_ONLY");

    // The guard that matters: until CP-H2/CP-H7 land a real integration, no
    // artifact may claim an on-chain source. If this ever fails, either the
    // real adapter arrived (delete this assertion) or something is lying.
    assert.notEqual((out.receipt!.record as any).settlement_source, "MIRROR_NODE");
    assert.notEqual(out.receipt!.anchor!.source, "HEDERA_HCS");
  });

  test("a policy denial ends the flow before any payment is attempted", async () => {
    const h = makeHarness({ policy: { max_atomic_per_payment: "1" } });
    const { request_id, nonce } = nextIds();
    const out = await h.agent.purchase(h.flow, { request_body: REQUEST_BODY, request_id, nonce, trustedKeys: h.trustedKeys });

    assert.equal(out.ok, false);
    assert.equal(out.stage, "PREFLIGHT");
    assert.equal(out.code, "POLICY_DENY");
    assert.equal(out.paid, undefined, "no payment leg may run after a denial");
    assert.equal(out.receipt, undefined);
    // The denial itself is still evidence.
    assert.equal((out.preflight.decision_receipt.record as any).decision_code, "DENY_AMOUNT_WITHIN_PER_PAYMENT_CAP");
  });

  test("the agent rejects a receipt that does not match what it ordered", async () => {
    const h = makeHarness();
    const { request_id, nonce } = nextIds();
    const out = await h.agent.purchase(h.flow, { request_body: REQUEST_BODY, request_id, nonce, trustedKeys: h.trustedKeys });
    assert.equal(out.ok, true);

    // Someone hands the agent a receipt signed by a key it does not trust.
    const foreign = verifyProofOfActionReceipt(out.receipt!, { trustedKeys: { "other-kid": "0".repeat(64) } });
    assert.equal(foreign.ok, false);
    assert.ok(foreign.reasons.includes("unknown_kid"));
  });

  test("two independent runs of the same purchase produce the same result hash", async () => {
    const a = makeHarness();
    const b = makeHarness();
    const idsA = nextIds();
    const idsB = nextIds();

    const outA = await a.agent.purchase(a.flow, { request_body: REQUEST_BODY, request_id: idsA.request_id, nonce: idsA.nonce, trustedKeys: a.trustedKeys });
    const outB = await b.agent.purchase(b.flow, { request_body: REQUEST_BODY, request_id: idsB.request_id, nonce: idsB.nonce, trustedKeys: b.trustedKeys });

    assert.equal((outA.receipt!.record as any).result_hash, (outB.receipt!.record as any).result_hash);
    assert.equal((outA.receipt!.record as any).request_hash, (outB.receipt!.record as any).request_hash);
    // …but the receipts themselves differ, because the nonce and quote differ.
    assert.notEqual(outA.receipt!.receipt_id, outB.receipt!.receipt_id);
  });

  test("check order and duplicates in the request do not change the request hash", async () => {
    const h = makeHarness();
    const ids1 = nextIds();
    const ids2 = nextIds();

    const out1 = await h.agent.purchase(h.flow, {
      request_body: { subject: REQUEST_BODY.subject, checks: ["has_agent_card", "declares_x402", "publishes_jwks"] },
      request_id: ids1.request_id, nonce: ids1.nonce, trustedKeys: h.trustedKeys,
    });
    const out2 = await h.agent.purchase(h.flow, {
      request_body: { subject: REQUEST_BODY.subject, checks: ["publishes_jwks", "declares_x402", "has_agent_card", "declares_x402"] },
      request_id: ids2.request_id, nonce: ids2.nonce, trustedKeys: h.trustedKeys,
    });

    assert.equal(out1.ok, true);
    assert.equal(out2.ok, true);
    assert.equal(
      (out1.receipt!.record as any).request_hash,
      (out2.receipt!.record as any).request_hash,
      "the same order, expressed differently, is the same order",
    );
  });
});
