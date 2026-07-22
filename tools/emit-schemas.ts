#!/usr/bin/env node
/**
 * Emit the canonical schemas as standalone JSON files.
 *
 * The TypeScript module is the source of truth; these files exist so that a
 * verifier written in any language can validate our receipts without running
 * our code. Regenerate with `npm run schemas:emit` whenever schemas.ts changes.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_SCHEMAS } from "../packages/shared-schemas/src/schemas.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "packages", "shared-schemas", "schemas");

mkdirSync(OUT, { recursive: true });

let n = 0;
for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
  const file = join(OUT, `${name}.v1.json`);
  writeFileSync(file, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
  console.log(`emitted ${file.slice(ROOT.length + 1)}`);
  n += 1;
}
console.log(`emit-schemas: ${n} schema(s) written`);
