#!/usr/bin/env node
/**
 * Generate a throwaway Ed25519 receipt-signing key for local development.
 *
 * This key signs RECEIPTS. It never signs a Hedera transaction and it is not,
 * and must never be, a production issuer key. The output path defaults into
 * `.local/`, which `.gitignore` excludes; the file is written with mode 0600
 * and the private key is never printed to stdout.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { LocalEd25519Signer } from "../packages/evidence-receipt/src/signer.ts";

const outPath = resolve(process.argv[2] ?? ".local/receipt-signer.key");
const kid = process.argv[3] ?? "nomos-gx402-demo-ed25519-1";

if (existsSync(outPath)) {
  console.error(`refusing to overwrite an existing key at ${outPath}`);
  console.error("delete it explicitly if you really mean to rotate.");
  process.exit(1);
}

const signer = LocalEd25519Signer.generate(kid);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, signer.exportPrivatePem(), { mode: 0o600 });

// Public material only. The private key stays on disk and out of every log.
console.log(`wrote private key  : ${outPath} (mode 0600, git-ignored)`);
console.log(`kid                : ${signer.kid}`);
console.log(`public key (hex)   : ${signer.publicKeyHex}`);
console.log("");
console.log("Publish the kid + public key so verifiers can check receipts without trusting them.");
