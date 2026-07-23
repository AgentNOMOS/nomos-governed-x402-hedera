/**
 * CP-H7D — topic configuration, Grant A, and the mirror-node read-back.
 *
 * Everything a topic gets wrong is permanent. Without an admin key the memo and
 * the submit key cannot be changed and the topic cannot be removed by a regular
 * delete, so every test below is about refusing *before* the transaction rather
 * than detecting afterwards. There is no afterwards.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AUTO_RENEW_PERIOD_MAX_SECONDS,
  GRANT_MAX_WINDOW_SECONDS,
  TOPIC_CONFIG,
  TOPIC_CREATE_GRANT_MAGIC,
  TOPIC_CREATE_MAX_FEE_TINYBAR,
  TOPIC_MEMO_MAX_BYTES,
  TopicConfigError,
  assertTopicConfig,
  evaluateTopicCreateGuard,
  parseTopicCreateGrant,
  topicConfigBytes,
  topicConfigDigest,
  verifyTopicReadback,
  type TopicConfig,
  type TopicCreateGuardState,
} from "../../packages/hcs-anchor/src/index.ts";
import { NETWORK } from "../../packages/shared-schemas/src/index.ts";

const NOW = Date.parse("2026-07-23T14:00:00Z");
const PAYER = TOPIC_CONFIG.payer_account_id;
const SUBMIT_KEY = TOPIC_CONFIG.submit_key.public_key;
const TOPIC_ID = "0.0.999200";

const clone = (over: Record<string, unknown> = {}): TopicConfig =>
  ({ ...JSON.parse(JSON.stringify(TOPIC_CONFIG)), ...over }) as TopicConfig;

// ── the operator's decision, as literals ────────────────────────────────────

describe("frozen topic configuration", () => {
  test("matches the operator decision field for field", () => {
    assert.equal(TOPIC_CONFIG.network, "hedera:testnet");
    assert.equal(TOPIC_CONFIG.payer_account_id, "0.0.9689846");
    assert.equal(TOPIC_CONFIG.auto_renew_account_id, "0.0.9689846");
    assert.equal(TOPIC_CONFIG.auto_renew_period_seconds, 8_000_001);
    assert.equal(TOPIC_CONFIG.max_transaction_fee_tinybar, "50000000");
    assert.equal(TOPIC_CONFIG.admin_key, null);
    assert.equal(TOPIC_CONFIG.submit_key.type, "ECDSA_SECP256K1");
    assert.equal(
      TOPIC_CONFIG.memo,
      "NOMOS CP-H7 PoA anchor v2 | TESTNET_DEMO_ONLY | poa_60a1c2220acb7ef835dcdca8",
    );
  });

  test("the memo is exactly 76 UTF-8 bytes", () => {
    assert.equal(Buffer.byteLength(TOPIC_CONFIG.memo, "utf8"), 76);
    assert.equal(TOPIC_CONFIG.memo_bytes, 76);
    assert.ok(76 < TOPIC_MEMO_MAX_BYTES);
  });

  test("the memo names the receipt it exists for", () => {
    const receipt = JSON.parse(readFileSync(resolve("docs/evidence/cp-h2/receipt.json"), "utf8"));
    assert.ok(TOPIC_CONFIG.memo.includes(receipt.receipt_id));
  });

  test("the configuration is frozen — no code path can mutate it before the digest is used", () => {
    assert.ok(Object.isFrozen(TOPIC_CONFIG));
    assert.throws(() => {
      (TOPIC_CONFIG as { memo: string }).memo = "something else";
    });
  });

  test("the digest is deterministic and key-sorted", () => {
    assert.equal(topicConfigDigest(), topicConfigDigest(TOPIC_CONFIG));
    assert.ok(topicConfigBytes().toString("utf8").startsWith('{"admin_key":null,'));
  });

  test("any change to any field moves the digest", () => {
    const base = topicConfigDigest();
    for (const change of [
      { memo: `${TOPIC_CONFIG.memo} ` },
      { auto_renew_period_seconds: 8_000_000 },
      { auto_renew_account_id: "0.0.999999" },
      { max_transaction_fee_tinybar: "49999999" },
    ]) {
      assert.notEqual(topicConfigDigest(clone(change)), base, `${JSON.stringify(change)} must move the digest`);
    }
    const otherKey = clone({ submit_key: { type: "ECDSA_SECP256K1", public_key: `03${"a".repeat(64)}` } });
    assert.notEqual(topicConfigDigest(otherKey), base);
  });
});

// ── admin key ───────────────────────────────────────────────────────────────

describe("admin key must be absent, and absent deliberately", () => {
  test("the shipped configuration validates", () => {
    assert.doesNotThrow(() => assertTopicConfig(TOPIC_CONFIG));
  });

  test("an admin key present at all is refused", () => {
    assert.throws(
      () => assertTopicConfig(clone({ admin_key: { type: "ECDSA_SECP256K1", public_key: SUBMIT_KEY } })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "ADMIN_KEY_PRESENT",
    );
  });

  test("an omitted admin_key field is refused too — null and missing are different states", () => {
    const c = JSON.parse(JSON.stringify(TOPIC_CONFIG));
    delete c.admin_key;
    assert.throws(
      () => assertTopicConfig(c),
      (e: unknown) => e instanceof TopicConfigError && e.code === "ADMIN_KEY_FIELD_MISSING",
    );
  });

  test("a read-back showing an admin key fails, even if everything else matches", () => {
    const v = verifyTopicReadback(observedTopic({ admin_key: { _type: "ECDSA_SECP256K1", key: SUBMIT_KEY } }), TOPIC_ID, true);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("admin_key_present"));
  });

  test("a read-back with a null or empty admin key is accepted as absent", () => {
    for (const adminKey of [null, { _type: "ProtobufEncoded", key: "" }]) {
      const v = verifyTopicReadback(observedTopic({ admin_key: adminKey }), TOPIC_ID, true);
      assert.deepEqual(v.reasons, [], `admin_key ${JSON.stringify(adminKey)} must read as absent`);
    }
  });
});

// ── submit key ──────────────────────────────────────────────────────────────

describe("submit key", () => {
  test("is the payer's own key — no new key is generated", () => {
    assert.equal(SUBMIT_KEY, "025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17");
    assert.equal(SUBMIT_KEY.length, 66, "compressed secp256k1 is 33 bytes");
  });

  test("a malformed submit key is refused", () => {
    for (const bad of ["", "not-hex", `04${"a".repeat(128)}`, SUBMIT_KEY.toUpperCase()]) {
      assert.throws(
        () => assertTopicConfig(clone({ submit_key: { type: "ECDSA_SECP256K1", public_key: bad } })),
        (e: unknown) => e instanceof TopicConfigError,
        `${bad.slice(0, 12)} must be refused`,
      );
    }
  });

  test("a non-secp256k1 key type is refused", () => {
    assert.throws(
      () => assertTopicConfig(clone({ submit_key: { type: "ED25519", public_key: SUBMIT_KEY } })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "SUBMIT_KEY_TYPE_MISMATCH",
    );
  });

  test("the guard blocks when the payer key does not derive the configured submit key", () => {
    const v = evaluateTopicCreateGuard(guardState({ derivedPayerPublicKey: `02${"b".repeat(64)}` }));
    assert.ok(v.blockers.some((b) => b.startsWith("SUBMIT_KEY_MISMATCH")));
  });

  test("the guard blocks when the payer public key cannot be derived at all", () => {
    const v = evaluateTopicCreateGuard(guardState({ derivedPayerPublicKey: null }));
    assert.ok(v.blockers.some((b) => b.startsWith("SUBMIT_KEY_UNVERIFIED")));
  });

  test("a read-back with a different submit key fails", () => {
    const v = verifyTopicReadback(observedTopic({ submit_key: { _type: "ECDSA_SECP256K1", key: `02${"c".repeat(64)}` } }), TOPIC_ID, true);
    assert.ok(v.reasons.includes("submit_key_mismatch"));
  });
});

// ── memo ────────────────────────────────────────────────────────────────────

describe("memo", () => {
  test("a declared byte count that disagrees with the memo is refused", () => {
    assert.throws(
      () => assertTopicConfig(clone({ memo_bytes: 75 })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "MEMO_BYTE_COUNT_MISMATCH",
    );
  });

  test("changing the memo without changing the count is refused", () => {
    assert.throws(
      () => assertTopicConfig(clone({ memo: "NOMOS CP-H7" })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "MEMO_BYTE_COUNT_MISMATCH",
    );
  });

  test("a memo over the 100-byte protocol limit is refused", () => {
    const long = "x".repeat(120);
    assert.throws(
      () => assertTopicConfig(clone({ memo: long, memo_bytes: 120 })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "MEMO_TOO_LONG",
    );
  });

  test("byte length is counted in UTF-8, not characters", () => {
    // A memo of 76 characters is not necessarily 76 bytes. Declaring the count
    // in characters would pass here and be rejected by the network.
    const multibyte = "ü".repeat(76);
    assert.equal(multibyte.length, 76);
    assert.equal(Buffer.byteLength(multibyte, "utf8"), 152);
    assert.throws(
      () => assertTopicConfig(clone({ memo: multibyte, memo_bytes: 76 })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "MEMO_BYTE_COUNT_MISMATCH",
    );
  });

  test("a read-back with a different memo fails", () => {
    const v = verifyTopicReadback(observedTopic({ memo: "NOMOS CP-H7 PoA anchor v2" }), TOPIC_ID, true);
    assert.ok(v.reasons.includes("memo_mismatch"));
  });
});

// ── auto-renew ──────────────────────────────────────────────────────────────

describe("auto-renew", () => {
  test("the period is the network maximum", () => {
    assert.equal(TOPIC_CONFIG.auto_renew_period_seconds, AUTO_RENEW_PERIOD_MAX_SECONDS);
  });

  test("a period outside the permitted window is refused", () => {
    for (const bad of [0, 1000, 8_000_002, 99_999_999, 7_776_000.5]) {
      assert.throws(
        () => assertTopicConfig(clone({ auto_renew_period_seconds: bad })),
        (e: unknown) => e instanceof TopicConfigError && e.code === "AUTO_RENEW_PERIOD_OUT_OF_RANGE",
        `${bad} must be refused`,
      );
    }
  });

  test("a malformed auto-renew account is refused", () => {
    assert.throws(
      () => assertTopicConfig(clone({ auto_renew_account_id: "0x9689846" })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "ACCOUNT_ID_MALFORMED",
    );
  });

  test("a read-back with a different auto-renew account fails", () => {
    const v = verifyTopicReadback(observedTopic({ auto_renew_account: "0.0.999999" }), TOPIC_ID, true);
    assert.ok(v.reasons.includes("auto_renew_account_mismatch"));
  });

  test("a read-back with a different auto-renew period fails", () => {
    const v = verifyTopicReadback(observedTopic({ auto_renew_period: 7776000 }), TOPIC_ID, true);
    assert.ok(v.reasons.includes("auto_renew_period_mismatch"));
  });
});

// ── fee ceiling ─────────────────────────────────────────────────────────────

describe("fee ceiling", () => {
  test("the create ceiling is 0.50 HBAR, expressed in tinybar as a string", () => {
    assert.equal(TOPIC_CREATE_MAX_FEE_TINYBAR, "50000000");
    assert.equal(Number(TOPIC_CREATE_MAX_FEE_TINYBAR) / 1e8, 0.5);
    assert.equal(typeof TOPIC_CONFIG.max_transaction_fee_tinybar, "string", "amounts are never numbers");
  });

  test("a configuration above the ceiling is refused", () => {
    assert.throws(
      () => assertTopicConfig(clone({ max_transaction_fee_tinybar: "50000001" })),
      (e: unknown) => e instanceof TopicConfigError && e.code === "FEE_CAP_EXCEEDED",
    );
  });

  test("a non-integer fee string is refused", () => {
    for (const bad of ["0.5", "50000000.0", "5e7", "-1", ""]) {
      assert.throws(
        () => assertTopicConfig(clone({ max_transaction_fee_tinybar: bad })),
        (e: unknown) => e instanceof TopicConfigError,
        `${bad} must be refused`,
      );
    }
  });

  test("a grant whose fee cap exceeds the ceiling is refused", () => {
    const v = evaluateTopicCreateGuard(guardState({ grant: grantA({ max_transaction_fee_tinybar: "100000000" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_FEE_CAP_EXCEEDED")));
  });

  test("a grant whose fee cap merely disagrees with the configuration is refused", () => {
    const v = evaluateTopicCreateGuard(guardState({ grant: grantA({ max_transaction_fee_tinybar: "10000000" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_FEE_CAP_MISMATCH")));
  });
});

// ── Grant A ─────────────────────────────────────────────────────────────────

describe("Grant A", () => {
  test("a valid grant parses and a fully satisfied guard allows exactly one create", () => {
    assert.ok(parseTopicCreateGrant(JSON.stringify(grantA())));
    const v = evaluateTopicCreateGuard(guardState({}));
    assert.deepEqual(v.blockers, [], `unexpected blockers: ${v.blockers.join(", ")}`);
    assert.equal(v.allowed, true);
  });

  test("the magic string is required — an arbitrary JSON file is not a grant", () => {
    assert.equal(parseTopicCreateGrant(null), null);
    assert.equal(parseTopicCreateGrant(""), null);
    assert.equal(parseTopicCreateGrant("{}"), null);
    assert.equal(parseTopicCreateGrant("not json"), null);
    assert.equal(parseTopicCreateGrant(JSON.stringify({ ...grantA(), grant: "SOMETHING_ELSE" })), null);
  });

  test("a grant approving a different configuration authorizes nothing", () => {
    const other = clone({ memo: "a different memo entirely", memo_bytes: 24 });
    const v = evaluateTopicCreateGuard(
      guardState({ grant: grantA({ topic_config: other, topic_config_digest: topicConfigDigest(other) }) }),
    );
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_CONFIG_DIGEST_MISMATCH")));
  });

  test("a hand-edited grant whose config no longer hashes to its digest is refused", () => {
    const tampered = grantA({ topic_config: clone({ auto_renew_period_seconds: 7_000_000 }) });
    const v = evaluateTopicCreateGuard(guardState({ grant: tampered }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_DIGEST_NOT_REPRODUCIBLE")));
  });

  test("an expired grant authorizes nothing", () => {
    const v = evaluateTopicCreateGuard(guardState({ grant: grantA({ expires_at: "2026-07-23T13:00:00Z" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_EXPIRED")));
  });

  test("a window longer than 30 minutes is refused — that is a standing authorization", () => {
    const v = evaluateTopicCreateGuard(guardState({ grant: grantA({ expires_at: "2026-07-23T15:00:00Z" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_WINDOW_TOO_LONG")));
    assert.equal(GRANT_MAX_WINDOW_SECONDS, 1800);
  });

  test("a grant for another payer authorizes nothing", () => {
    const v = evaluateTopicCreateGuard(guardState({ grant: grantA({ payer_account_id: "0.0.999999" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_PAYER_MISMATCH")));
  });

  test("a grant for another network authorizes nothing", () => {
    const v = evaluateTopicCreateGuard(guardState({ grant: grantA({ network: "hedera:mainnet" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_NETWORK_MISMATCH")));
  });

  test("Grant A and Grant B are different documents with different magic strings", () => {
    assert.equal(TOPIC_CREATE_GRANT_MAGIC, "NOMOS_GX402_CP_H7_TOPIC_CREATE_GRANT_V1");
    // A Grant B document must not parse as a Grant A, or the separation is
    // decorative.
    const grantBShaped = { grant: "NOMOS_GX402_CP_H7_ANCHOR_SUBMIT_GRANT_V2", topic_id: TOPIC_ID };
    assert.equal(parseTopicCreateGrant(JSON.stringify(grantBShaped)), null);
  });
});

// ── duplicate creation ──────────────────────────────────────────────────────

describe("duplicate topic creation", () => {
  test("a local marker blocks a second create", () => {
    const v = evaluateTopicCreateGuard(guardState({ createdMarker: "0.0.1@2.3\n" }));
    assert.ok(v.blockers.some((b) => b.startsWith("ALREADY_CREATED")));
    assert.equal(v.allowed, false);
  });

  test("a topic already in configuration blocks a second create", () => {
    const v = evaluateTopicCreateGuard(guardState({ configuredTopicId: TOPIC_ID }));
    assert.ok(v.blockers.some((b) => b.startsWith("TOPIC_ALREADY_CONFIGURED")));
  });

  test("a topic already on the ledger blocks a second create", () => {
    const v = evaluateTopicCreateGuard(guardState({ existingTopicCreates: 1 }));
    assert.ok(v.blockers.some((b) => b.startsWith("TOPIC_EXISTS_ON_LEDGER")));
  });

  test("an unanswered ledger question is not a no — fail closed", () => {
    // The marker catches a repeat on this machine; the ledger lookup catches one
    // made anywhere else. If the lookup did not answer, neither guard applies.
    const v = evaluateTopicCreateGuard(guardState({ existingTopicCreates: null }));
    assert.ok(v.blockers.some((b) => b.startsWith("LEDGER_STATE_UNKNOWN")));
    assert.equal(v.allowed, false);
  });
});

// ── read-back ───────────────────────────────────────────────────────────────

describe("mirror-node read-back", () => {
  test("a matching topic confirms", () => {
    const v = verifyTopicReadback(observedTopic(), TOPIC_ID, true);
    assert.deepEqual(v.reasons, []);
    assert.equal(v.ok, true);
    assert.equal(v.checked.length, 6);
    assert.ok(v.checked.every((c) => c.ok));
  });

  test("a topic that is not there does not confirm", () => {
    const v = verifyTopicReadback(null, TOPIC_ID, true);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("topic_not_found_on_mirror"));
  });

  test("a different topic id does not confirm", () => {
    const v = verifyTopicReadback(observedTopic({ topic_id: "0.0.999999" }), TOPIC_ID, true);
    assert.ok(v.reasons.includes("topic_id_mismatch"));
  });

  test("a failed create transaction does not confirm, even with a matching topic", () => {
    const v = verifyTopicReadback(observedTopic(), TOPIC_ID, false);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("create_transaction_not_successful"));
  });

  test("a deleted topic does not confirm", () => {
    const v = verifyTopicReadback(observedTopic({ deleted: true }), TOPIC_ID, true);
    assert.ok(v.reasons.includes("topic_deleted"));
  });

  test("every reason is reported, not just the first", () => {
    const v = verifyTopicReadback(observedTopic({ memo: "wrong", auto_renew_period: 1 }), TOPIC_ID, false);
    assert.ok(v.reasons.length >= 3, `expected several reasons, got ${v.reasons.join(", ")}`);
  });
});

// ── dry run ─────────────────────────────────────────────────────────────────

describe("dry run builds no transaction", () => {
  const src = readFileSync(resolve("tools/create-anchor-topic.ts"), "utf8");

  test("no Hedera SDK is imported at module scope", () => {
    for (const line of src.split("\n").filter((l) => /^import .* from ["']/.test(l))) {
      assert.ok(!/@hiero-ledger|@hashgraph/.test(line), `SDK must not load at module scope: ${line}`);
    }
  });

  test("the transaction class is reachable only behind the guard", () => {
    const guardIndex = src.indexOf("if (!verdict.allowed)");
    const sdkImportIndex = src.indexOf('await import(\n    "@hiero-ledger/sdk"\n  )');
    const fallbackIndex = src.indexOf('await import("@hiero-ledger/sdk")');
    const importIndex = sdkImportIndex >= 0 ? sdkImportIndex : fallbackIndex;
    assert.ok(guardIndex > 0, "the guard check must exist");
    assert.ok(importIndex > guardIndex, "the SDK must be imported after the guard refusal, not before");
    assert.ok(src.indexOf("new TopicCreateTransaction()") > guardIndex);
  });

  test("no admin key is ever set — the omission is the configuration", () => {
    // Comments are stripped first: the tool documents the omission in prose,
    // and this assertion is about code. Matching the raw text would force the
    // explanation out of the file to satisfy a test, which is backwards.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    assert.ok(!/setAdminKey/.test(code), "setAdminKey must not be called anywhere in this tool");
    assert.ok(/setAdminKey/.test(src), "the omission should still be explained in a comment");
  });

  test("every security-relevant field is set explicitly, none left to a default", () => {
    for (const setter of [
      "setTopicMemo",
      "setSubmitKey",
      "setAutoRenewAccountId",
      "setAutoRenewPeriod",
      "setMaxTransactionFee",
    ]) {
      assert.ok(src.includes(setter), `${setter} must be called explicitly`);
    }
  });

  test("the tool never writes a Grant B document itself", () => {
    // It may compute the values. Authoring its own authorization is the line.
    assert.ok(!/HCS_ANCHOR_AUTHORIZED"\s*\)/.test(src) || !/writeAtomic\(\s*GRANT/.test(src));
    assert.ok(src.includes("may not author its own authorization"));
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function grantA(over: Record<string, unknown> = {}) {
  return {
    grant: TOPIC_CREATE_GRANT_MAGIC,
    network: NETWORK,
    payer_account_id: PAYER,
    topic_config: JSON.parse(JSON.stringify(TOPIC_CONFIG)),
    topic_config_digest: topicConfigDigest(TOPIC_CONFIG),
    max_transaction_fee_tinybar: TOPIC_CREATE_MAX_FEE_TINYBAR,
    // 20 minutes ahead of NOW, inside the permitted window.
    expires_at: "2026-07-23T14:20:00Z",
    ...over,
  } as never;
}

/** A guard state that passes by default, so each test states only what it breaks. */
function guardState(over: Partial<TopicCreateGuardState>): TopicCreateGuardState {
  return {
    grant: grantA(),
    createdMarker: null,
    anchorEnabled: true,
    configuredTopicId: "",
    payerKeyPresent: true,
    derivedPayerPublicKey: SUBMIT_KEY,
    existingTopicCreates: 0,
    nowMs: NOW,
    ...over,
  };
}

/** A mirror-node topic response that matches the configuration. */
function observedTopic(over: Record<string, unknown> = {}) {
  return {
    topic_id: TOPIC_ID,
    memo: TOPIC_CONFIG.memo,
    admin_key: null,
    submit_key: { _type: "ECDSA_SECP256K1", key: SUBMIT_KEY },
    auto_renew_account: TOPIC_CONFIG.auto_renew_account_id,
    auto_renew_period: TOPIC_CONFIG.auto_renew_period_seconds,
    deleted: false,
    ...over,
  };
}
