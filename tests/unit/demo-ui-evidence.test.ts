/**
 * The demo UI's evidence model (CP-H8).
 *
 * These tests exist to stop one specific failure: a presentation layer that
 * drifts away from the artifacts it claims to present. Every assertion here
 * re-reads a canonical file and compares it with what the page would show, and
 * the tamper cases check that a disagreement stops the build rather than
 * decorating the page with a value nobody can defend.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildDemoEvidence,
  tinybarToHbar,
  consensusToUtc,
  toMirrorTransactionId,
  parseSuiteRecord,
  parseScanRecord,
  EvidenceIntegrityError,
  EVIDENCE_SOURCES,
  REPORT_TRANSCRIBED,
  REPO_ROOT,
} from "../../apps/demo-ui/src/evidence-model.ts";
import { renderEvidenceModule, GENERATED_FILE } from "../../apps/demo-ui/src/build.ts";
import { canonicalDigest } from "../../packages/shared-schemas/src/canonical.ts";

const evidence = buildDemoEvidence();

function artifact(rel: string): any {
  return JSON.parse(readFileSync(join(REPO_ROOT, rel), "utf8"));
}

const receipt = artifact(EVIDENCE_SOURCES.receipt);
const settlementDoc = artifact(EVIDENCE_SOURCES.settlement);
const resultDoc = artifact(EVIDENCE_SOURCES.result);
const run = artifact(EVIDENCE_SOURCES.executeRun);
const report = readFileSync(join(REPO_ROOT, EVIDENCE_SOURCES.report), "utf8");

/** A throwaway repo root holding a mutated copy of the evidence tree. */
function withMutatedArtifacts(mutate: (files: Record<string, any>) => void): () => void {
  const root = mkdtempSync(join(tmpdir(), "nomos-demo-ui-"));
  mkdirSync(join(root, "docs", "evidence", "cp-h2"), { recursive: true });
  cpSync(join(REPO_ROOT, "docs", "evidence"), join(root, "docs", "evidence"), { recursive: true });

  const files: Record<string, any> = {
    receipt: artifact(EVIDENCE_SOURCES.receipt),
    settlement: artifact(EVIDENCE_SOURCES.settlement),
    result: artifact(EVIDENCE_SOURCES.result),
    executeRun: artifact(EVIDENCE_SOURCES.executeRun),
  };
  mutate(files);
  for (const key of Object.keys(files)) {
    const rel = EVIDENCE_SOURCES[key as keyof typeof EVIDENCE_SOURCES];
    writeFileSync(join(root, rel), JSON.stringify(files[key], null, 2), "utf8");
  }

  return () => {
    try {
      buildDemoEvidence(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

describe("demo UI — values match the canonical artifacts", () => {
  test("the settled transaction is the one the receipt describes", () => {
    assert.equal(evidence.chain.transaction_id, receipt.record.hedera_transaction_id);
    assert.equal(evidence.chain.transaction_id, settlementDoc.settlement.transaction_id);
    assert.equal(evidence.chain.consensus_timestamp, receipt.record.consensus_timestamp);
    assert.equal(evidence.chain.transaction_status, "SUCCESS");
  });

  test("the memo shown IS the quote id, in both artifacts", () => {
    assert.equal(evidence.chain.memo, settlementDoc.settlement.memo);
    assert.equal(evidence.chain.quote_id, receipt.record.quote_id);
    assert.equal(evidence.chain.memo, evidence.chain.quote_id);
    assert.equal(evidence.chain.memo, run.challenge.accepts[0].memo);
  });

  test("amount, payer, payee and alias are transcribed from the artifacts", () => {
    assert.equal(evidence.chain.atomic_amount, receipt.record.atomic_amount);
    assert.equal(evidence.chain.amount_display, "0.05 HBAR");
    assert.equal(evidence.chain.payer, receipt.record.payer);
    assert.equal(evidence.chain.payee, receipt.record.payee);
    assert.equal(evidence.chain.payee_evm_alias, run.offer.pay_to);
    assert.equal(evidence.chain.fee_payer, run.payment_requirements.extra.feePayer);
  });

  test("the receipt block matches receipt.json field for field", () => {
    assert.equal(evidence.receipt.receipt_id, receipt.receipt_id);
    assert.equal(evidence.receipt.record_digest, receipt.record_digest);
    assert.equal(evidence.receipt.signature.kid, receipt.signature.kid);
    assert.equal(evidence.receipt.signature.public_key_hex, receipt.signature.public_key_hex);
    assert.deepEqual(evidence.receipt.record, receipt.record);
  });

  test("the record digest recomputes from the record it describes", () => {
    assert.equal(canonicalDigest(evidence.receipt.record), evidence.receipt.record_digest);
  });

  test("the delivered result hashes to the value in the receipt", () => {
    assert.equal(canonicalDigest(resultDoc.result), evidence.delivery.result_hash);
    assert.equal(evidence.delivery.result_hash, receipt.record.result_hash);
    assert.equal(evidence.delivery.result_byte_length, settlementDoc.delivery.result_byte_length);
  });

  test("the fail-closed section is read from the run that produced the refusal", () => {
    assert.equal(evidence.failClosed.http_status, run.paid_status);
    assert.equal(evidence.failClosed.error, run.paid_body.error);
    assert.equal(evidence.failClosed.outcome, run.outcome);
    assert.equal(evidence.failClosed.observed.atomic_amount, run.paid_body.settlement.atomic_amount);
    assert.equal(evidence.failClosed.observed.payer, run.paid_body.settlement.payer);
    assert.equal(evidence.failClosed.observed.finality, run.paid_body.settlement.finality);
    assert.equal(evidence.failClosed.observed.memo, "null");
    assert.equal(run.paid_body.settlement.memo, null);
  });

  test("the policy panel carries every check from the signed decision receipt", () => {
    const source = run.challenge.decision_receipt.record.checks;
    assert.equal(evidence.policy.checks.length, source.length);
    assert.deepEqual(
      evidence.policy.checks.map((c) => c.code),
      source.map((c: any) => c.code),
    );
    assert.equal(evidence.policy.decision_id, receipt.record.decision_id);
    assert.equal(evidence.policy.policy_hash, receipt.record.policy_hash);
  });

  test("the explorer links point at this transaction, on testnet", () => {
    const mirrorId = toMirrorTransactionId(evidence.chain.transaction_id);
    assert.equal(evidence.chain.hashscan_url, `https://hashscan.io/testnet/transaction/${mirrorId}`);
    assert.equal(evidence.chain.mirror_url, `https://testnet.mirrornode.hedera.com/api/v1/transactions/${mirrorId}`);
    assert.equal(evidence.chain.hashscan_url, receipt.verification.hashscan_transaction_url);
    assert.equal(evidence.chain.mirror_url, receipt.verification.mirror_transaction_url);
  });
});

describe("demo UI — the strings taken from the prose report are still there", () => {
  for (const [key, value] of Object.entries(REPORT_TRANSCRIBED)) {
    if (key === "ref") continue;
    test(`${key} still appears verbatim in ${EVIDENCE_SOURCES.report}`, () => {
      assert.ok(report.includes(value), `"${value}" is no longer in the report`);
    });
  }

  test("the recorded test count is parsed, not typed in, and is labelled as CP-H2", () => {
    const suite = parseSuiteRecord(report);
    const row = evidence.verification.find((v) => v.id === "tests");
    assert.ok(row, "the test-suite row is missing");
    assert.equal(row.result, `${suite.pass} / ${suite.tests}`);
    assert.match(row.check, /CP-H2/, "the figure must be labelled as of that checkpoint, not restated as current");
  });

  test("the recorded scan verdict is parsed, not typed in", () => {
    const scan = parseScanRecord(report);
    const row = evidence.verification.find((v) => v.id === "scan");
    assert.ok(row, "the secret-scan row is missing");
    assert.equal(row.result, scan.verdict);
    assert.match(row.detail, new RegExp(`${scan.files} files scanned`));
  });

  test("a report whose suite is no longer green is refused", () => {
    assert.throws(() => parseSuiteRecord("# tests 250   # pass 249   # fail 1"), EvidenceIntegrityError);
    assert.throws(() => parseSuiteRecord("no counts here"), EvidenceIntegrityError);
  });
});

describe("demo UI — the anchor comes from linked evidence, never from the receipt", () => {
  test("the canonical receipt still carries no anchor, and that is the point", () => {
    // The signed artifact was never edited. The status the page shows is
    // resolved from docs/evidence/cp-h7/anchor-evidence.json instead.
    assert.equal(receipt.anchor, null);
    assert.equal(evidence.receipt.anchor, null);
    assert.equal(evidence.receipt.anchor_status, "CONFIRMED ON HEDERA TESTNET");
    assert.equal(evidence.anchor.receipt_unmodified, true);
  });

  test("the anchor card reports the confirmed state", () => {
    const card = evidence.cards.find((c) => c.id === "anchor");
    assert.ok(card);
    assert.equal(card.state, "verified");
    assert.equal(card.value, "CONFIRMED ON HEDERA TESTNET");
    assert.match(card.note, /0\.0\.9703011/);
  });

  test("a receipt edited to carry an anchor stops the build", () => {
    // Unchanged in force, inverted in meaning: an inline anchor is now refused
    // because it would have broken the signature, not because the page is
    // unable to present one.
    assert.throws(
      withMutatedArtifacts((files) => {
        files.receipt.anchor = {
          topic_id: "0.0.1",
          sequence_number: 1,
          transaction_id: "0.0.1@1.1",
          anchored_digest: files.receipt.record_digest,
        };
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "RECEIPT_MODIFIED",
    );
  });

  test("the demo no longer renders NOT_YET_ANCHORED for an anchored receipt", () => {
    assert.notEqual(evidence.anchor.state, "NOT_YET_ANCHORED");
    assert.equal(evidence.anchor.state, "CONFIRMED_ON_TESTNET");
    assert.doesNotMatch(JSON.stringify(evidence.cards), /NOT YET ANCHORED/);
  });
});

describe("demo UI — the model fails closed", () => {
  test("a memo that no longer equals the quote id stops the build", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.settlement.settlement.memo = "q_somethingelse00000000000";
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "MEMO_QUOTE_BINDING_BROKEN",
    );
  });

  test("a receipt and a settlement that disagree on the amount stop the build", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.settlement.settlement.atomic_amount = "1";
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "SETTLEMENT_RECEIPT_DISAGREE",
    );
  });

  test("a tampered record — the digest no longer matching — stops the build", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.receipt.record.atomic_amount = "1";
        files.settlement.settlement.atomic_amount = "1";
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "RECORD_DIGEST_MISMATCH",
    );
  });

  test("an unverified settlement stops the build", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.settlement.settlement.verified = false;
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "SETTLEMENT_NOT_VERIFIED",
    );
  });

  test("a mock settlement stops the build — the page must never imply a real payment", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.settlement.verification.mock_settlement = true;
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "MOCK_SETTLEMENT",
    );
  });

  test("any network other than hedera:testnet stops the build", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.receipt.record.network = "hedera:mainnet";
        files.settlement.settlement.network = "hedera:mainnet";
      }),
      EvidenceIntegrityError,
    );
  });

  test("a result whose hash no longer reproduces stops the build", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.result.result.summary.pass = 99;
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "RESULT_DIGEST_UNREPRODUCIBLE",
    );
  });

  test("removing the recorded refusal stops the build — the fail-closed section may not be fiction", () => {
    assert.throws(
      withMutatedArtifacts((files) => {
        files.executeRun.outcome = "EXECUTE_OK";
      }),
      (err: unknown) => err instanceof EvidenceIntegrityError && err.code === "FAIL_CLOSED_EPISODE_MISSING",
    );
  });
});

