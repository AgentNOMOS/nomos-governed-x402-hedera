/**
 * Regression: mirror-node child records must not be mistaken for the payment.
 *
 * This test exists because of a real failure. The first genuine testnet payment
 * moved exactly 0.05 HBAR to the right account with the right memo — and the
 * verifier rejected it with `amount_mismatch`, because `GET /transactions/{id}`
 * returned three records and the code read the first one.
 *
 * When a transfer triggers Hedera auto-account creation, the network emits child
 * records under the SAME transaction id: a CRYPTOCREATEACCOUNT for the new
 * account, and — if the payer was a hollow account — a CRYPTOUPDATEACCOUNT that
 * completes it. Those children carry no memo and no user transfers, and on the
 * live network they sorted ahead of the transfer.
 *
 * The fixture below is the actual response shape from transaction
 * 0.0.7162784@1784746988.798231156, with account ids preserved because they are
 * public testnet facts.
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  selectUserTransaction,
  fetchTransaction,
  decodeMemo,
  netHbarForAccount,
  type MirrorTransaction,
} from "../../packages/hedera-x402-adapter/src/mirror.ts";
import { RealHederaX402Adapter, TESTNET } from "../../packages/hedera-x402-adapter/src/real-adapter.ts";
import { fixedClock } from "../../packages/shared-schemas/src/index.ts";
import { T0 } from "../helpers/fixtures.ts";

const TX_ID = "0.0.7162784@1784746988.798231156";
const PAYER = "0.0.9689846";
const PAYEE = "0.0.9689904";
const PAYEE_ALIAS = "0x98eca0a3f742ddc7791fc64b9cb2e226340607d5";
const QUOTE_ID = "q_6eb0be075ceaee4b92d86575";
const FEE_PAYER = "0.0.7162784";

/** The real three-record group, in the order the mirror node returned it. */
const GROUP: MirrorTransaction[] = [
  {
    transaction_id: "0.0.7162784-1784746988-798231156",
    consensus_timestamp: "1784746993.237232766",
    result: "SUCCESS",
    name: "CRYPTOUPDATEACCOUNT", // hollow-account completion
    nonce: 1,
    charged_tx_fee: 0,
    memo_base64: null,
    transfers: [],
  },
  {
    transaction_id: "0.0.7162784-1784746988-798231156",
    consensus_timestamp: "1784746993.237232767",
    result: "SUCCESS",
    name: "CRYPTOCREATEACCOUNT", // the payee, auto-created
    nonce: 2,
    charged_tx_fee: 69_129_520,
    memo_base64: null,
    transfers: [
      { account: "0.0.802", amount: 69_129_520 },
      { account: FEE_PAYER, amount: -69_129_520 },
    ],
  },
  {
    transaction_id: "0.0.7162784-1784746988-798231156",
    consensus_timestamp: "1784746993.237232768",
    result: "SUCCESS",
    name: "CRYPTOTRANSFER", // ← the payment
    nonce: 0,
    charged_tx_fee: 276_517,
    memo_base64: Buffer.from(QUOTE_ID, "utf8").toString("base64"),
    transfers: [
      { account: "0.0.802", amount: 276_517 },
      { account: FEE_PAYER, amount: -276_517 },
      { account: PAYER, amount: -5_000_000 },
      { account: PAYEE, amount: 5_000_000 },
    ],
  },
];

const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

function stub(routes: { tx?: unknown; account?: unknown | null }): void {
  (globalThis as any).fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const body = url.includes("/accounts/") ? routes.account : routes.tx;
    const status = body === null || body === undefined ? 404 : 200;
    return { ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
  };
}

