#!/usr/bin/env node
/**
 * Generate a fresh Hedera testnet demo keypair — locally, offline, once.
 *
 *   node tools/hedera-keygen.ts payer   [--force]
 *   node tools/hedera-keygen.ts payee   [--force]
 *
 * The private key is written to `.local/hedera-<role>.key` with mode 0600 and
 * is never printed. What IS printed is public material only: the derived EVM
 * address and the public key. The EVM address is what goes into the Hedera
 * testnet faucet to auto-create and fund the account.
 *
 * ECDSA secp256k1 is used deliberately: the faucet's auto-account-creation
 * flow keys off an EVM address, which only an ECDSA key has. An ED25519 key
 * would need a portal account instead.
 *
 * This tool performs **no** network I/O and creates **no** account. It makes a
 * keypair and stops.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { PrivateKey } from "@x402/hedera";

const ROLES = new Set(["payer", "payee"]);

function main(): void {
  const role = process.argv[2];
  const force = process.argv.includes("--force");

  if (!role || !ROLES.has(role)) {
    console.error("usage: node tools/hedera-keygen.ts <payer|payee> [--force]");
    process.exit(2);
  }

  const keyPath = resolve(`.local/hedera-${role}.key`);
  if (existsSync(keyPath) && !force) {
    console.error(`refusing to overwrite ${keyPath}`);
    console.error("a rotated key orphans whatever the old one funded; pass --force if you mean it.");
    process.exit(1);
  }

  const key = PrivateKey.generateECDSA();
  const evmAddress = `0x${key.publicKey.toEvmAddress()}`;

  mkdirSync(dirname(keyPath), { recursive: true });
  // The DER string, and nothing else. No JSON wrapper that might tempt someone
  // to `cat` the file into a report.
  writeFileSync(keyPath, `${key.toStringDer()}\n`, { mode: 0o600 });

  console.log(`role             : ${role}`);
  console.log(`key type         : ECDSA_SECP256K1`);
  console.log(`private key file : ${keyPath}  (mode 0600, git-ignored, NEVER printed)`);
  console.log(`public key (hex) : ${key.publicKey.toStringRaw()}`);
  console.log(`EVM address      : ${evmAddress}`);
  console.log("");
  console.log("Next: fund this EVM address at https://portal.hedera.com/faucet");
  console.log("      (testnet only — the tokens have no economic value)");
  console.log("Then: node tools/resolve-account.ts", role);
}

main();
