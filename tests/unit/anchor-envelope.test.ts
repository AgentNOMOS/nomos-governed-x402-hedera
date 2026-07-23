/**
 * CP-H7 — envelope, verifier and guard.
 *
 * Every test here runs offline. The one thing being proven throughout is that
 * a wrong anchor is refused *before* a transaction could exist, not detected
 * afterwards: after consensus there is nothing to take back.
 *
 * The receipt under test is the real CP-H2 artifact rather than a fixture. An
 * envelope builder that works on a synthetic receipt and not on the one we
 * actually shipped would pass a test suite and fail the only case that matters.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  ANCHOR_ENVELOPE_BYTE_BUDGET,
  AnchorBindingError,
  FORBIDDEN_TOPIC_IDS,
  GRANT_MAGIC,
  MESSAGE_SUBMIT_MAX_FEE_TINYBAR,
  anchorEnvelopeBytes,
  anchorEnvelopeDigest,
  anchorKey,
  assertEnvelopeBinding,
  assertEnvelopeWellFormed,
  buildAnchorEnvelope,
  evaluateAnchorGuard,
  findDuplicateAnchor,
  parseAnchorGrant,
  verifyAnchorEvidence,
  type AnchorEnvelope,
  type AnchorGuardState,
} from "../../packages/hcs-anchor/src/index.ts";
import { HCS_SINGLE_CHUNK_LIMIT } from "../../packages/hcs-anchor/src/mock-anchor.ts";
import { canonicalDigest, NETWORK } from "../../packages/shared-schemas/src/index.ts";
import { DEMO_TOPIC } from "../helpers/fixtures.ts";

const RECEIPT_PATH = resolve("docs/evidence/cp-h2/receipt.json");
const receipt = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
const NOW = Date.parse("2026-07-23T14:00:00Z");

/** Deep clone so a mutation in one test cannot leak into the next. */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function envelope(): AnchorEnvelope {
  return buildAnchorEnvelope(receipt, NOW);
}

function evidenceFor(env: AnchorEnvelope, over: Record<string, unknown> = {}): Record<string, unknown> {
  const bytes = anchorEnvelopeBytes(env);
  return {
    schema: "nomos.gx402.hcs_anchor_evidence.v1",
    status: "SUBMITTED",
    network: NETWORK,
    anchor_key: anchorKey(NETWORK, env.receipt_id, env.record_digest),
    envelope: env,
    envelope_digest: anchorEnvelopeDigest(env),
    envelope_bytes: bytes.length,
    topic_id: DEMO_TOPIC,
    sequence_number: 1,
    transaction_id: "0.0.999001@1784746988.798231156",
    consensus_timestamp: "1784746993.237232768",
    submitted_at: "2026-07-23T14:00:00Z",
    ...over,
  };
}

function observedFor(env: AnchorEnvelope, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message: anchorEnvelopeBytes(env).toString("base64"),
    sequence_number: 1,
    consensus_timestamp: "1784746993.237232768",
    topic_id: DEMO_TOPIC,
    ...over,
  };
}

// ── 1. valid envelope ───────────────────────────────────────────────────────