describe("demo UI — derivations", () => {
  test("tinybar converts to HBAR with integer arithmetic only", () => {
    assert.equal(tinybarToHbar("5000000"), "0.05");
    assert.equal(tinybarToHbar("100000000"), "1");
    assert.equal(tinybarToHbar("1"), "0.00000001");
    assert.equal(tinybarToHbar("0"), "0");
    assert.equal(tinybarToHbar("123456789"), "1.23456789");
    assert.equal(tinybarToHbar("999620000000"), "9996.2");
  });

  test("a non-integer atomic amount is refused rather than rounded", () => {
    assert.throws(() => tinybarToHbar("0.05"), EvidenceIntegrityError);
    assert.throws(() => tinybarToHbar("5e6"), EvidenceIntegrityError);
    assert.throws(() => tinybarToHbar(""), EvidenceIntegrityError);
  });

  test("the consensus timestamp renders as UTC", () => {
    assert.equal(consensusToUtc("1784746993.237232768"), evidence.chain.consensus_utc);
    assert.match(evidence.chain.consensus_utc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.throws(() => consensusToUtc("not-a-timestamp"), EvidenceIntegrityError);
  });

  test("transaction ids convert to the mirror/HashScan dashed form", () => {
    assert.equal(toMirrorTransactionId("0.0.7162784@1784746988.798231156"), "0.0.7162784-1784746988-798231156");
    assert.throws(() => toMirrorTransactionId("0.0.7162784"), EvidenceIntegrityError);
  });
});

describe("demo UI — the generated module", () => {
  test("the committed evidence-data.js is current", () => {
    const committed = readFileSync(join(REPO_ROOT, GENERATED_FILE), "utf8");
    assert.equal(
      committed,
      renderEvidenceModule(evidence),
      `${GENERATED_FILE} is stale — run \`npm run demo:build\``,
    );
  });

  test("it declares exactly the artifacts it read", () => {
    assert.deepEqual([...evidence.sources].sort(), Object.values(EVIDENCE_SOURCES).sort());
  });

  test("it carries no key material and no filesystem path into the repo's private corners", () => {
    const text = readFileSync(join(REPO_ROOT, GENERATED_FILE), "utf8");
    assert.doesNotMatch(text, /-----BEGIN[A-Z ]*PRIVATE KEY-----/);
    assert.doesNotMatch(text, /\b0x[0-9a-fA-F]{64}\b/, "a 32-byte hex value would look exactly like a private key");
    assert.doesNotMatch(text, /\.local\//, "the key directory must never be named in a shipped file");
    assert.doesNotMatch(text, /\/root\//, "no absolute path from this machine may ship");
    assert.doesNotMatch(text, /\/srv\/nomos\//);
  });

  test("it is a plain data module — no fetch, no import, no side effect beyond one global", () => {
    const text = readFileSync(join(REPO_ROOT, GENERATED_FILE), "utf8");
    assert.doesNotMatch(text, /\bfetch\s*\(/);
    assert.doesNotMatch(text, /XMLHttpRequest|WebSocket|sendBeacon|importScripts/);
    assert.doesNotMatch(text, /\bimport\s*\(/);
    assert.equal(text.match(/root\.__NOMOS_EVIDENCE__/g)?.length, 1);
  });

  test("the evidence it exposes is deep-frozen", async () => {
    const globals = globalThis as Record<string, any>;
    const before = globals.__NOMOS_EVIDENCE__;
    try {
      await import(join(REPO_ROOT, GENERATED_FILE));
      const loaded = globals.__NOMOS_EVIDENCE__;
      assert.ok(Object.isFrozen(loaded));
      assert.ok(Object.isFrozen(loaded.chain));
      assert.ok(Object.isFrozen(loaded.cards[0]));
      assert.equal(loaded.chain.transaction_id, evidence.chain.transaction_id);
    } finally {
      globals.__NOMOS_EVIDENCE__ = before;
    }
  });
});

describe("demo UI — shape the page depends on", () => {
  test("the flow is the eight governed steps, numbered in order", () => {
    assert.deepEqual(
      evidence.flow.map((s) => s.index),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
    assert.deepEqual(
      evidence.flow.map((s) => s.id),
      ["request", "policy", "quote", "x402", "settlement", "mirror", "receipt", "adversarial"],
    );
    for (const step of evidence.flow) {
      assert.ok(step.facts.length > 0, `step ${step.id} carries no facts`);
      assert.ok(step.evidence_ref.length > 0, `step ${step.id} names no evidence`);
    }
  });

  test("every proof-summary card required by the checkpoint is present", () => {
    assert.deepEqual(
      evidence.cards.map((c) => c.id),
      ["transaction", "network", "amount", "receipt", "tamper", "replay", "anchor"],
    );
  });

  test("the data mode is stated as recorded evidence, never as live", () => {
    assert.equal(evidence.data_mode, "RECORDED_EVIDENCE");
    assert.equal(evidence.environment, "TESTNET_DEMO_ONLY");
  });

  test("adversarial checks are shown as fired-and-held, not as passive passes", () => {
    const tamper = evidence.verification.find((v) => v.id === "tamper");
    const replay = evidence.verification.find((v) => v.id === "replay");
    assert.equal(tamper?.state, "detected");
    assert.equal(replay?.state, "detected");
  });

  test("HashScan is presented as a presentation check, not as verification", () => {
    const row = evidence.verification.find((v) => v.id === "hashscan");
    assert.ok(row);
    assert.equal(row.state, "pending");
    assert.match(row.detail, /Mirror Node/);
  });

  test("the limitations state the testnet, HCS and audit boundaries", () => {
    const all = evidence.limitations.join(" ").toLowerCase();
    assert.match(all, /testnet/);
    // "pending CP-H7" is gone: it is done. What replaced it states what the
    // anchor does and does not attest.
    assert.doesNotMatch(all, /pending cp-h7/);
    assert.match(all, /does not attest that the underlying work was correct/);
    assert.match(all, /anchoring is additive/);
    assert.match(all, /no mainnet deployment exists/);
    assert.match(all, /no independent third party has audited/);
    assert.match(all, /no wallet connection/);
  });
});
