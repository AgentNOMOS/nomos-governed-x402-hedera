#!/usr/bin/env node
/**
 * Standalone receipt verifier.
 *
 *   node tools/verify-receipt.ts <receipt.json> [kid=publicKeyHex ...]
 *
 * The point of this file is that it can be run by someone who does not trust
 * us, against a receipt we produced, with no server, no network and no install.
 * It recomputes every digest from the receipt's own contents and checks the
 * signature against the key set the *caller* supplies — not the one the receipt
 * asserts about itself.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyProofOfActionReceipt } from "../packages/evidence-receipt/src/receipt.ts";

function main(): void {
  const [file, ...keyArgs] = process.argv.slice(2);
  if (!file) {
    console.error("usage: node tools/verify-receipt.ts <receipt.json> [kid=publicKeyHex ...]");
    process.exit(2);
  }

  const receipt = JSON.parse(readFileSync(resolve(file), "utf8"));
  const trustedKeys: Record<string, string> = {};
  for (const arg of keyArgs) {
    const i = arg.indexOf("=");
    if (i < 0) {
      console.error(`bad key argument "${arg}" — expected kid=publicKeyHex`);
      process.exit(2);
    }
    trustedKeys[arg.slice(0, i)] = arg.slice(i + 1);
  }

  const hasKeys = Object.keys(trustedKeys).length > 0;
  const v = verifyProofOfActionReceipt(receipt, hasKeys ? { trustedKeys } : {});

  console.log(`receipt   : ${receipt.receipt_id ?? "<none>"}`);
  console.log(`digest    : ${receipt.record_digest ?? "<none>"}`);
  console.log(`verdict   : ${v.ok ? "VALID" : "INVALID"}`);
  if (!hasKeys) {
    console.log("warning   : no key set supplied — the signature was checked against the key");
    console.log("            inside the document, which proves integrity but not authorship.");
  }
  if (v.mock_settlement) {
    console.log("warning   : settlement_source is MOCK_OFFLINE — this receipt does NOT evidence");
    console.log("            a real on-chain payment.");
  }
  if (!v.ok) {
    for (const r of v.reasons) console.log(`  reason  : ${r}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