describe("valid envelope", () => {
  test("builds from the real CP-H2 receipt and binds back to it", () => {
    const e = envelope();
    assert.equal(e.schema, "nomos.gx402.anchor.v2");
    assert.equal(e.receipt_id, receipt.receipt_id);
    assert.equal(e.record_digest, receipt.record_digest);
    assert.equal(e.source_transaction_id, receipt.record.hedera_transaction_id);
    assert.equal(e.source_consensus_timestamp, receipt.record.consensus_timestamp);
    assert.doesNotThrow(() => assertEnvelopeBinding(e, receipt));
  });

  test("carries no field capable of holding content", () => {
    const e = envelope() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(e)) {
      assert.equal(typeof v, "string", `${k} must be a scalar string`);
      assert.ok((v as string).length <= 128, `${k} is ${(v as string).length} chars — too roomy for an identifier`);
    }
    // Exactly one value carries information about the receipt's contents, and
    // it is a hash. Everything else is a literal or an identifier.
    const digestValued = Object.entries(e).filter(([, v]) => /^sha256:[0-9a-f]{64}$/.test(String(v)));
    assert.deepEqual(digestValued.map(([k]) => k), ["record_digest"]);
  });

  test("fits one HCS chunk with headroom", () => {
    const bytes = anchorEnvelopeBytes(envelope());
    assert.ok(bytes.length <= ANCHOR_ENVELOPE_BYTE_BUDGET, `envelope is ${bytes.length} bytes`);
    assert.ok(bytes.length < HCS_SINGLE_CHUNK_LIMIT);
  });

  test("serialization is deterministic and key-sorted", () => {
    const a = anchorEnvelopeBytes(buildAnchorEnvelope(receipt, NOW));
    const b = anchorEnvelopeBytes(buildAnchorEnvelope(receipt, NOW));
    assert.ok(a.equals(b), "same inputs must give the same bytes");
    const text = a.toString("utf8");
    assert.ok(text.startsWith('{"anchor_version":'), "keys must be sorted, not insertion-ordered");
    assert.equal(anchorEnvelopeDigest(envelope()), `sha256:${createHash("sha256").update(b).digest("hex")}`);
  });

  test("only created_at moves when the clock moves", () => {
    const later = buildAnchorEnvelope(receipt, NOW + 60_000);
    const base = envelope();
    assert.notEqual(later.created_at, base.created_at);
    assert.deepEqual({ ...later, created_at: "x" }, { ...base, created_at: "x" });
  });
});

// ── 2. tampered digest ──────────────────────────────────────────────────────

describe("tampered digest", () => {
  test("a receipt whose digest was edited cannot produce an envelope", () => {
    const bad = clone(receipt);
    bad.record_digest = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => buildAnchorEnvelope(bad, NOW),
      (e: unknown) => e instanceof AnchorBindingError && e.code === "RECORD_DIGEST_NOT_REPRODUCIBLE",
    );
  });

  test("a receipt whose record was edited cannot produce an envelope", () => {
    const bad = clone(receipt);
    bad.record.atomic_amount = "1";
    assert.throws(
      () => buildAnchorEnvelope(bad, NOW),
      (e: unknown) => e instanceof AnchorBindingError && e.code === "RECORD_DIGEST_NOT_REPRODUCIBLE",
    );
  });

  test("an envelope whose digest was swapped fails binding", () => {
    const e = { ...envelope(), record_digest: canonicalDigest({ not: "the record" }) };
    assert.throws(
      () => assertEnvelopeBinding(e, receipt),
      (err: unknown) => err instanceof AnchorBindingError && err.code === "RECORD_DIGEST_MISMATCH",
    );
  });
});

// ── 3. wrong receipt id ─────────────────────────────────────────────────────

describe("wrong receipt id", () => {
  test("an envelope naming another receipt fails binding", () => {
    const e = { ...envelope(), receipt_id: `poa_${"b".repeat(24)}` };
    assert.throws(
      () => assertEnvelopeBinding(e, receipt),
      (err: unknown) => err instanceof AnchorBindingError && err.code === "RECEIPT_ID_MISMATCH",
    );
  });

  test("a malformed receipt id is refused at build time", () => {
    const bad = clone(receipt);
    bad.receipt_id = "poa_NOTHEX";
    assert.throws(
      () => buildAnchorEnvelope(bad, NOW),
      (e: unknown) => e instanceof AnchorBindingError && e.code === "RECEIPT_ID_MALFORMED",
    );
  });
});

// ── 4. wrong network ────────────────────────────────────────────────────────

