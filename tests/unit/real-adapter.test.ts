/**
 * Offline tests for the REAL Hedera adapter and mirror-node verifier.
 *
 * No network: `fetch` is stubbed per test. These cover exactly the comparisons
 * that decide whether a payment counts — amount, payee, memo, consensus result,
 * network — plus the propagation behaviour that decides whether a slow index
 * looks like a missing payment (it must not).
 *
 * Nothing here imports the Hedera SDK, so the suite still runs with
 * `node_modules` deleted.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  RealHederaX402Adapter,
  RealAdapterError,
  toPaymentRequirements,
  encodePaymentHeader,
  decodePaymentHeader,
  TESTNET,
} from "../../packages/hedera-x402-adapter/src/real-adapter.ts";
import {
  toMirrorTxId,
  decodeMemo,
  netHbarForAccount,
  netTokenForAccount,
  fetchTransaction,
  MirrorNodeError,
  type MirrorTransaction,
} from "../../packages/hedera-x402-adapter/src/mirror.ts";
import { HBAR_ASSET_ID } from "../../packages/hedera-x402-adapter/src/interfaces.ts";
import { fixedClock } from "../../packages/shared-schemas/src/index.ts";
import { T0, PAYEE, PAYER } from "../helpers/fixtures.ts";

const FEE_PAYER = "0.0.7162784";
const QUOTE_ID = `q_${"a".repeat(24)}`;
const TX_ID = `${FEE_PAYER}@1785000000.000000001`;

const QUOTE = {
  quote_id: QUOTE_ID,
  quote_hash: `sha256:${"1".repeat(64)}`,
  request_hash: `sha256:${"2".repeat(64)}`,
  idempotency_key: `idem_${"c".repeat(32)}`,
  decision_id: `ppd_${"d".repeat(24)}`,
  offer_id: "evidence.basic.v1",
  resource_url: "http://127.0.0.1:4402/v1/evidence",
  http_method: "POST",
  network: TESTNET as "hedera:testnet",
  asset: "HBAR",
  atomic_amount: "5000000",
  pay_to: PAYEE,
  issued_at: T0,
  expires_at: "2026-07-22T12:03:00Z",
  max_timeout_seconds: 180,
};

function mirrorTx(over: Partial<MirrorTransaction> = {}): MirrorTransaction {
  return {
    transaction_id: TX_ID.replace("@", "-").replace(/\.(\d+)$/, "-$1"),
    consensus_timestamp: "1785000001.123456789",
    result: "SUCCESS",
    name: "CRYPTOTRANSFER",
    charged_tx_fee: 123456,
    memo_base64: Buffer.from(QUOTE_ID, "utf8").toString("base64"),
    transfers: [
      { account: PAYER, amount: -5_000_000 },
      { account: PAYEE, amount: 5_000_000 },
      { account: FEE_PAYER, amount: -123_456 },
    ],
    ...over,
  };
}

/** Install a fetch stub that answers the mirror transaction endpoint. */
function stubFetch(handler: (url: string) => { status: number; body: unknown }): void {
  (globalThis as any).fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const { status, body } = handler(url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
      headers: new Map(),
    } as unknown as Response;
  };
}

const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

describe("payment requirements mapping", () => {
  test("HBAR maps to asset 0.0.0 — x402's identifier for the native coin", () => {
    const req = toPaymentRequirements(QUOTE, FEE_PAYER);
    assert.equal(req.asset, HBAR_ASSET_ID);
    assert.equal(req.amount, "5000000");
    assert.equal(req.scheme, "exact");
    assert.equal(req.network, TESTNET);
    assert.equal(req.payTo, PAYEE);
    assert.equal(req.extra.feePayer, FEE_PAYER);
  });

  test("an HTS token id passes through unchanged", () => {
    assert.equal(toPaymentRequirements({ ...QUOTE, asset: "0.0.429274" }, FEE_PAYER).asset, "0.0.429274");
  });

  test("a non-testnet quote cannot produce requirements at all", () => {
    assert.throws(
      () => toPaymentRequirements({ ...QUOTE, network: "hedera:mainnet" as never }, FEE_PAYER),
      (e: unknown) => {
        assert.equal((e as RealAdapterError).code, "NETWORK_NOT_TESTNET");
        return true;
      },
    );
  });
});

