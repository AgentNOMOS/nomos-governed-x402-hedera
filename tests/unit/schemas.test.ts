import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_SCHEMAS,
  SERVICE_OFFER_SCHEMA,
  PAYMENT_CHALLENGE_SCHEMA,
  SETTLEMENT_EVIDENCE_SCHEMA,
  PROOF_OF_ACTION_RECEIPT_SCHEMA,
  PATTERN_ASSET,
  NETWORK,
} from "../../packages/shared-schemas/src/schemas.ts";
import { validate, assertValid, SchemaError } from "../../packages/shared-schemas/src/validator.ts";
import { OFFER } from "../helpers/fixtures.ts";

describe("schema registry", () => {
  test("all ten canonical schemas are present and uniquely identified", () => {
    const names = Object.keys(ALL_SCHEMAS);
    assert.equal(names.length, 10);
    const ids = names.map((n) => (ALL_SCHEMAS as Record<string, any>)[n].$id);
    assert.equal(new Set(ids).size, 10, "every schema needs its own $id");
    // v2 exists exactly once: the CP-H7 anchor envelope carries fields the v1
    // payload never had, and rewriting v1 would invalidate CP-H1/CP-H2 evidence.
    for (const id of ids) assert.match(id, /\.v[12]\.json$/);
    assert.equal(ids.filter((id) => id.endsWith(".v2.json")).length, 1);
  });

  test("every schema closes its top-level object", () => {
    for (const [name, s] of Object.entries(ALL_SCHEMAS)) {
      assert.equal((s as any).additionalProperties, false, `${name} must not allow unbound fields`);
    }
  });
});

describe("validator behaviour", () => {
  test("a valid offer passes", () => {
    assert.deepEqual(validate(OFFER, SERVICE_OFFER_SCHEMA), []);
  });

  test("a missing required field fails closed", () => {
    const { pay_to, ...broken } = OFFER as Record<string, unknown>;
    const issues = validate(broken, SERVICE_OFFER_SCHEMA);
    assert.ok(issues.some((i) => i.code === "REQUIRED_MISSING" && i.path.endsWith("pay_to")));
  });

  test("an explicitly-undefined required field also fails closed", () => {
    const issues = validate({ ...OFFER, pay_to: undefined }, SERVICE_OFFER_SCHEMA);
    assert.ok(issues.some((i) => i.code === "REQUIRED_MISSING"));
  });

  test("an unexpected extra field is rejected", () => {
    const issues = validate({ ...OFFER, sneaky: 1 }, SERVICE_OFFER_SCHEMA);
    assert.ok(issues.some((i) => i.code === "ADDITIONAL_PROPERTY"));
  });

  test("assertValid throws a SchemaError carrying the issues", () => {
    assert.throws(() => assertValid({}, SERVICE_OFFER_SCHEMA), (e: unknown) => {
      assert.ok(e instanceof SchemaError);
      assert.ok((e as SchemaError).issues.length > 0);
      return true;
    });
  });

  test("an unimplemented keyword fails closed instead of silently passing", () => {
    const issues = validate({ a: 1 }, { type: "object", oneOf: [{}] } as any);
    assert.ok(issues.some((i) => i.code === "UNSUPPORTED_KEYWORD"));
  });
});

describe("network and asset are bound, not suggested", () => {
  test("network is pinned to hedera:testnet by const", () => {
    assert.equal(NETWORK, "hedera:testnet");
    const issues = validate({ ...OFFER, network: "eip155:8453" }, SERVICE_OFFER_SCHEMA);
    assert.ok(issues.some((i) => i.code === "CONST_MISMATCH"));
  });

  test("a mainnet document cannot be represented at all", () => {
    for (const n of ["hedera:mainnet", "hedera:previewnet", "eip155:295", "eip155:296"]) {
      assert.ok(validate({ ...OFFER, network: n }, SERVICE_OFFER_SCHEMA).length > 0, `${n} must be rejected`);
    }
  });

  test("the asset pattern is anchored on both ends", () => {
    const re = new RegExp(PATTERN_ASSET);
    assert.ok(re.test("HBAR"));
    assert.ok(re.test("0.0.456858"));
    assert.ok(!re.test("NOTHBAR0.0.1"), "a partially-anchored alternation would accept this");
    assert.ok(!re.test("HBAR "));
    assert.ok(!re.test("hbar"));
  });
});

