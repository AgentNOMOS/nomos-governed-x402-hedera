import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MockHcsAnchor,
  buildAnchorPayload,
  anchorPayloadBytes,
  assertTopicAllowed,
  TopicBoundaryError,
  FORBIDDEN_TOPIC_IDS,
  HCS_SINGLE_CHUNK_LIMIT,
} from "../../packages/hcs-anchor/src/index.ts";
import { canonicalDigest, fixedClock, assertValid, HCS_ANCHOR_REFERENCE_SCHEMA } from "../../packages/shared-schemas/src/index.ts";
import { DEMO_TOPIC, T0 } from "../helpers/fixtures.ts";

const clock = fixedClock(T0);
const DIGEST = canonicalDigest({ example: "receipt record" });
const RECEIPT_ID = `poa_${"a".repeat(24)}`;

describe("topic boundary", () => {
  test("the pre-existing OracleNet topics are refused by name", () => {
    for (const t of FORBIDDEN_TOPIC_IDS) {
      assert.throws(() => assertTopicAllowed(t), TopicBoundaryError, `${t} must be refused`);
    }
  });

  test("the mainnet production beacon topic is among them", () => {
    assert.ok((FORBIDDEN_TOPIC_IDS as readonly string[]).includes("0.0.10420280"));
  });

  test("a malformed topic id is refused", () => {
    for (const bad of ["0.0", "abc", "0.0.1.2", ""]) {
      assert.throws(() => assertTopicAllowed(bad));
    }
  });

  test("a fresh project topic is allowed", () => {
    assert.doesNotThrow(() => assertTopicAllowed(DEMO_TOPIC));
  });

  test("anchoring to a forbidden topic throws before any submission logic runs", async () => {
    const a = new MockHcsAnchor({ clock });
    await assert.rejects(
      a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: "0.0.10420280" }),
      TopicBoundaryError,
    );
  });
});

describe("anchor payload — only the digest leaves the building", () => {
  test("the payload has exactly five fields and none can hold content", () => {
    const p = buildAnchorPayload(DIGEST, RECEIPT_ID, Date.parse(T0));
    assert.deepEqual(Object.keys(p).sort(), ["d", "env", "r", "t", "ts"]);
    assert.equal(p.d, DIGEST);
    assert.equal(p.env, "TESTNET_DEMO_ONLY");
  });

  test("the payload fits in a single HCS chunk with room to spare", () => {
    const bytes = anchorPayloadBytes(buildAnchorPayload(DIGEST, RECEIPT_ID, Date.parse(T0)));
    assert.ok(bytes < HCS_SINGLE_CHUNK_LIMIT / 4, `payload is ${bytes} bytes`);
  });

  test("a malformed digest is refused", () => {
    assert.throws(() => buildAnchorPayload("not-a-digest", RECEIPT_ID, 0), /MALFORMED_DIGEST/);
  });

  test("the payload is byte-stable for the same inputs", () => {
    const a = anchorPayloadBytes(buildAnchorPayload(DIGEST, RECEIPT_ID, Date.parse(T0)));
    const b = anchorPayloadBytes(buildAnchorPayload(DIGEST, RECEIPT_ID, Date.parse(T0)));
    assert.equal(a, b);
  });
});

describe("mock anchor — offline, honest, additive", () => {
  test("a successful anchor returns a complete reference", async () => {
    const a = new MockHcsAnchor({ clock });
    const res = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    assert.equal(res.source, "MOCK_OFFLINE", "nothing was submitted to Hedera");
    assert.equal(res.status, "ANCHORED");
    assert.equal(res.anchored_digest, DIGEST);
    assert.equal(res.topic_id, DEMO_TOPIC);
    assert.equal(res.sequence_number, 1);
    assert.ok(res.transaction_id);
    assert.ok(res.hashscan_url?.includes(DEMO_TOPIC));
    assert.doesNotThrow(() => assertValid(res, HCS_ANCHOR_REFERENCE_SCHEMA));
  });

  test("sequence numbers advance per submission", async () => {
    const a = new MockHcsAnchor({ clock });
    const first = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    const second = await a.anchorReceiptHash({ record_digest: canonicalDigest({ other: 1 }), receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    assert.equal(first.sequence_number, 1);
    assert.equal(second.sequence_number, 2);
  });

  test("read-back confirms the digest that was submitted", async () => {
    const a = new MockHcsAnchor({ clock });
    const res = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    const v = await a.verifyAnchor(res, DIGEST);
    assert.equal(v.ok, true);
    assert.equal(v.observed_digest, DIGEST);
  });

  test("a topic that returns a different digest fails verification", async () => {
    const a = new MockHcsAnchor({ clock, overrideObservedDigest: canonicalDigest({ tampered: true }) });
    const res = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    const v = await a.verifyAnchor(res, DIGEST);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("digest_mismatch"));
  });

  test("a chain-side failure DEGRADES to a status, it never throws", async () => {
    for (const forced of ["PENDING", "FAILED"] as const) {
      const a = new MockHcsAnchor({ clock, forceStatus: forced });
      const res = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
      assert.equal(res.status, forced);
      assert.equal(res.anchored_digest, DIGEST, "the digest is still reported so a retry is possible");
      assert.equal(res.topic_id, null);
      assert.doesNotThrow(() => assertValid(res, HCS_ANCHOR_REFERENCE_SCHEMA));
    }
  });

  test("verifying a non-anchored reference reports why, without throwing", async () => {
    const a = new MockHcsAnchor({ clock, forceStatus: "PENDING" });
    const res = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    const v = await a.verifyAnchor(res, DIGEST);
    assert.equal(v.ok, false);
    assert.deepEqual(v.reasons, ["anchor_status_pending"]);
  });

  test("retrying an anchor for the same digest is safe and idempotent in effect", async () => {
    const a = new MockHcsAnchor({ clock });
    const r1 = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    const r2 = await a.anchorReceiptHash({ record_digest: DIGEST, receipt_id: RECEIPT_ID, topic_id: DEMO_TOPIC });
    assert.equal(r1.anchored_digest, r2.anchored_digest);
    assert.ok((await a.verifyAnchor(r2, DIGEST)).ok);
  });
});
