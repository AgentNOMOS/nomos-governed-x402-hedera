/**
 * Offline tests for the EVM-alias payee path (Hedera auto-account creation).
 *
 * The relaxation is narrow and these tests pin its edges: an alias is accepted
 * ONLY in the offer/quote/challenge, never in a receipt; and settlement against
 * an alias only verifies once the alias resolves to an account whose EVM address
 * matches. Everything else — amount, memo, consensus result — is unchanged.
 *
 * No network: `fetch` is stubbed per test.
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  PATTERN_ACCOUNT_OR_ALIAS,
  SERVICE_OFFER_SCHEMA,
  PAYMENT_CHALLENGE_SCHEMA,
  SETTLEMENT_EVIDENCE_SCHEMA,
  PROOF_OF_ACTION_RECEIPT_SCHEMA,
} from "../../packages/shared-schemas/src/schemas.ts";
import { validate } from "../../packages/shared-schemas/src/validator.ts";
import { fixedClock } from "../../packages/shared-schemas/src/index.ts";
import { RealHederaX402Adapter, TESTNET, isEvmAlias } from "../../packages/hedera-x402-adapter/src/real-adapter.ts";
import { OFFER, PAYER, T0 } from "../helpers/fixtures.ts";

const ALIAS = "0x98eca0a3f742ddc7791fc64b9cb2e226340607d5";
const CREATED_ID = "0.0.987654";
const FEE_PAYER = "0.0.7162784";
const TX_ID = `${FEE_PAYER}@1785000000.000000001`;
const QUOTE_ID = `q_${"a".repeat(24)}`;

const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
});

/** Route mirror-node GETs: transactions vs accounts. */
function stubMirror(routes: { tx?: unknown; account?: unknown | null }): void {
  (globalThis as any).fetch = async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    const isAccount = url.includes("/accounts/");
    const body = isAccount ? routes.account : routes.tx;
    const status = body === null || body === undefined ? 404 : 200;
    return {
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  };
}

const txCreditingCreatedAccount = {
  transactions: [
    {
      transaction_id: TX_ID.replace("@", "-").replace(/\.(\d+)$/, "-$1"),
      consensus_timestamp: "1785000001.123456789",
      result: "SUCCESS",
      name: "CRYPTOTRANSFER",
      charged_tx_fee: 123456,
      memo_base64: Buffer.from(QUOTE_ID, "utf8").toString("base64"),
      transfers: [
        { account: PAYER, amount: -5_000_000 },
        { account: CREATED_ID, amount: 5_000_000 },
        { account: FEE_PAYER, amount: -123_456 },
      ],
    },
  ],
};

const createdAccount = {
  account: CREATED_ID,
  balance: { balance: 5_000_000, timestamp: "1785000001.123456789" },
  deleted: false,
  evm_address: ALIAS,
  key: { _type: "ECDSA_SECP256K1", key: "02aa" },
};

function adapter(): RealHederaX402Adapter {
  return new RealHederaX402Adapter({
    facilitatorUrl: "https://facilitator.invalid",
    feePayer: FEE_PAYER,
    resourceUrl: "http://127.0.0.1:4402/v1/evidence",
    clock: fixedClock(T0),
    mirrorLookup: { attempts: 1, delayMs: 0, sleep: async () => {} },
  });
}

const query = {
  transaction_id: TX_ID,
  expected_network: TESTNET as "hedera:testnet",
  expected_asset: "HBAR",
  expected_atomic_amount: "5000000",
  expected_payee: ALIAS,
  expected_memo: QUOTE_ID,
};

describe("alias recognition", () => {
  test("a 20-byte lowercase 0x address is an alias", () => {
    assert.equal(isEvmAlias(ALIAS), true);
  });

  test("an account id is not", () => {
    assert.equal(isEvmAlias("0.0.987654"), false);
  });

  test("near-misses are not aliases", () => {
    for (const v of [ALIAS.toUpperCase(), "0x1234", `${ALIAS}ff`, ALIAS.slice(2)]) {
      assert.equal(isEvmAlias(v), false, `${v} must not pass`);
    }
  });
});