describe("amounts are strings, never floats", () => {
  test("a numeric amount is rejected by the schema", () => {
    const issues = validate({ ...OFFER, atomic_amount: 5000000 }, SERVICE_OFFER_SCHEMA);
    assert.ok(issues.some((i) => i.code === "TYPE_MISMATCH"));
  });

  test("a decimal amount string is rejected", () => {
    assert.ok(validate({ ...OFFER, atomic_amount: "0.05" }, SERVICE_OFFER_SCHEMA).length > 0);
  });

  test("leading zeros are rejected — one amount, one representation", () => {
    assert.ok(validate({ ...OFFER, atomic_amount: "05000000" }, SERVICE_OFFER_SCHEMA).length > 0);
  });

  test("negative amounts are rejected", () => {
    assert.ok(validate({ ...OFFER, atomic_amount: "-1" }, SERVICE_OFFER_SCHEMA).length > 0);
  });

  test("zero is representable (free offers exist) but empty is not", () => {
    assert.deepEqual(validate({ ...OFFER, atomic_amount: "0" }, SERVICE_OFFER_SCHEMA), []);
    assert.ok(validate({ ...OFFER, atomic_amount: "" }, SERVICE_OFFER_SCHEMA).length > 0);
  });
});

describe("evidence schemas keep MOCK distinguishable from real", () => {
  test("settlement evidence must declare its source", () => {
    const s = SETTLEMENT_EVIDENCE_SCHEMA as any;
    assert.ok(s.required.includes("source"));
    assert.deepEqual(s.properties.source.enum, ["MOCK_OFFLINE", "MIRROR_NODE"]);
  });

  test("the receipt record carries settlement_source through to the signature", () => {
    const rec = (PROOF_OF_ACTION_RECEIPT_SCHEMA as any).properties.record;
    assert.ok(rec.required.includes("settlement_source"));
    assert.deepEqual(rec.properties.settlement_source.enum, ["MOCK_OFFLINE", "MIRROR_NODE"]);
  });
});

describe("the proof-of-action receipt binds everything the brief requires", () => {
  const REQUIRED_BINDINGS = [
    "agent_identity", "authority_scope", "service_identity", "offer_id",
    "policy_decision", "policy_hash", "request_hash", "quote_hash",
    "idempotency_key", "network", "asset", "atomic_amount", "payer", "payee",
    "hedera_transaction_id", "delivery_status", "result_hash", "receipt_timestamp",
  ];

  test("every required binding is a required field of the signed record", () => {
    const rec = (PROOF_OF_ACTION_RECEIPT_SCHEMA as any).properties.record;
    for (const f of REQUIRED_BINDINGS) {
      assert.ok(rec.required.includes(f), `record.${f} must be required`);
    }
  });

  test("receipt_version, receipt_id and the signature block are required at the top level", () => {
    const top = PROOF_OF_ACTION_RECEIPT_SCHEMA as any;
    for (const f of ["receipt_version", "receipt_id", "record", "record_digest", "signature"]) {
      assert.ok(top.required.includes(f));
    }
  });

  test("consensus timestamp and the HCS reference are optional — anchoring is additive", () => {
    const top = PROOF_OF_ACTION_RECEIPT_SCHEMA as any;
    const rec = top.properties.record;
    assert.ok(!rec.required.includes("consensus_timestamp"));
    assert.ok(!top.required.includes("anchor"));
    assert.equal(top.properties.anchor.nullable, true);
  });

  test("there is no field capable of carrying request or result CONTENT", () => {
    const rec = (PROOF_OF_ACTION_RECEIPT_SCHEMA as any).properties.record;
    for (const forbidden of ["request_body", "result", "result_body", "payload", "content", "data"]) {
      assert.ok(!(forbidden in rec.properties), `record must not expose a "${forbidden}" field`);
    }
  });
});

describe("payment challenge", () => {
  test("memo is where the quote binding lives", () => {
    const accepts = (PAYMENT_CHALLENGE_SCHEMA as any).properties.accepts.items;
    assert.ok("memo" in accepts.properties);
    assert.match(accepts.properties.memo.description, /quote_id/);
  });

  test("only the exact scheme is representable today", () => {
    const accepts = (PAYMENT_CHALLENGE_SCHEMA as any).properties.accepts.items;
    assert.equal(accepts.properties.scheme.const, "exact");
  });
});