describe("wrong network", () => {
  test("a mainnet receipt is refused outright", () => {
    const bad = clone(receipt);
    bad.record.network = "hedera:mainnet";
    assert.throws(
      () => buildAnchorEnvelope(bad, NOW),
      (e: unknown) => e instanceof AnchorBindingError && e.code === "RECORD_DIGEST_NOT_REPRODUCIBLE",
      "editing the record breaks the digest first — which is the stronger refusal",
    );
  });

  test("a coherently-rehashed mainnet receipt is still refused, by network", () => {
    // The previous test only proves the digest check fires first. A receipt
    // genuinely issued for mainnet would have a reproducible digest, so the
    // network check has to stand on its own.
    const bad = clone(receipt);
    bad.record.network = "hedera:mainnet";
    bad.record_digest = canonicalDigest(bad.record);
    assert.throws(
      () => buildAnchorEnvelope(bad, NOW),
      (e: unknown) => e instanceof AnchorBindingError && e.code === "NETWORK_MISMATCH",
    );
  });

  test("an envelope claiming another network is unrepresentable", () => {
    const e = { ...envelope(), network: "hedera:mainnet" };
    assert.throws(
      () => assertEnvelopeWellFormed(e),
      (err: unknown) => err instanceof AnchorBindingError && err.code === "ENVELOPE_SCHEMA_INVALID",
    );
  });

  test("the guard blocks a non-testnet run", () => {
    const v = evaluateAnchorGuard(guardState({ network: "hedera:mainnet" }));
    assert.ok(v.blockers.some((b) => b.startsWith("NETWORK_NOT_TESTNET")));
  });
});

// ── 5. wrong transaction id ─────────────────────────────────────────────────

describe("wrong transaction id", () => {
  test("an envelope naming a different payment fails binding", () => {
    const e = { ...envelope(), source_transaction_id: "0.0.1@1.2" };
    assert.throws(
      () => assertEnvelopeBinding(e, receipt),
      (err: unknown) => err instanceof AnchorBindingError && err.code === "SOURCE_TX_MISMATCH",
    );
  });

  test("a receipt without a transaction id cannot be anchored", () => {
    const bad = clone(receipt);
    delete bad.record.hedera_transaction_id;
    assert.throws(() => buildAnchorEnvelope(bad, NOW), AnchorBindingError);
  });
});

// ── 6. wrong consensus timestamp ────────────────────────────────────────────

describe("wrong consensus timestamp", () => {
  test("an envelope naming another consensus time fails binding", () => {
    const e = { ...envelope(), source_consensus_timestamp: "1.2" };
    assert.throws(
      () => assertEnvelopeBinding(e, receipt),
      (err: unknown) => err instanceof AnchorBindingError && err.code === "SOURCE_CONSENSUS_TS_MISMATCH",
    );
  });

  test("an observed message with a different consensus time is reported", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e), receipt, observedFor(e, { consensus_timestamp: "9.9" }));
    assert.ok(v.reasons.includes("observed_consensus_timestamp_mismatch"));
  });
});

// ── 7. double submit ────────────────────────────────────────────────────────

describe("double submit", () => {
  test("the executed marker blocks a second run", () => {
    const v = evaluateAnchorGuard(guardState({ executedMarker: "0.0.1@2.3\n" }));
    assert.ok(v.blockers.some((b) => b.startsWith("ALREADY_EXECUTED")));
    assert.equal(v.allowed, false);
  });

  test("a duplicate already on the topic blocks the run", () => {
    const v = evaluateAnchorGuard(guardState({ duplicateOnTopic: true }));
    assert.ok(v.blockers.some((b) => b.startsWith("DUPLICATE_ON_TOPIC")));
  });

  test("the duplicate scan finds our own envelope on the topic", () => {
    const e = envelope();
    const found = findDuplicateAnchor([observedFor(e)], e.receipt_id, e.record_digest);
    assert.ok(found, "an identical anchor must be recognised");
  });

  test("a foreign message on the same topic is not a duplicate", () => {
    const e = envelope();
    const foreign = { message: Buffer.from('{"hello":"world"}').toString("base64") };
    const nonJson = { message: Buffer.from("not json at all").toString("base64") };
    assert.equal(findDuplicateAnchor([foreign, nonJson], e.receipt_id, e.record_digest), null);
  });

  test("the anchor key is stable across rebuilds — that is what makes dedup possible", () => {
    const a = buildAnchorEnvelope(receipt, NOW);
    const b = buildAnchorEnvelope(receipt, NOW + 999_000);
    assert.equal(
      anchorKey(NETWORK, a.receipt_id, a.record_digest),
      anchorKey(NETWORK, b.receipt_id, b.record_digest),
    );
  });

  test("a receipt that already carries an anchor is refused", () => {
    const already = clone(receipt);
    already.anchor = { schema: "nomos.gx402.hcs_anchor_reference.v1", status: "ANCHORED" };
    assert.throws(
      () => buildAnchorEnvelope(already, NOW),
      (e: unknown) => e instanceof AnchorBindingError && e.code === "RECEIPT_ALREADY_ANCHORED",
    );
  });
});