describe("payment header encoding", () => {
  test("round-trips", () => {
    const payload = { x402Version: 2, scheme: "exact", network: TESTNET, payload: { transaction: "AAAA" } };
    assert.deepEqual(decodePaymentHeader(encodePaymentHeader(payload)), payload);
  });

  test("garbage fails loudly rather than yielding an empty object", () => {
    assert.throws(() => decodePaymentHeader("not-base64-json"), /PAYLOAD_UNDECODABLE|payment-signature/);
  });
});

describe("facilitator capability discovery", () => {
  const supported = {
    kinds: [
      { x402Version: 2, scheme: "exact", network: "eip155:80002" },
      { x402Version: 2, scheme: "exact", network: TESTNET, extra: { feePayer: FEE_PAYER } },
    ],
  };

  test("picks the hedera:testnet exact fee payer", () => {
    assert.equal(RealHederaX402Adapter.feePayerFromSupported(supported), FEE_PAYER);
  });

  test("refuses when hedera:testnet is not advertised", () => {
    assert.throws(
      () => RealHederaX402Adapter.feePayerFromSupported({ kinds: [supported.kinds[0]] }),
      (e: unknown) => {
        assert.equal((e as RealAdapterError).code, "FEE_PAYER_UNAVAILABLE");
        return true;
      },
    );
  });

  test("refuses a malformed fee payer rather than passing it to a signer", () => {
    assert.throws(() =>
      RealHederaX402Adapter.feePayerFromSupported({
        kinds: [{ x402Version: 2, scheme: "exact", network: TESTNET, extra: { feePayer: "0xdeadbeef" } }],
      }),
    );
  });
});

describe("mirror node helpers", () => {
  test("transaction ids convert to the mirror path form", () => {
    assert.equal(toMirrorTxId("0.0.7162784@1785000000.000000001"), "0.0.7162784-1785000000-000000001");
  });

  test("a malformed id throws instead of producing a wrong URL", () => {
    assert.throws(() => toMirrorTxId("0.0.7162784"), MirrorNodeError);
  });

  test("the memo is decoded from base64", () => {
    assert.equal(decodeMemo(mirrorTx()), QUOTE_ID);
  });

  test("an absent or empty memo decodes to null, not an empty string", () => {
    assert.equal(decodeMemo(mirrorTx({ memo_base64: null })), null);
    assert.equal(decodeMemo(mirrorTx({ memo_base64: "" })), null);
  });

  test("net movement SUMS all rows for an account", () => {
    // A transaction can touch the same account twice. Reading only the first
    // row is how an amount check gets quietly fooled.
    const tx = mirrorTx({
      transfers: [
        { account: PAYEE, amount: 3_000_000 },
        { account: PAYEE, amount: 2_000_000 },
        { account: PAYER, amount: -5_000_000 },
      ],
    });
    assert.equal(netHbarForAccount(tx, PAYEE), 5_000_000n);
    assert.equal(netHbarForAccount(tx, PAYER), -5_000_000n);
    assert.equal(netHbarForAccount(tx, "0.0.404"), 0n);
  });

  test("token movement is filtered by token id", () => {
    const tx = mirrorTx({
      token_transfers: [
        { token_id: "0.0.111", account: PAYEE, amount: 7 },
        { token_id: "0.0.222", account: PAYEE, amount: 9 },
      ],
    });
    assert.equal(netTokenForAccount(tx, "0.0.111", PAYEE), 7n);
    assert.equal(netTokenForAccount(tx, "0.0.999", PAYEE), 0n);
  });
});

describe("mirror node propagation", () => {
  test("retries while the index is behind, then succeeds", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls < 3 ? { status: 404, body: {} } : { status: 200, body: { transactions: [mirrorTx()] } };
    });
    const tx = await fetchTransaction(TX_ID, { attempts: 5, delayMs: 0, sleep: async () => {} });
    assert.ok(tx);
    assert.equal(calls, 3);
  });

  test("returns null — not an error — when the budget runs out", async () => {
    stubFetch(() => ({ status: 404, body: {} }));
    const tx = await fetchTransaction(TX_ID, { attempts: 3, delayMs: 0, sleep: async () => {} });
    assert.equal(tx, null, "a slow index must not look like a failed payment");
  });

  test("a non-404 error surfaces immediately instead of burning the retry budget", async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return { status: 500, body: {} };
    });
    await assert.rejects(
      fetchTransaction(TX_ID, { attempts: 5, delayMs: 0, sleep: async () => {} }),
      MirrorNodeError,
    );
    assert.equal(calls, 1);
  });
});

