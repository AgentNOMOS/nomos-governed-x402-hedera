/**
 * CP-H8 — the demo's anchor resolution.
 *
 * The bug this file exists to prevent is specific and was shipped once: the
 * page decided whether an anchor existed by looking at `receipt.anchor`. That
 * field is null and always will be — the receipt is signed over its canonical
 * bytes, so an anchor written into it would break the signature it carries.
 * Reading its absence as "nothing is anchored" turned the correct end state
 * into a blank page.
 *
 * Every case below therefore starts from the real CP-H7 evidence and breaks one
 * thing, because a resolver that only works on synthetic input would pass a test
 * suite and mislead a reader.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ANCHOR_LABELS,
  EXPECTED_ANCHOR,
  classifyLiveCheck,
  consensusToUtc,
  resolveAnchorState,
} from "../../apps/demo-ui/src/anchor-model.ts";
import { buildDemoEvidence } from "../../apps/demo-ui/src/evidence-model.ts";
import { anchorEnvelopeBytes, buildAnchorEnvelope } from "../../packages/hcs-anchor/src/anchor-envelope.ts";

const RECEIPT_PATH = resolve("docs/evidence/cp-h2/receipt.json");
const EVIDENCE_PATH = resolve("docs/evidence/cp-h7/anchor-evidence.json");
const receipt = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
const anchorEvidence = JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The real evidence with one thing broken. */
function broken(mutate: (e: Record<string, unknown>) => void): Record<string, unknown> {
  const e = clone(anchorEvidence);
  mutate(e);
  return e;
}

// ── 1. the confirmed case ───────────────────────────────────────────────────

describe("the real CP-H7 evidence", () => {
  test("resolves to CONFIRMED ON HEDERA TESTNET", () => {
    const r = resolveAnchorState(receipt, anchorEvidence);
    assert.equal(r.state, "CONFIRMED_ON_TESTNET");
    assert.equal(r.label, "CONFIRMED ON HEDERA TESTNET");
    assert.deepEqual(r.reasons, []);
    assert.ok(r.checks.length >= 13, `only ${r.checks.length} checks ran`);
    assert.ok(r.checks.every((c) => c.ok));
  });

  test("carries the ledger coordinates the page displays", () => {
    const r = resolveAnchorState(receipt, anchorEvidence);
    assert.equal(r.network, "hedera:testnet");
    assert.equal(r.topic_id, "0.0.9703011");
    assert.equal(r.sequence_number, 1);
    assert.equal(r.transaction_id, "0.0.9689846@1784818787.803110569");
    assert.equal(r.consensus_timestamp, "1784818806.041876104");
    assert.equal(r.envelope_bytes, 585);
    assert.equal(r.anchor_key, "anc_cd5991bdb525e4662dc6f050");
    assert.equal(r.hashscan_url, "https://hashscan.io/testnet/topic/0.0.9703011");
    assert.ok(r.transaction_id_short && r.transaction_id_short.length < r.transaction_id.length);
    assert.ok(r.record_digest_short && r.envelope_sha256_short);
  });

  test("the canonical bytes it publishes rebuild from the receipt", () => {
    const r = resolveAnchorState(receipt, anchorEvidence);
    const rebuilt = anchorEnvelopeBytes(
      buildAnchorEnvelope(receipt, Date.parse(anchorEvidence.envelope.created_at)),
    ).toString("utf8");
    assert.equal(r.envelope_canonical, rebuilt);
    assert.equal(r.envelope_canonical?.length, 585);
  });

  test("it is labelled as a testnet demonstration, not a production attestation", () => {
    const r = resolveAnchorState(receipt, anchorEvidence);
    assert.equal(r.testnet_notice, "Testnet demonstration — not a mainnet production attestation");
    assert.match(r.testnet_notice, /not a mainnet/i);
  });
});

// ── 2. missing evidence ─────────────────────────────────────────────────────

describe("missing evidence", () => {
  test("no evidence file is NOT_YET_ANCHORED, not an error", () => {
    const r = resolveAnchorState(receipt, null);
    assert.equal(r.state, "NOT_YET_ANCHORED");
    assert.equal(r.label, "NOT YET ANCHORED");
    assert.deepEqual(r.reasons, []);
    assert.equal(r.topic_id, null);
  });

  test("evidence without a receipt cannot be confirmed", () => {
    const r = resolveAnchorState(null, anchorEvidence);
    assert.equal(r.state, "ANCHOR_EVIDENCE_INVALID");
    assert.ok(r.reasons.includes("receipt_missing"));
  });
});

// ── 3–8. one broken field at a time ─────────────────────────────────────────

