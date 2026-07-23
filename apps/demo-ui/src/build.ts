#!/usr/bin/env node
/**
 * Generates `apps/demo-ui/public/evidence-data.js` from the canonical CP-H2
 * artifacts.
 *
 *   node apps/demo-ui/src/build.ts          # write
 *   node apps/demo-ui/src/build.ts --check  # verify the committed file is current
 *
 * The page is a static file that must work from `file://` as well as from a
 * server, so the evidence travels as a classic script assigning one frozen
 * global rather than as JSON fetched at runtime. It is generated, committed,
 * and pinned by `tests/unit/demo-ui-evidence.test.ts`, which fails if the
 * committed copy drifts from what the model produces today.
 *
 * If `buildDemoEvidence()` throws, nothing is written. A page that cannot prove
 * its own numbers must not render at all — the previous file stays in place and
 * the failure is loud.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoEvidence, REPO_ROOT, type DemoEvidence } from "./evidence-model.ts";

export const GENERATED_FILE = "apps/demo-ui/public/evidence-data.js";

const BANNER = [
  "/**",
  " * GENERATED FILE — do not edit.",
  " *",
  " * Produced by `node apps/demo-ui/src/build.ts` from the canonical artifacts",
  " * listed in `sources` below. Every value on the demo page comes from here.",
  " *",
  " * Read-only by construction: the object is deep-frozen and the page never",
  " * writes to it. There is no payment path, no wallet and no network call.",
  " */",
].join("\n");

/** The exact bytes the committed file must contain for the given evidence. */
export function renderEvidenceModule(evidence: DemoEvidence): string {
  const json = JSON.stringify(evidence, null, 2);
  return `${BANNER}
(function (root) {
  "use strict";

  var EVIDENCE = ${json};

  function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  root.__NOMOS_EVIDENCE__ = deepFreeze(EVIDENCE);
})(typeof globalThis !== "undefined" ? globalThis : this);
`;
}

export function currentModuleText(root: string = REPO_ROOT): string {
  return renderEvidenceModule(buildDemoEvidence(root));
}

function main(): void {
  const check = process.argv.includes("--check");
  const target = join(REPO_ROOT, GENERATED_FILE);
  const next = currentModuleText();

  if (check) {
    if (!existsSync(target)) {
      console.error(`demo-ui: ${GENERATED_FILE} is missing — run \`npm run demo:build\``);
      process.exit(1);
    }
    if (readFileSync(target, "utf8") !== next) {
      console.error(`demo-ui: ${GENERATED_FILE} is stale — run \`npm run demo:build\``);
      process.exit(1);
    }
    console.log(`demo-ui: ${GENERATED_FILE} is current`);
    return;
  }

  writeFileSync(target, next, "utf8");
  console.log(`demo-ui: wrote ${GENERATED_FILE} (${next.length} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
