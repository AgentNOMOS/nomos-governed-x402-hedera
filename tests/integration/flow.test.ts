/**
 * Flow-level integration tests.
 *
 * These are the tests that matter most: each one asserts that a specific way of
 * cheating does NOT get work released. Everything that returns a non-200 below
 * is a refusal to deliver, and each refusal exists because the corresponding
 * mistake has been made — in this codebase's lineage or in the Hedera x402
 * reference implementation — at least once.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { fixedClock } from "../../packages/shared-schemas/src/index.ts";
import { verifyPrepaymentDecisionReceipt, verifyProofOfActionReceipt } from "../../packages/evidence-receipt/src/index.ts";
import { MockHederaX402Adapter } from "../../packages/hedera-x402-adapter/src/index.ts";
import { MockHcsAnchor } from "../../packages/hcs-anchor/src/index.ts";
import { GovernedFlow } from "../../services/resource-server/src/flow.ts";
import type { EvidenceServiceError } from "../../services/resource-server/src/evidence-service.ts";
import {
  makeHarness, mutableClock, nextIds, REQUEST_BODY, AGENT_IDENTITY, authorityScope,
  OFFER, PAYEE, PAYER, DEMO_TOPIC, T0, testPolicy, testSigner,
} from "../helpers/fixtures.ts";

function preflightArgs() {
  const { request_id, nonce } = nextIds();
  return {
    agent_identity: AGENT_IDENTITY as unknown as Record<string, unknown>,
    authority_scope: authorityScope() as unknown as Record<string, unknown>,
    request_body: REQUEST_BODY,
    request_id,
    nonce,
    payer_account_id: PAYER,
  };
}

describe("preflight → 402", () => {
  test("an allowed request yields a 402 with a bound challenge and a signed decision receipt", () => {
    const h = makeHarness();
    const out = h.flow.preflight(preflightArgs());

    assert.equal(out.httpStatus, 402);
    assert.equal(out.decision, "ALLOW");
    assert.ok(out.challenge);
    assert.equal(out.challenge!.accepts[0].memo, out.quote!.quote_id);
    assert.equal(out.challenge!.nomos.decision_id, out.decision_receipt.decision_id);
    assert.deepEqual(verifyPrepaymentDecisionReceipt(out.decision_receipt, h.trustedKeys), { ok: true, reasons: [] });
  });

  test("a denied request yields 403 and NO challenge — but still a signed, bound receipt", () => {
    const h = makeHarness({ policy: { allowed_payees: ["0.0.777777"] } });
    const out = h.flow.preflight(preflightArgs());

    assert.equal(out.httpStatus, 403);
    assert.equal(out.decision, "DENY");
    assert.equal(out.challenge, undefined, "a denial must not hand out a payment challenge");
    assert.deepEqual(verifyPrepaymentDecisionReceipt(out.decision_receipt, h.trustedKeys), { ok: true, reasons: [] });
    assert.equal((out.decision_receipt.record as any).decision_code, "DENY_PAYEE_ALLOWED");
  });

  test("wrong network is refused before any payment is possible", () => {
    const h = makeHarness({ offer: { network: "eip155:8453" as any } });
    const out = h.flow.preflight(preflightArgs());
    assert.equal(out.httpStatus, 403);
    assert.equal((out.decision_receipt.record as any).decision_code, "DENY_NETWORK_ALLOWED");
  });

  test("wrong asset is refused", () => {
    const h = makeHarness({ offer: { asset: "0.0.456858" } });
    assert.equal(h.flow.preflight(preflightArgs()).httpStatus, 403);
  });

  test("an invalid request body never reaches the paid path", () => {
    const h = makeHarness();
    assert.throws(
      () => h.flow.preflight({ ...preflightArgs(), request_body: { subject: "valid-subject.invalid", checks: [] } as any }),
      (e: unknown) => {
        assert.equal((e as EvidenceServiceError).code, "INVALID_CHECKS");
        return true;
      },
    );
  });

  test("a malformed subject is rejected with its own code", () => {
    const h = makeHarness();
    assert.throws(
      () => h.flow.preflight({ ...preflightArgs(), request_body: { subject: "x", checks: ["has_agent_card"] } as any }),
      (e: unknown) => {
        assert.equal((e as EvidenceServiceError).code, "INVALID_SUBJECT");
        return true;
      },
    );
  });
});

describe("payment → delivery gate", () => {
  test("the happy path delivers and produces a verifiable receipt", async () => {
    const h = makeHarness();
    const pre = h.flow.preflight(preflightArgs());
    const paid = await h.flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: pre.quote!.quote_id.slice(0, 12),
    });

    assert.equal(paid.httpStatus, 200);
    assert.equal(paid.code, "DELIVERED");
    assert.equal(paid.delivery!.delivery_status, "DELIVERED");
    assert.equal(verifyProofOfActionReceipt(paid.receipt!, { trustedKeys: h.trustedKeys }).ok, true);
  });

  test("a quote presented after its TTL is refused with 402 and nothing is executed", async () => {
    const clock = mutableClock(T0);
    const h = makeHarness({ clock });
    const pre = h.flow.preflight(preflightArgs());
    assert.equal(pre.quote!.expires_at, "2026-07-22T12:03:00Z");

    clock.advanceSeconds(181); // one second past the 180s TTL

    const paid = await h.flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_expired_0001",
    });

    assert.equal(paid.httpStatus, 402);
    assert.equal(paid.code, "QUOTE_EXPIRED");
    assert.equal(paid.result, undefined);
    assert.equal(paid.receipt, undefined);
    assert.equal(h.flow.ledger.snapshot(clock.nowMs()).cumulative_atomic, "0");
  });

  test("a quote presented one second before its TTL still works", async () => {
    const clock = mutableClock(T0);
    const h = makeHarness({ clock });
    const pre = h.flow.preflight(preflightArgs());
    clock.advanceSeconds(179);
    const paid = await h.flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_justintime_01",
    });
    assert.equal(paid.code, "DELIVERED");
  });

  test("paying for a DIFFERENT request than the quote covers is refused", async () => {
    const h = makeHarness();
    const pre = h.flow.preflight(preflightArgs());
    const paid = await h.flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: { subject: "someone-else.invalid", checks: ["has_agent_card"] },
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_mismatch_0001",
    });
    assert.equal(paid.httpStatus, 409);
    assert.equal(paid.code, "PAYMENT_REQUEST_MISMATCH");
    assert.equal(paid.receipt, undefined);
  });

  test("an unknown quote id is refused", async () => {
    const h = makeHarness();
    const paid = await h.flow.submitPayment({
      quote_id: `q_${"f".repeat(24)}`,
      payload: { payment_signature: "MOCK.x", payer_account_id: PAYER, scheme: "exact", network: "hedera:testnet" },
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: `ppd_${"a".repeat(24)}`,
      nonce: "n_unknown_0001",
    });
    assert.equal(paid.code, "UNKNOWN_QUOTE");
  });
});

describe("settlement is the gate — verify is not paid", () => {
  async function runWith(adapterOpts: Record<string, unknown>) {
    const clock = fixedClock(T0);
    const adapter = new MockHederaX402Adapter(PAYER, { clock, ...adapterOpts });
    const signer = testSigner();
    const flow = new GovernedFlow({ offer: OFFER, policy: testPolicy(), adapter, signer, clock });
    const pre = flow.preflight(preflightArgs());
    const paid = await flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_settle_0001",
    });
    return { paid, flow };
  }

  test("an amount that does not match the quote blocks delivery", async () => {
    const { paid, flow } = await runWith({ overrideObservedAmount: "1" });
    assert.equal(paid.httpStatus, 402);
    assert.match(paid.code, /^SETTLEMENT_UNVERIFIED:amount_mismatch$/);
    assert.equal(paid.result, undefined, "no work may be released");
    assert.equal(flow.ledger.snapshot(Date.parse(T0)).cumulative_atomic, "0", "an unverified payment must not be booked");
  });

  test("a transfer to the wrong account blocks delivery", async () => {
    const { paid } = await runWith({ overrideObservedPayee: "0.0.111111" });
    assert.equal(paid.code, "SETTLEMENT_UNVERIFIED:payee_mismatch");
    assert.equal(paid.result, undefined);
  });

  test("a payment whose memo is not bound to the quote blocks delivery", async () => {
    const { paid } = await runWith({ overrideObservedMemo: null });
    assert.equal(paid.code, "SETTLEMENT_UNVERIFIED:memo_not_bound_to_quote");
    assert.equal(paid.result, undefined, "a payment bound to nothing buys nothing");
  });

  test("a non-final settlement blocks delivery", async () => {
    const { paid } = await runWith({ forceFinality: "PENDING" });
    assert.equal(paid.httpStatus, 402);
    assert.equal(paid.result, undefined);
  });
});

describe("replay and idempotency", () => {
  test("presenting the same quote twice returns the stored result — it does not execute again", async () => {
    const h = makeHarness();
    const pre = h.flow.preflight(preflightArgs());
    const args = {
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_idem_0001",
    };

    const first = await h.flow.submitPayment(args);
    const second = await h.flow.submitPayment(args);

    assert.equal(first.code, "DELIVERED");
    assert.equal(second.code, "IDEMPOTENT_REPLAY");
    assert.equal(second.idempotent_replay, true);
    assert.equal(second.receipt!.receipt_id, first.receipt!.receipt_id, "one purchase, one receipt");
    assert.deepEqual(second.result, first.result);
    assert.equal(
      h.flow.ledger.snapshot(Date.parse(T0)).cumulative_atomic,
      OFFER.atomic_amount,
      "the payer is charged once, not twice",
    );
  });

  test("a transaction that already released work cannot release it again under a new quote", async () => {
    // Same on-chain transaction, two different quotes: the textbook replay.
    const FIXED_TX = `${PAYER}@1000000123.000000456`;
    const h = makeHarness({ adapter: { fixedTransactionId: FIXED_TX } });

    const preA = h.flow.preflight(preflightArgs());
    await h.flow.submitPayment({
      quote_id: preA.quote!.quote_id,
      payload: h.adapter.mockSign(preA.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: preA.quote!.decision_id,
      nonce: "n_replay_first",
    });

    // A second quote for the same purchase, settled by the SAME transaction.
    const preB = h.flow.preflight(preflightArgs());
    const replayed = await h.flow.submitPayment({
      quote_id: preB.quote!.quote_id,
      payload: h.adapter.mockSign(preB.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: preB.quote!.decision_id,
      nonce: "n_replay_second",
    });

    assert.equal(replayed.httpStatus, 409);
    assert.match(replayed.code, /^TRANSACTION_REPLAY:consumed$/);
    assert.equal(replayed.result, undefined);
  });
});

describe("spend caps are enforced across purchases", () => {
  test("the cumulative cap denies the purchase that would breach it", async () => {
    // Cap allows exactly one 5,000,000 payment.
    const h = makeHarness({ policy: { max_atomic_cumulative: "9000000" } });

    const pre1 = h.flow.preflight(preflightArgs());
    assert.equal(pre1.httpStatus, 402);
    const paid = await h.flow.submitPayment({
      quote_id: pre1.quote!.quote_id,
      payload: h.adapter.mockSign(pre1.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre1.quote!.decision_id,
      nonce: "n_cap_0001",
    });
    assert.equal(paid.code, "DELIVERED");

    const pre2 = h.flow.preflight(preflightArgs());
    assert.equal(pre2.httpStatus, 403, "the cap must bite BEFORE a second challenge is issued");
    assert.equal((pre2.decision_receipt.record as any).decision_code, "DENY_CUMULATIVE_CAP");
  });

  test("the per-UTC-day count cap denies the next purchase", async () => {
    const h = makeHarness({ policy: { max_payments_per_utc_day: 1 } });
    const pre1 = h.flow.preflight(preflightArgs());
    await h.flow.submitPayment({
      quote_id: pre1.quote!.quote_id,
      payload: h.adapter.mockSign(pre1.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre1.quote!.decision_id,
      nonce: "n_daily_0001",
    });
    assert.equal((h.flow.preflight(preflightArgs()).decision_receipt.record as any).decision_code, "DENY_DAILY_COUNT_CAP");
  });
});

describe("anchoring never gates delivery", () => {
  test("a successful anchor is attached and matches the receipt digest", async () => {
    const h = makeHarness();
    const pre = h.flow.preflight(preflightArgs());
    const paid = await h.flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_anchor_0001",
      anchor: true,
    });
    assert.equal(paid.receipt!.anchor!.status, "ANCHORED");
    assert.equal(paid.receipt!.anchor!.anchored_digest, paid.receipt!.record_digest);
    assert.equal(paid.receipt!.anchor!.topic_id, DEMO_TOPIC);
    assert.equal(verifyProofOfActionReceipt(paid.receipt!, { trustedKeys: h.trustedKeys }).ok, true);
  });

  test("a FAILED anchor leaves the receipt valid and the delivery intact", async () => {
    const clock = fixedClock(T0);
    const adapter = new MockHederaX402Adapter(PAYER, { clock });
    const signer = testSigner();
    const flow = new GovernedFlow({
      offer: OFFER,
      policy: testPolicy(),
      adapter,
      signer,
      anchor: new MockHcsAnchor({ clock, forceStatus: "FAILED" }),
      anchorTopicId: DEMO_TOPIC,
      clock,
    });
    const pre = flow.preflight(preflightArgs());
    const paid = await flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_anchorfail_0001",
      anchor: true,
    });

    assert.equal(paid.code, "DELIVERED", "work that already happened is not undone by a failed anchor");
    assert.equal(paid.receipt!.anchor!.status, "FAILED");
    assert.equal(
      verifyProofOfActionReceipt(paid.receipt!, { trustedKeys: { [signer.kid]: signer.publicKeyHex } }).ok,
      true,
      "the receipt stands on its signature, not on the anchor",
    );
  });
});

describe("the receipt never carries payload content", () => {
  test("neither the request subject nor the result text appears anywhere in the receipt", async () => {
    const h = makeHarness();
    const pre = h.flow.preflight(preflightArgs());
    const paid = await h.flow.submitPayment({
      quote_id: pre.quote!.quote_id,
      payload: h.adapter.mockSign(pre.quote!),
      request_body: REQUEST_BODY,
      agent_identity: AGENT_IDENTITY as any,
      authority_scope: authorityScope() as any,
      decision_id: pre.quote!.decision_id,
      nonce: "n_privacy_0001",
      anchor: true,
    });

    const serialized = JSON.stringify(paid.receipt);
    assert.ok(!serialized.includes(REQUEST_BODY.subject), "the request subject must not leak into the receipt");
    for (const c of paid.result!.checks) {
      assert.ok(!serialized.includes(c.basis), "result content must not leak into the receipt");
    }
    assert.equal(paid.receipt!.record.payee, PAYEE);
  });
});