describe("a single wrong field is enough to refuse", () => {
  const cases: Array<[string, (e: Record<string, unknown>) => void, string]> = [
    [
      "wrong receipt id",
      (e) => {
        (e.envelope as Record<string, unknown>).receipt_id = `poa_${"f".repeat(24)}`;
      },
      "receipt_id_matches",
    ],
    [
      "wrong record digest",
      (e) => {
        (e.envelope as Record<string, unknown>).record_digest = `sha256:${"0".repeat(64)}`;
      },
      "record_digest_matches",
    ],
    [
      "wrong envelope hash",
      (e) => {
        e.envelope_digest = `sha256:${"1".repeat(64)}`;
      },
      "envelope_sha256_matches",
    ],
    ["wrong topic id", (e) => { e.topic_id = "0.0.999999"; }, "topic_id_matches"],
    ["wrong sequence number", (e) => { e.sequence_number = 2; }, "sequence_number_matches"],
    ["wrong transaction id", (e) => { e.transaction_id = "0.0.1@1.1"; }, "transaction_id_matches"],
    ["wrong envelope byte count", (e) => { e.envelope_bytes = 584; }, "envelope_bytes_match"],
    ["wrong anchor key", (e) => { e.anchor_key = `anc_${"0".repeat(24)}`; }, "anchor_key_reproducible"],
    ["wrong network", (e) => { e.network = "hedera:mainnet"; }, "network_is_testnet"],
    ["missing consensus timestamp", (e) => { e.consensus_timestamp = null; }, "consensus_timestamp_present"],
  ];

  for (const [name, mutate, expectedReason] of cases) {
    test(name, () => {
      const r = resolveAnchorState(receipt, broken(mutate));
      assert.equal(r.state, "ANCHOR_EVIDENCE_INVALID");
      assert.equal(r.label, "ANCHOR EVIDENCE INVALID");
      assert.ok(r.reasons.includes(expectedReason), `expected ${expectedReason}, got ${r.reasons.join(", ")}`);
      // Nothing is displayed from an invalid anchor.
      assert.equal(r.topic_id, null);
      assert.equal(r.consensus_timestamp, null);
    });
  }

  test("every reason is collected, not just the first", () => {
    const r = resolveAnchorState(
      receipt,
      broken((e) => {
        e.topic_id = "0.0.1";
        e.sequence_number = 9;
        e.network = "hedera:mainnet";
      }),
    );
    assert.ok(r.reasons.length >= 3, `expected several reasons, got ${r.reasons.join(", ")}`);
  });
});

// ── 9. status not CONFIRMED ─────────────────────────────────────────────────

describe("status", () => {
  test("SUBMITTED is not good enough to display as confirmed", () => {
    const r = resolveAnchorState(receipt, broken((e) => { e.status = "SUBMITTED"; }));
    assert.equal(r.state, "ANCHOR_EVIDENCE_INVALID");
    assert.ok(r.reasons.includes("status_confirmed"));
  });

  test("FAILED is not good enough either", () => {
    const r = resolveAnchorState(receipt, broken((e) => { e.status = "FAILED"; }));
    assert.ok(r.reasons.includes("status_confirmed"));
  });
});

// ── 10. mirror verification not confirmed ───────────────────────────────────

describe("independent mirror verification", () => {
  test("evidence without an independent read-back is refused", () => {
    const r = resolveAnchorState(receipt, broken((e) => { delete e.independent_verification; }));
    assert.ok(r.reasons.includes("independent_mirror_verified"));
  });

  test("a read-back that was not byte-exact is refused", () => {
    const r = resolveAnchorState(
      receipt,
      broken((e) => {
        (e.independent_verification as Record<string, unknown>).byte_exact_match = false;
      }),
    );
    assert.ok(r.reasons.includes("independent_mirror_verified"));
  });

  test("a read-back that did not pass overall is refused", () => {
    const r = resolveAnchorState(
      receipt,
      broken((e) => {
        (e.independent_verification as Record<string, unknown>).result = "PARTIAL";
      }),
    );
    assert.ok(r.reasons.includes("independent_mirror_verified"));
  });
});

// ── 11. the receipt must be untouched ───────────────────────────────────────

describe("the CP-H2 receipt is never modified", () => {
  test("it still carries anchor: null on disk", () => {
    assert.equal(receipt.anchor, null);
  });

  test("a receipt edited to carry an anchor is refused, even with good evidence", () => {
    const edited = clone(receipt);
    edited.anchor = { topic_id: "0.0.9703011", sequence_number: 1 };
    const r = resolveAnchorState(edited, anchorEvidence);
    assert.equal(r.state, "ANCHOR_EVIDENCE_INVALID");
    assert.ok(r.reasons.includes("receipt_left_unmodified"));
    assert.equal(r.receipt_unmodified, false);
  });

  test("a receipt whose record was altered breaks the digest reproduction", () => {
    const edited = clone(receipt);
    edited.record.atomic_amount = "1";
    const r = resolveAnchorState(edited, anchorEvidence);
    assert.ok(r.reasons.includes("receipt_digest_reproducible"));
  });
});

