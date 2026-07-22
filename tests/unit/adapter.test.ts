import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  issueQuote,
  createPaymentChallenge,
  checkQuoteExpiry,
  buildHashScanLinks,
  hashscanTxSlug,
  MockHederaX402Adapter,
  mockTransactionId,
  HASHSCAN_TESTNET,
  MIRROR_TESTNET,
} from "../../packages/hedera-x402-adapter/src/index.ts";
import { fixedClock, canonicalDigest, assertValid, PAYMENT_CHALLENGE_SCHEMA } from "../../packages/shared-schemas/src/index.ts";
import { OFFER, PAYER, PAYEE, T0 } from "../helpers/fixtures.ts";

const clock = fixedClock(T0);
const REQ_HASH = canonicalDigest({ subject: "x", checks: ["a"] });

function quote(over: Record<string, unknown> = {}) {
  return issueQuote({
    offer: { ...OFFER, ...over } as any,
    request_hash: REQ_HASH,
    nonce: "n_adapter_0001",
    payer_account_id: PAYER,
    decision_id: `ppd_${"a".repeat(24)}`,
    clock,
  });
}

describe("quote issuance", () => {
  test("the same inputs always produce the same quote id and idempotency key", () => {
    const a = quote();
    const b = quote();
    assert.equal(a.quote_id, b.quote_id);
    assert.equal(a.idempotency_key, b.idempotency_key);
    assert.match(a.quote_id, /^q_[0-9a-f]{24}$/);
    assert.match(a.idempotency_key, /^idem_[0-9a-f]{32}$/);
  });

  test("a different request hash produces a different quote and key", () => {
    const other = issueQuote({
      offer: OFFER as any,
      request_hash: canonicalDigest({ different: true }),
      nonce: "n_adapter_0001",
      payer_account_id: PAYER,
      decision_id: `ppd_${"a".repeat(24)}`,
      clock,
    });
    assert.notEqual(other.quote_id, quote().quote_id);
    assert.notEqual(other.idempotency_key, quote().idempotency_key);
  });

  test("a different payer produces a different idempotency key for the same quote inputs", () => {
    const other = issueQuote({
      offer: OFFER as any,
      request_hash: REQ_HASH,
      nonce: "n_adapter_0001",
      payer_account_id: "0.0.999009",
      decision_id: `ppd_${"a".repeat(24)}`,
      clock,
    });
    assert.equal(other.quote_id, quote().quote_id, "the quote itself does not depend on who pays");
    assert.notEqual(other.idempotency_key, quote().idempotency_key, "but the execution key does");
  });

  test("the quote hash recomputes from the quote's own core fields", () => {
    const q = quote();
    const core = {
      offer_id: q.offer_id,
      resource_url: q.resource_url,
      http_method: q.http_method,
      network: q.network,
      asset: q.asset,
      atomic_amount: q.atomic_amount,
      pay_to: q.pay_to,
      request_hash: q.request_hash,
      quote_id: q.quote_id,
      issued_at: q.issued_at,
      expires_at: q.expires_at,
    };
    assert.equal(canonicalDigest(core), q.quote_hash);
  });

  test("expiry is issued_at + ttl", () => {
    const q = quote();
    assert.equal(q.issued_at, T0);
    assert.equal(q.expires_at, "2026-07-22T12:03:00Z");
  });
});

describe("payment challenge", () => {
  test("the challenge validates against its schema", () => {
    assert.doesNotThrow(() => assertValid(createPaymentChallenge(quote()), PAYMENT_CHALLENGE_SCHEMA));
  });

  test("the memo carries the quote id — this is the on-chain request binding", () => {
    const c = createPaymentChallenge(quote());
    assert.equal(c.accepts[0].memo, c.nomos.quote_id);
  });

  test("the challenge never advertises a non-testnet network", () => {
    assert.equal(createPaymentChallenge(quote()).accepts[0].network, "hedera:testnet");
  });

  test("the challenge carries no key material", () => {
    const s = JSON.stringify(createPaymentChallenge(quote())).toLowerCase();
    // "key" alone is a false positive — `idempotency_key` is a legitimate field
    // name. What must never appear is anything naming actual secret material.
    for (const bad of ["private", "secret", "mnemonic", "seed", "privatekey", "signingkey"]) {
      assert.ok(!s.includes(bad), `challenge must not mention "${bad}"`);
    }
  });

  test("the challenge contains no long hex blobs other than sha256 digests", () => {
    const c = createPaymentChallenge(quote());
    const hexRuns = JSON.stringify(c).match(/[0-9a-f]{40,}/g) ?? [];
    const digestBodies = new Set([c.nomos.quote_hash, c.nomos.request_hash].map((d) => d.split(":")[1]));
    for (const run of hexRuns) {
      assert.ok(digestBodies.has(run), `unexpected ${run.length}-char hex run in the challenge`);
    }
  });
});

describe("quote expiry — server clock only", () => {
  test("fresh before expiry", () => {
    assert.equal(checkQuoteExpiry(quote(), fixedClock("2026-07-22T12:02:59Z")).expired, false);
  });

  test("expired one second past", () => {
    const v = checkQuoteExpiry(quote(), fixedClock("2026-07-22T12:03:01Z"));
    assert.equal(v.expired, true);
    assert.equal(v.reason, "QUOTE_EXPIRED");
  });

  test("exactly at the boundary is still fresh", () => {
    assert.equal(checkQuoteExpiry(quote(), fixedClock("2026-07-22T12:03:00Z")).expired, false);
  });

  test("an unparsable expiry fails closed", () => {
    assert.equal(checkQuoteExpiry({ ...quote(), expires_at: "never" } as any, clock).expired, true);
  });
});