describe("settlement verification against the public record", () => {
  function adapter(): RealHederaX402Adapter {
    return new RealHederaX402Adapter({
      facilitatorUrl: "https://facilitator.invalid",
      feePayer: FEE_PAYER,
      resourceUrl: QUOTE.resource_url,
      clock: fixedClock(T0),
      mirrorLookup: { attempts: 1, delayMs: 0, sleep: async () => {} },
    });
  }

  const query = {
    transaction_id: TX_ID,
    expected_network: TESTNET as "hedera:testnet",
    expected_asset: "HBAR",
    expected_atomic_amount: "5000000",
    expected_payee: PAYEE,
    expected_memo: QUOTE_ID,
  };

  test("a correct transfer verifies as FINAL and is labelled MIRROR_NODE", async () => {
    stubFetch(() => ({ status: 200, body: { transactions: [mirrorTx()] } }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.source, "MIRROR_NODE", "real settlement must never be labelled a mock");
    assert.equal(ev.verified, true);
    assert.equal(ev.finality, "FINAL");
    assert.equal(ev.atomic_amount, "5000000");
    assert.equal(ev.payee, PAYEE);
    assert.equal(ev.payer, PAYER, "the payer is derived from the ledger, not taken from the facilitator");
    assert.equal(ev.memo, QUOTE_ID);
    assert.equal(ev.failure_code, null);
  });

  test("a short payment is caught", async () => {
    stubFetch(() => ({
      status: 200,
      body: { transactions: [mirrorTx({ transfers: [{ account: PAYER, amount: -1 }, { account: PAYEE, amount: 1 }] })] },
    }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "amount_mismatch");
  });

  test("a transfer to somebody else is caught", async () => {
    stubFetch(() => ({
      status: 200,
      body: {
        transactions: [
          mirrorTx({ transfers: [{ account: PAYER, amount: -5_000_000 }, { account: "0.0.111111", amount: 5_000_000 }] }),
        ],
      },
    }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "amount_mismatch", "the payee received nothing");
  });

  test("a payment with NO memo buys nothing — it is bound to no request", async () => {
    stubFetch(() => ({ status: 200, body: { transactions: [mirrorTx({ memo_base64: null })] } }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "memo_not_bound_to_quote");
  });

  test("a payment carrying someone else's quote id is caught", async () => {
    stubFetch(() => ({
      status: 200,
      body: { transactions: [mirrorTx({ memo_base64: Buffer.from("q_someone_elses").toString("base64") })] },
    }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.failure_code, "memo_not_bound_to_quote");
  });

  test("a transaction that reached consensus with a failure is not a settlement", async () => {
    stubFetch(() => ({ status: 200, body: { transactions: [mirrorTx({ result: "INSUFFICIENT_ACCOUNT_BALANCE" })] } }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "consensus_result_insufficient_account_balance");
  });

  test("an unindexed transaction is PENDING, never verified and never FAILED", async () => {
    stubFetch(() => ({ status: 404, body: {} }));
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.finality, "PENDING");
    assert.equal(ev.failure_code, "not_yet_indexed");
  });

  test("a non-testnet query is refused before any lookup", async () => {
    let called = false;
    stubFetch(() => {
      called = true;
      return { status: 200, body: { transactions: [mirrorTx()] } };
    });
    const ev = await adapter().verifySettlementViaMirrorNode({ ...query, expected_network: "hedera:mainnet" as never });
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "network_not_testnet");
    assert.equal(called, false, "mainnet must not even be queried");
  });
});

describe("dry run stops at the last free moment", () => {
  test("settle refuses without contacting the facilitator", async () => {
    let posted = false;
    stubFetch(() => {
      posted = true;
      return { status: 200, body: { success: true, transaction: TX_ID } };
    });
    const a = new RealHederaX402Adapter({
      facilitatorUrl: "https://facilitator.invalid",
      feePayer: FEE_PAYER,
      resourceUrl: QUOTE.resource_url,
      clock: fixedClock(T0),
      dryRun: true,
    });
    const res = await a.settlePayment(
      { payment_signature: encodePaymentHeader({ payload: { transaction: "AA" } }), payer_account_id: PAYER, scheme: "exact", network: TESTNET },
      QUOTE,
    );
    assert.equal(res.settled, false);
    assert.deepEqual(res.reasons, ["dry_run_stop_before_settle"]);
    assert.equal(posted, false, "a dry run must not reach /settle at all");
  });
});