// ── 12. live verification ───────────────────────────────────────────────────

describe("live verification never becomes a claim about the anchor", () => {
  const canonical = anchorEnvelopeBytes(
    buildAnchorEnvelope(receipt, Date.parse(anchorEvidence.envelope.created_at)),
  ).toString("utf8");

  test("a network error is LIVE VERIFICATION UNAVAILABLE", () => {
    const v = classifyLiveCheck({ kind: "network_error" }, canonical);
    assert.equal(v.state, "LIVE_VERIFICATION_UNAVAILABLE");
    assert.equal(v.label, ANCHOR_LABELS.LIVE_VERIFICATION_UNAVAILABLE);
    assert.match(v.detail, /says nothing about the anchor/);
  });

  test("an HTTP error is LIVE VERIFICATION UNAVAILABLE, with the status named", () => {
    const v = classifyLiveCheck({ kind: "http_error", status: 503 }, canonical);
    assert.equal(v.state, "LIVE_VERIFICATION_UNAVAILABLE");
    assert.match(v.detail, /503/);
  });

  test("an unreachable network is never reported as unanchored or invalid", () => {
    for (const outcome of [{ kind: "network_error" as const }, { kind: "http_error" as const, status: 404 }]) {
      const v = classifyLiveCheck(outcome, canonical);
      assert.notEqual(v.state, "NOT_YET_ANCHORED" as unknown);
      assert.notEqual(v.state, "ANCHOR_EVIDENCE_INVALID");
    }
  });

  test("matching bytes confirm", () => {
    const v = classifyLiveCheck(
      { kind: "fetched", messageBase64: Buffer.from(canonical, "utf8").toString("base64") },
      canonical,
    );
    assert.equal(v.state, "CONFIRMED_ON_TESTNET");
    assert.match(v.detail, /585 bytes/);
  });

  test("differing bytes are a real finding, not an outage", () => {
    const v = classifyLiveCheck(
      { kind: "fetched", messageBase64: Buffer.from("something else", "utf8").toString("base64") },
      canonical,
    );
    assert.equal(v.state, "ANCHOR_EVIDENCE_INVALID");
    assert.match(v.detail, /byte for byte/);
  });

  test("nothing to compare against is unavailable, not invalid", () => {
    const v = classifyLiveCheck({ kind: "fetched", messageBase64: "AAAA" }, null);
    assert.equal(v.state, "LIVE_VERIFICATION_UNAVAILABLE");
  });
});

// ── 13. the page no longer renders the wrong state ──────────────────────────

describe("the built demo evidence", () => {
  const evidence = buildDemoEvidence();

  test("does not present a confirmed anchor as NOT_YET_ANCHORED", () => {
    assert.equal(evidence.anchor.state, "CONFIRMED_ON_TESTNET");
    assert.equal(evidence.receipt.anchor_status, "CONFIRMED ON HEDERA TESTNET");
    assert.doesNotMatch(JSON.stringify(evidence.cards), /NOT YET ANCHORED/);
  });

  test("still reports the receipt as unmodified", () => {
    assert.equal(evidence.receipt.anchor, null);
    assert.equal(evidence.anchor.receipt_unmodified, true);
  });

  test("makes no overreaching claim anywhere in what it ships", () => {
    const shipped = JSON.stringify(evidence).toLowerCase();
    for (const banned of [
      "permanently stored forever",
      "stored forever",
      "proves the action is true",
      "immutable production proof",
      "mainnet verified",
      "guaranteed forever",
    ]) {
      assert.ok(!shipped.includes(banned), `the page must not claim "${banned}"`);
    }
  });

  test("states what the anchor does not do", () => {
    const limits = evidence.limitations.join(" ").toLowerCase();
    assert.match(limits, /does not attest that the underlying work was correct/);
    assert.match(limits, /does not replace checking the evidence chain/);
    assert.match(limits, /anchoring is additive/);
  });
});

// ── helpers under test ──────────────────────────────────────────────────────

describe("consensus timestamp formatting", () => {
  test("renders the real consensus timestamp as UTC seconds", () => {
    assert.equal(consensusToUtc("1784818806.041876104"), "2026-07-23T15:00:06Z");
  });

  test("refuses anything that is not seconds.nanos", () => {
    for (const bad of ["", "abc", "1784818806", null]) {
      assert.equal(consensusToUtc(bad as string | null), null);
    }
  });

  test("the pinned expectations are the CP-H7F facts", () => {
    assert.equal(EXPECTED_ANCHOR.topic_id, "0.0.9703011");
    assert.equal(EXPECTED_ANCHOR.sequence_number, 1);
    assert.equal(EXPECTED_ANCHOR.receipt_id, "poa_60a1c2220acb7ef835dcdca8");
    assert.equal(EXPECTED_ANCHOR.network, "hedera:testnet");
  });
});