describe("HashScan link construction", () => {
  test("a transaction id is converted to HashScan's dashed slug", () => {
    assert.equal(hashscanTxSlug("0.0.1234@1700000000.123456789"), "0.0.1234-1700000000-123456789");
  });

  test("a malformed transaction id throws rather than producing a broken link", () => {
    for (const bad of ["0.0.1234", "0.0.1234@1700000000", "@1.2", "x@1.2"]) {
      assert.throws(() => hashscanTxSlug(bad), /MALFORMED_TRANSACTION_ID/);
    }
  });

  test("links are testnet by construction", () => {
    const l = buildHashScanLinks({ transaction_id: "0.0.1234@1700000000.000000001" });
    assert.ok(l.transaction.startsWith(`${HASHSCAN_TESTNET}/`));
    assert.ok(l.mirror_transaction.startsWith(`${MIRROR_TESTNET}/`));
    assert.ok(!l.transaction.includes("mainnet"));
  });

  test("topic links appear only when a topic is supplied", () => {
    const without = buildHashScanLinks({ transaction_id: "0.0.1234@1700000000.000000001" });
    assert.equal(without.topic, undefined);
    const with_ = buildHashScanLinks({ transaction_id: "0.0.1234@1700000000.000000001", topic_id: "0.0.999200", sequence_number: 5 });
    assert.equal(with_.topic_message, `${HASHSCAN_TESTNET}/topic/0.0.999200/message/5`);
    assert.equal(with_.mirror_topic_message, `${MIRROR_TESTNET}/topics/0.0.999200/messages/5`);
  });

  test("the account link defaults to the transaction payer", () => {
    assert.equal(
      buildHashScanLinks({ transaction_id: "0.0.1234@1700000000.000000001" }).account,
      `${HASHSCAN_TESTNET}/account/0.0.1234`,
    );
  });
});

describe("mock adapter — honest labelling", () => {
  test("every settlement it produces is stamped MOCK_OFFLINE", async () => {
    const a = new MockHederaX402Adapter(PAYER, { clock });
    const q = quote();
    const ev = await a.verifySettlementViaMirrorNode({
      transaction_id: mockTransactionId(PAYER, q.quote_id),
      expected_network: "hedera:testnet",
      expected_asset: "HBAR",
      expected_atomic_amount: q.atomic_amount,
      expected_payee: PAYEE,
      expected_memo: q.quote_id,
    });
    assert.equal(ev.source, "MOCK_OFFLINE");
  });

  test("a mock transaction id is deterministic and obviously synthetic", () => {
    const id = mockTransactionId(PAYER, "q_abc");
    assert.equal(id, mockTransactionId(PAYER, "q_abc"));
    const secs = Number(id.split("@")[1].split(".")[0]);
    assert.ok(secs < 1_001_000_000, "mock timestamps stay in a range no real network ever used");
  });

  test("the mock signature contains no key-like material", () => {
    const a = new MockHederaX402Adapter(PAYER, { clock });
    const p = a.mockSign(quote());
    assert.ok(p.payment_signature.startsWith("MOCK."));
    assert.equal(p.payment_signature.length, 5 + 32);
  });
});

describe("mock adapter — settlement mismatch detection", () => {
  const q = quote();
  const baseQuery = {
    transaction_id: mockTransactionId(PAYER, q.quote_id),
    expected_network: "hedera:testnet" as const,
    expected_asset: "HBAR",
    expected_atomic_amount: q.atomic_amount,
    expected_payee: PAYEE,
    expected_memo: q.quote_id,
  };

  test("a matching transfer verifies", async () => {
    const ev = await new MockHederaX402Adapter(PAYER, { clock }).verifySettlementViaMirrorNode(baseQuery);
    assert.equal(ev.verified, true);
    assert.equal(ev.finality, "FINAL");
    assert.equal(ev.failure_code, null);
  });

  test("a wrong amount is caught", async () => {
    const a = new MockHederaX402Adapter(PAYER, { clock, overrideObservedAmount: "1" });
    const ev = await a.verifySettlementViaMirrorNode(baseQuery);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "amount_mismatch");
  });

  test("a transfer to the wrong account is caught", async () => {
    const a = new MockHederaX402Adapter(PAYER, { clock, overrideObservedPayee: "0.0.111111" });
    const ev = await a.verifySettlementViaMirrorNode(baseQuery);
    assert.equal(ev.failure_code, "payee_mismatch");
  });

  test("a payment with no memo is a payment bound to nothing", async () => {
    const a = new MockHederaX402Adapter(PAYER, { clock, overrideObservedMemo: null });
    const ev = await a.verifySettlementViaMirrorNode(baseQuery);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "memo_not_bound_to_quote");
  });

  test("a memo for someone else's quote is caught", async () => {
    const a = new MockHederaX402Adapter(PAYER, { clock, overrideObservedMemo: "q_someone_elses_quote" });
    assert.equal((await a.verifySettlementViaMirrorNode(baseQuery)).failure_code, "memo_not_bound_to_quote");
  });

  test("a non-final settlement is not verified", async () => {
    const a = new MockHederaX402Adapter(PAYER, { clock, forceFinality: "PENDING" });
    const ev = await a.verifySettlementViaMirrorNode(baseQuery);
    assert.equal(ev.verified, false);
    assert.equal(ev.finality, "PENDING");
  });
});