describe("selecting the user transaction out of a child-record group", () => {
  test("picks the CRYPTOTRANSFER, not the first entry", () => {
    const picked = selectUserTransaction(GROUP);
    assert.ok(picked);
    assert.equal(picked!.name, "CRYPTOTRANSFER");
    assert.equal(picked!.nonce, 0);
    assert.notEqual(picked, GROUP[0], "reading transactions[0] is precisely the bug this guards");
  });

  test("the selected record carries the memo and the user transfers", () => {
    const picked = selectUserTransaction(GROUP)!;
    assert.equal(decodeMemo(picked), QUOTE_ID);
    assert.equal(netHbarForAccount(picked, PAYEE), 5_000_000n);
    assert.equal(netHbarForAccount(picked, PAYER), -5_000_000n);
  });

  test("the first entry would have produced exactly the observed failure", () => {
    // Documents the wrong behaviour so the regression is unmistakable.
    assert.equal(decodeMemo(GROUP[0]), null);
    assert.equal(netHbarForAccount(GROUP[0], PAYEE), 0n);
  });

  test("a single-record group still works", () => {
    assert.equal(selectUserTransaction([GROUP[2]])!.name, "CRYPTOTRANSFER");
  });

  test("a group with no nonce field falls back to the transfer", () => {
    const noNonce = GROUP.map(({ nonce, ...rest }) => rest as MirrorTransaction);
    assert.equal(selectUserTransaction(noNonce)!.name, "CRYPTOTRANSFER");
  });

  test("an empty or unusable group returns null rather than guessing", () => {
    assert.equal(selectUserTransaction([]), null);
    assert.equal(selectUserTransaction([{ ...GROUP[0], nonce: 3 }]), null);
  });

  test("fetchTransaction returns the transfer, not the first record", async () => {
    stub({ tx: { transactions: GROUP } });
    const tx = await fetchTransaction(TX_ID, { attempts: 1, delayMs: 0, sleep: async () => {} });
    assert.equal(tx!.name, "CRYPTOTRANSFER");
  });
});

describe("end-to-end settlement verification against the real record group", () => {
  const adapter = () =>
    new RealHederaX402Adapter({
      facilitatorUrl: "https://facilitator.invalid",
      feePayer: FEE_PAYER,
      resourceUrl: "http://127.0.0.1:4402/v1/evidence",
      clock: fixedClock(T0),
      mirrorLookup: { attempts: 1, delayMs: 0, sleep: async () => {} },
    });

  const createdPayee = {
    account: PAYEE,
    balance: { balance: 5_000_000, timestamp: "1784746993.237232768" },
    deleted: false,
    evm_address: PAYEE_ALIAS,
    key: { _type: "ECDSA_SECP256K1", key: "03c823e879272077478ccb0098b01bd4b96401938d5cf7de23382b89b2f244f6b2" },
  };

  test("the real payment verifies once the right record is selected", async () => {
    stub({ tx: { transactions: GROUP }, account: createdPayee });
    const ev = await adapter().verifySettlementViaMirrorNode({
      transaction_id: TX_ID,
      expected_network: TESTNET as "hedera:testnet",
      expected_asset: "HBAR",
      expected_atomic_amount: "5000000",
      expected_payee: PAYEE_ALIAS,
      expected_memo: QUOTE_ID,
    });

    assert.equal(ev.verified, true);
    assert.equal(ev.finality, "FINAL");
    assert.equal(ev.source, "MIRROR_NODE");
    assert.equal(ev.payer, PAYER);
    assert.equal(ev.payee, PAYEE);
    assert.equal(ev.atomic_amount, "5000000");
    assert.equal(ev.memo, QUOTE_ID);
    assert.equal(ev.failure_code, null);
  });

  test("the facilitator's fee row does not get mistaken for the payer", async () => {
    // The fee payer is debited too. Only an account debited by at least the
    // transfer amount counts, which is why 0.0.7162784 (-276,517) is not it.
    stub({ tx: { transactions: GROUP }, account: createdPayee });
    const ev = await adapter().verifySettlementViaMirrorNode({
      transaction_id: TX_ID,
      expected_network: TESTNET as "hedera:testnet",
      expected_asset: "HBAR",
      expected_atomic_amount: "5000000",
      expected_payee: PAYEE_ALIAS,
      expected_memo: QUOTE_ID,
    });
    assert.equal(ev.payer, PAYER);
    assert.notEqual(ev.payer, FEE_PAYER);
  });
});
