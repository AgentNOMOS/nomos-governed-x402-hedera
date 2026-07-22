#!/usr/bin/env node
/**
 * Resolve a funded demo key to its Hedera account id — read-only.
 *
 *   node tools/resolve-account.ts <payer|payee>
 *
 * After the faucet funds an EVM address, Hedera auto-creates an account whose
 * alias is that address. This asks the public mirror node what account id it
 * got, and reports the balance. It reads the private key only far enough to
 * derive the public EVM address, and prints neither the key nor anything
 * derived from it beyond that public address.
 *
 * No transaction. No signature. Two GETs.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrivateKey } from "@x402/hedera";

import { fetchAccount, MIRROR_TESTNET_BASE } from "../packages/hedera-x402-adapter/src/mirror.ts";

async function main(): Promise<void> {
  const role = process.argv[2];
  if (!role || !["payer", "payee"].includes(role)) {
    console.error("usage: node tools/resolve-account.ts <payer|payee>");
    process.exit(2);
  }

  const keyPath = resolve(`.local/hedera-${role}.key`);
  if (!existsSync(keyPath)) {
    console.error(`no key at ${keyPath} — run: node tools/hedera-keygen.ts ${role}`);
    process.exit(1);
  }

  const key = PrivateKey.fromStringECDSA(readFileSync(keyPath, "utf8").trim());
  const evmAddress = `0x${key.publicKey.toEvmAddress()}`;

  console.log(`role        : ${role}`);
  console.log(`EVM address : ${evmAddress}`);

  const account = await fetchAccount(evmAddress, MIRROR_TESTNET_BASE);
  if (!account) {
    console.log(`account     : NOT FOUND`);
    console.log("");
    console.log("The faucet has not created this account yet, or has not settled.");
    console.log(`Fund it at https://portal.hedera.com/faucet using the EVM address above.`);
    process.exit(3);
  }

  const tinybars = BigInt(account.balance?.balance ?? 0);
  console.log(`account id  : ${account.account}`);
  console.log(`balance     : ${tinybars.toString()} tinybar (${Number(tinybars) / 1e8} HBAR)`);
  console.log(`key type    : ${account.key?._type ?? "<none — hollow account>"}`);
  console.log(`deleted     : ${account.deleted}`);

  if (!account.key?._type) {
    console.log("");
    console.log("NOTE: this is a hollow account — it has an EVM alias but no exposed key yet.");
    console.log("It becomes a full account the first time it signs a transaction. For the payer");
    console.log("that happens automatically on the first payment; a payee never needs to sign.");
  }
}

main().catch((e) => {
  console.error(`resolve-account failed: ${(e as Error).message}`);
  process.exit(1);
});