// ── 8. missing evidence ─────────────────────────────────────────────────────

describe("missing evidence", () => {
  test("an evidence record missing required fields fails closed", () => {
    const e = envelope();
    const partial = evidenceFor(e);
    delete (partial as Record<string, unknown>).envelope_digest;
    const v = verifyAnchorEvidence(partial, receipt, null);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => r.startsWith("evidence_schema_invalid")));
  });

  test("CONFIRMED without an observation is itself a failure", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { status: "CONFIRMED" }), receipt, null);
    assert.ok(v.reasons.includes("confirmed_without_observation"));
    assert.equal(v.ok, false);
  });

  test("CONFIRMED without a sequence number is a failure", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(
      evidenceFor(e, { status: "CONFIRMED", sequence_number: null }),
      receipt,
      observedFor(e),
    );
    assert.ok(v.reasons.includes("confirmed_without_sequence_number"));
  });
});

// ── 9. corrupted evidence ───────────────────────────────────────────────────

describe("corrupted evidence", () => {
  test("a doctored envelope_digest is caught", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { envelope_digest: `sha256:${"1".repeat(64)}` }), receipt, null);
    assert.ok(v.reasons.includes("envelope_digest_mismatch"));
  });

  test("a doctored byte count is caught", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { envelope_bytes: 12 }), receipt, null);
    assert.ok(v.reasons.includes("envelope_byte_count_mismatch"));
  });

  test("a doctored anchor key is caught", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { anchor_key: `anc_${"0".repeat(24)}` }), receipt, null);
    assert.ok(v.reasons.includes("anchor_key_mismatch"));
  });

  test("evidence pointing at a forbidden topic is caught", () => {
    const e = envelope();
    // Referenced through the constant, never spelled out: the secret scanner
    // treats the OracleNet topic ids as production identifiers, and it is right to.
    const v = verifyAnchorEvidence(evidenceFor(e, { topic_id: FORBIDDEN_TOPIC_IDS[0] }), receipt, null);
    assert.ok(v.reasons.includes("topic_forbidden_or_malformed"));
  });
});

// ── 10. replay ──────────────────────────────────────────────────────────────

describe("replay", () => {
  test("an envelope replayed against a different receipt is rejected", () => {
    const e = envelope();
    const other = clone(receipt);
    other.receipt_id = `poa_${"c".repeat(24)}`;
    other.record.nonce = "n_different";
    other.record_digest = canonicalDigest(other.record);
    const v = verifyAnchorEvidence(evidenceFor(e), other, observedFor(e));
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => r.startsWith("binding:")));
  });

  test("bytes from one envelope presented as another envelope's anchor are rejected", () => {
    const mine = envelope();
    const older = buildAnchorEnvelope(receipt, NOW - 3_600_000);
    // Same receipt, different created_at ⇒ different bytes. Presenting the old
    // message as evidence for the new envelope must not verify.
    const v = verifyAnchorEvidence(evidenceFor(mine), receipt, observedFor(older));
    assert.ok(v.reasons.includes("observed_bytes_differ_from_envelope"));
  });

  test("an identical resubmission is still detected on the topic", () => {
    const e = envelope();
    const found = findDuplicateAnchor([observedFor(e), observedFor(e, { sequence_number: 2 })], e.receipt_id, e.record_digest);
    assert.ok(found);
  });
});

