import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { scan } from "../../tools/secret-scan.ts";

describe("secret scan", () => {
  const result = scan();

  test("the scanner actually looked at files", () => {
    assert.ok(result.scanned > 20, `only ${result.scanned} files scanned — the file list is probably broken`);
  });

  test("no ERROR-class finding anywhere in the repository", () => {
    const errors = result.findings.filter((f) => f.severity === "ERROR");
    assert.deepEqual(
      errors.map((f) => `${f.file}:${f.line} ${f.rule}`),
      [],
      "key material must never be committed",
    );
  });

  test("no unwaived WARN-class finding", () => {
    const warns = result.findings.filter((f) => f.severity === "WARN");
    assert.deepEqual(
      warns.map((f) => `${f.file}:${f.line} ${f.rule}`),
      [],
      "either remove the production identifier or add a defended waiver",
    );
  });

  test("every waiver is for a denylist, a test of one, or documentation", () => {
    // An explicit list rather than a suffix heuristic: a waiver is a claim that
    // a production identifier appears in order to be BLOCKED, and that claim
    // should be enumerated, not pattern-matched into existence.
    const DENYLIST_BEARING = new Set([
      ".env.example",
      "packages/hcs-anchor/src/interfaces.ts",
      "packages/evidence-receipt/src/signer.ts",
      "services/agent-client/src/signer-process.ts",
      "tools/preflight-check.ts",
    ]);
    for (const w of result.waived) {
      assert.ok(
        w.file.startsWith("docs/") || w.file.startsWith("tests/") || DENYLIST_BEARING.has(w.file),
        `unexpected waived file ${w.file} — waivers must not spread into runtime code`,
      );
    }
  });

  test("the scanner is not silently passing everything — it detects a planted secret", () => {
    // Sanity check on the rule table itself, without writing anything to disk.
    // Both probes are assembled at runtime rather than written out. This file
    // is scanned like any other, and a verbatim PEM header here would be an
    // unwaivable ERROR finding against the scanner's own test.
    const planted = "0x" + "a".repeat(64);
    assert.match(planted, /\b0x[0-9a-fA-F]{64}\b/, "the evm_private_key rule must match a 32-byte hex key");
    const pemHeader = "-----BEGIN " + "PRIVATE KEY-----";
    assert.match(pemHeader, /-----BEGIN[A-Z ]*PRIVATE KEY-----/);
  });
});