describe("where an alias is allowed, and where it is not", () => {
  test("the offer may name an alias as pay_to", () => {
    assert.deepEqual(validate({ ...OFFER, pay_to: ALIAS }, SERVICE_OFFER_SCHEMA), []);
  });

  test("the offer still accepts a plain account id", () => {
    assert.deepEqual(validate({ ...OFFER, pay_to: "0.0.987654" }, SERVICE_OFFER_SCHEMA), []);
  });

  test("a malformed address is still rejected", () => {
    for (const bad of ["0x1234", ALIAS.toUpperCase(), "not-an-address", ""]) {
      assert.ok(validate({ ...OFFER, pay_to: bad }, SERVICE_OFFER_SCHEMA).length > 0, `${bad} must fail`);
    }
  });

  test("the challenge may carry an alias", () => {
    const re = new RegExp(PATTERN_ACCOUNT_OR_ALIAS);
    const accepts = (PAYMENT_CHALLENGE_SCHEMA as any).properties.accepts.items;
    assert.equal(accepts.properties.pay_to.pattern, PATTERN_ACCOUNT_OR_ALIAS);
    assert.ok(re.test(ALIAS));
  });

  test("SETTLEMENT evidence may NOT name an alias — only a created account", () => {
    const payeeSchema = (SETTLEMENT_EVIDENCE_SCHEMA as any).properties.payee;
    assert.ok(!new RegExp(payeeSchema.pattern).test(ALIAS), "an alias must not survive into settlement evidence");
    assert.ok(new RegExp(payeeSchema.pattern).test(CREATED_ID));
  });

  test("a RECEIPT may NOT name an alias — it names the account that exists", () => {
    const payeeSchema = (PROOF_OF_ACTION_RECEIPT_SCHEMA as any).properties.record.properties.payee;
    assert.ok(!new RegExp(payeeSchema.pattern).test(ALIAS));
    assert.ok(new RegExp(payeeSchema.pattern).test(CREATED_ID));
  });
});

describe("settlement verification against an auto-created payee", () => {
  test("resolves the alias and verifies the credit to the created account", async () => {
    stubMirror({ tx: txCreditingCreatedAccount, account: createdAccount });
    const ev = await adapter().verifySettlementViaMirrorNode(query);

    assert.equal(ev.verified, true);
    assert.equal(ev.finality, "FINAL");
    assert.equal(ev.payee, CREATED_ID, "the receipt must name the created account, not the alias");
    assert.equal(ev.payer, PAYER);
    assert.equal(ev.atomic_amount, "5000000");
    assert.equal(ev.memo, QUOTE_ID);
    assert.equal(ev.source, "MIRROR_NODE");
  });

  test("an alias that was never created is PENDING, not verified", async () => {
    stubMirror({ tx: txCreditingCreatedAccount, account: null });
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.finality, "PENDING");
    assert.equal(ev.failure_code, "payee_alias_not_created");
    assert.equal(ev.payee, "0.0.0", "no account exists to name");
  });

  test("an account whose EVM address does not match the alias is refused", async () => {
    // The dangerous case: the lookup resolves to SOME account, but not the one
    // the quote committed to. Treating that as success would mean paying an
    // account we cannot open.
    stubMirror({
      tx: txCreditingCreatedAccount,
      account: { ...createdAccount, evm_address: "0x1111111111111111111111111111111111111111" },
    });
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "payee_alias_mismatch");
    assert.equal(ev.finality, "FAILED");
  });

  test("a deleted resolved account is refused", async () => {
    stubMirror({ tx: txCreditingCreatedAccount, account: { ...createdAccount, deleted: true } });
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.failure_code, "payee_alias_not_created");
  });

  test("the memo check still applies to an alias payee", async () => {
    const tx = structuredClone(txCreditingCreatedAccount);
    tx.transactions[0].memo_base64 = Buffer.from("q_someone_else", "utf8").toString("base64");
    stubMirror({ tx, account: createdAccount });
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "memo_not_bound_to_quote");
  });

  test("the amount check still applies to an alias payee", async () => {
    const tx = structuredClone(txCreditingCreatedAccount);
    tx.transactions[0].transfers = [
      { account: PAYER, amount: -1 },
      { account: CREATED_ID, amount: 1 },
    ];
    stubMirror({ tx, account: createdAccount });
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, false);
    assert.equal(ev.failure_code, "amount_mismatch");
  });

  test("alias resolution is case-insensitive on the EVM address", async () => {
    stubMirror({ tx: txCreditingCreatedAccount, account: { ...createdAccount, evm_address: ALIAS.toUpperCase() } });
    const ev = await adapter().verifySettlementViaMirrorNode(query);
    assert.equal(ev.verified, true);
  });
});