// ── 11. wrong topic ─────────────────────────────────────────────────────────

describe("wrong topic", () => {
  test("the OracleNet topics are blocked by the guard", () => {
    for (const t of FORBIDDEN_TOPIC_IDS) {
      const v = evaluateAnchorGuard(guardState({ configuredTopicId: t, grant: grant({ topic_id: t }) }));
      assert.ok(v.blockers.some((b) => b.startsWith("TOPIC_FORBIDDEN")), `${t} must be refused`);
    }
  });

  test("a malformed topic id is blocked", () => {
    const v = evaluateAnchorGuard(guardState({ configuredTopicId: "not-a-topic", grant: grant({ topic_id: "not-a-topic" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("TOPIC_MALFORMED")));
  });

  test("a grant for one topic does not authorize another", () => {
    const v = evaluateAnchorGuard(guardState({ configuredTopicId: "0.0.999300", grant: grant({ topic_id: DEMO_TOPIC }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_TOPIC_MISMATCH")));
  });

  test("Grant B cannot authorize creating a topic — \"CREATE\" is not a topic id", () => {
    // Grant A owns topic creation. A submit grant that could also create one
    // would be authorizing a write to a topic nobody had inspected.
    assert.equal(parseAnchorGrant(JSON.stringify(grant({ topic_id: "CREATE" }))), null);
  });

  test("Grant B is refused while no confirmed topic read-back exists", () => {
    const v = evaluateAnchorGuard(guardState({ topicReadbackConfirmed: false }));
    assert.ok(v.blockers.some((b) => b.startsWith("NO_CONFIRMED_TOPIC")));
  });

  test("an unscanned topic blocks the run — idempotency must not depend on luck", () => {
    const v = evaluateAnchorGuard(guardState({ topicScanned: false }));
    assert.ok(v.blockers.some((b) => b.startsWith("TOPIC_NOT_SCANNED")));
  });
});

// ── 12. oversized message ───────────────────────────────────────────────────

describe("oversized message", () => {
  test("an envelope over the budget is refused", () => {
    const fat = { ...envelope(), purpose: "x".repeat(700) };
    assert.throws(
      () => assertEnvelopeWellFormed(fat),
      // The schema pins `purpose` to a literal, so an inflated one is caught as
      // a schema violation before the size check — an even earlier refusal.
      (err: unknown) => err instanceof AnchorBindingError,
    );
  });

  test("the byte budget leaves room below the protocol chunk limit", () => {
    assert.ok(ANCHOR_ENVELOPE_BYTE_BUDGET < HCS_SINGLE_CHUNK_LIMIT);
    assert.ok(anchorEnvelopeBytes(envelope()).length < ANCHOR_ENVELOPE_BYTE_BUDGET);
  });

  test("evidence declaring more than one chunk of bytes fails the schema", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { envelope_bytes: 4096 }), receipt, null);
    assert.equal(v.ok, false);
  });
});

// ── 13. missing credentials ─────────────────────────────────────────────────

describe("missing credentials", () => {
  test("no payer key blocks the run", () => {
    const v = evaluateAnchorGuard(guardState({ payerKeyPresent: false }));
    assert.ok(v.blockers.some((b) => b.startsWith("NO_CREDENTIALS")));
  });

  test("a missing grant blocks the run and is not confusable with an empty file", () => {
    assert.equal(parseAnchorGrant(null), null);
    assert.equal(parseAnchorGrant(""), null);
    assert.equal(parseAnchorGrant("{}"), null);
    assert.equal(parseAnchorGrant("not json"), null);
  });

  test("a grant document is parsed, not sensed — the magic string is required", () => {
    const good = JSON.stringify(grant());
    assert.ok(parseAnchorGrant(good));
    const wrongMagic = JSON.stringify({ ...grant(), grant: "SOMETHING_ELSE" });
    assert.equal(parseAnchorGrant(wrongMagic), null);
  });

  test("an expired grant authorizes nothing", () => {
    const v = evaluateAnchorGuard(
      guardState({ grant: grant({ expires_at: "2026-07-23T00:00:00Z" }), nowMs: Date.parse("2026-07-23T14:00:00Z") }),
    );
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_EXPIRED")));
  });

  test("a grant for another receipt authorizes nothing", () => {
    const v = evaluateAnchorGuard(guardState({ grant: grant({ receipt_id: `poa_${"d".repeat(24)}` }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_RECEIPT_MISMATCH")));
  });

  test("a grant approving other bytes does not authorize these bytes", () => {
    const v = evaluateAnchorGuard(guardState({ grant: grant({ envelope_sha256: `sha256:${"e".repeat(64)}` }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_ENVELOPE_DIGEST_MISMATCH")));
  });

  test("a grant with a fee cap above the ceiling is refused", () => {
    const v = evaluateAnchorGuard(guardState({ grant: grant({ max_transaction_fee_tinybar: "999999999" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_FEE_CAP_EXCEEDED")));
  });

  test("a grant window longer than 30 minutes is refused", () => {
    const v = evaluateAnchorGuard(guardState({ grant: grant({ expires_at: "2026-07-24T00:00:00Z" }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_WINDOW_TOO_LONG")));
  });

  test("a grant naming another anchor key is refused", () => {
    const v = evaluateAnchorGuard(guardState({ grant: grant({ anchor_key: `anc_${"0".repeat(24)}` }) }));
    assert.ok(v.blockers.some((b) => b.startsWith("GRANT_ANCHOR_KEY_MISMATCH")));
  });
});

// ── 14. dry run writes nothing to the ledger ────────────────────────────────

describe("dry run", () => {
  test("today's real state is BLOCKED, and every reason is named", () => {
    // Mirrors the repository as it stands: anchoring disabled, no grant, no topic.
    const v = evaluateAnchorGuard(
      guardState({ anchorEnabled: false, grant: null, configuredTopicId: "", topicScanned: false }),
    );
    assert.equal(v.allowed, false);
    assert.ok(v.blockers.some((b) => b.startsWith("ANCHOR_DISABLED")));
    assert.ok(v.blockers.some((b) => b.startsWith("NO_GRANT")));
  });

  test("a fully satisfied guard allows exactly one submit", () => {
    const v = evaluateAnchorGuard(guardState({}));
    assert.deepEqual(v.blockers, [], `unexpected blockers: ${v.blockers.join(", ")}`);
    assert.equal(v.allowed, true);
  });

  test("the anchor tool source imports no Hedera SDK at module scope", () => {
    const src = readFileSync(resolve("tools/anchor-receipt.ts"), "utf8");
    const topLevelImports = src.split("\n").filter((l) => /^import .* from ["']/.test(l));
    for (const line of topLevelImports) {
      assert.ok(
        !/@hiero-ledger|@hashgraph|@x402/.test(line),
        `dry run must not load an SDK at module scope: ${line}`,
      );
    }
    assert.match(src, /await import\("@hiero-ledger\/sdk"\)/, "the SDK must be imported behind the guard");
  });

  test("a full round trip verifies when the observed bytes match", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(
      evidenceFor(e, { status: "CONFIRMED", confirmed_at: "2026-07-23T14:01:00Z" }),
      receipt,
      observedFor(e),
    );
    assert.deepEqual(v.reasons, []);
    assert.equal(v.ok, true);
    assert.equal(v.observed_envelope_digest, anchorEnvelopeDigest(e));
  });
});

// ── 15. the real CP-H7F consensus record ────────────────────────────────────

describe("evidence schema against the real ledger response", () => {
  // Built from the actual mirror-node response to the CP-H7F submit. The
  // schema claimed running_hash was hex until this transaction produced a
  // base64 value and the verifier rejected our own confirmed anchor — an
  // assumption that had never met the ledger.
  const REAL_RUNNING_HASH = "ttgOeLwXoC3mvKLM7UVHuADpEJ0eB0SuAn7Sd/hFbxg7bWZ/HTr7WSKUanKhPLMd";

  test("a base64 running hash is accepted", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(
      evidenceFor(e, {
        status: "CONFIRMED",
        running_hash: REAL_RUNNING_HASH,
        running_hash_version: 3,
        charged_tx_fee_tinybar: "695405",
        max_transaction_fee_tinybar: "2000000",
        chunk: { number: 1, total: 1 },
        confirmed_at: "2026-07-23T15:00:00Z",
      }),
      receipt,
      observedFor(e),
    );
    assert.deepEqual(v.reasons, []);
    assert.equal(v.ok, true);
  });

  test("a hex-looking running hash is still fine — base64 is a superset here", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(
      evidenceFor(e, { running_hash: "deadbeef" }),
      receipt,
      observedFor(e),
    );
    assert.deepEqual(v.reasons, []);
  });

  test("a running hash with characters outside base64 is refused", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { running_hash: "not a hash!" }), receipt, observedFor(e));
    assert.ok(v.reasons.some((r) => r.startsWith("evidence_schema_invalid")));
  });

  test("a fee as a number rather than a decimal string is refused", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { charged_tx_fee_tinybar: 695405 }), receipt, observedFor(e));
    assert.ok(v.reasons.some((r) => r.startsWith("evidence_schema_invalid")));
  });

  test("receipt_unmodified must carry a null anchor field", () => {
    const e = envelope();
    const ok = verifyAnchorEvidence(
      evidenceFor(e, { receipt_unmodified: { sha256: "a".repeat(64), anchor_field: null } }),
      receipt,
      observedFor(e),
    );
    assert.deepEqual(ok.reasons, []);
    const bad = verifyAnchorEvidence(
      evidenceFor(e, { receipt_unmodified: { sha256: "a".repeat(64), anchor_field: "ANCHORED" } }),
      receipt,
      observedFor(e),
    );
    assert.ok(bad.reasons.some((r) => r.startsWith("evidence_schema_invalid")));
  });

  test("a multi-chunk message is representable and visible as such", () => {
    const e = envelope();
    const v = verifyAnchorEvidence(evidenceFor(e, { chunk: { number: 1, total: 2 } }), receipt, observedFor(e));
    assert.deepEqual(v.reasons, [], "the schema allows it — the operator has to notice it, not the validator");
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────

function grant(over: Record<string, unknown> = {}) {
  const e = envelope();
  const b = anchorEnvelopeBytes(e);
  return {
    grant: GRANT_MAGIC,
    topic_id: DEMO_TOPIC,
    receipt_id: receipt.receipt_id,
    record_digest: receipt.record_digest,
    anchor_key: anchorKey(NETWORK, e.receipt_id, e.record_digest),
    envelope_created_at: e.created_at,
    envelope_sha256: `sha256:${createHash("sha256").update(b).digest("hex")}`,
    envelope_bytes: b.length,
    max_transaction_fee_tinybar: MESSAGE_SUBMIT_MAX_FEE_TINYBAR,
    // Inside the 30-minute window measured from NOW.
    expires_at: "2026-07-23T14:20:00Z",
    network: NETWORK,
    ...over,
  } as never;
}

/** A guard state that passes by default, so each test states only what it breaks. */
function guardState(over: Partial<AnchorGuardState>): AnchorGuardState {
  return {
    grant: grant(),
    executedMarker: null,
    anchorEnabled: true,
    configuredTopicId: DEMO_TOPIC,
    payerKeyPresent: true,
    network: NETWORK,
    receiptId: receipt.receipt_id,
    recordDigest: receipt.record_digest,
    anchorKey: anchorKey(NETWORK, receipt.receipt_id, receipt.record_digest),
    envelopeSha256: `sha256:${createHash("sha256").update(anchorEnvelopeBytes(envelope())).digest("hex")}`,
    envelopeBytes: anchorEnvelopeBytes(envelope()).length,
    plannedTransactions: 1,
    duplicateOnTopic: false,
    topicScanned: true,
    topicReadbackConfirmed: true,
    nowMs: NOW,
    ...over,
  };
}
