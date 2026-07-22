#!/usr/bin/env node
/**
 * The isolated payment signer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Runs as its OWN PROCESS. stdin is the payment challenge, stdout is the
 *  `payment-signature` header value. Nothing else crosses the boundary.
 *
 *  The payer private key is read from a 0600 file inside this process and is
 *  never returned, logged, echoed in an error, or placed in any structure the
 *  caller receives. The agent that drives the HTTP flow — and, in a deployment
 *  where that agent is an LLM, its context window — therefore never holds the
 *  key. It holds a signature.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Protocol (one JSON object per invocation, on stdin):
 *
 *   { "requirements": { scheme, network, asset, amount, payTo,
 *                       maxTimeoutSeconds, extra: { feePayer } },
 *     "memo": "q_…",
 *     "accountId": "0.0.…",
 *     "keyPath": ".local/hedera-payer.key",
 *     "keyType": "ECDSA_SECP256K1" }
 *
 * stdout: base64(JSON({ x402Version, scheme, network, payload: { transaction } }))
 *
 * Swapping this for an HSM, a KMS or the Hiero CLI means replacing this file
 * and nothing else — the contract is bytes in, bytes out.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ExactHederaScheme } from "@x402/hedera/exact/client";

import {
  createMemoBindingHederaSigner,
  parsePayerKey,
  type HederaKeyType,
} from "../../../packages/hedera-x402-adapter/src/hedera-signer.ts";

const X402_VERSION = 2;

/** Paths this signer must never read a key from. Same list as the receipt signer. */
const FORBIDDEN_KEY_PREFIXES = [
  "/srv/nomos/signing",
  "/srv/nomos/verify",
  "/opt/nomos-",
  "/root/.hedera-",
  "/root/ops/sec_hedera_a1_quarantine",
];

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let input: any;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("stdin was not a JSON object");
  }

  const { requirements, memo, accountId, keyPath, keyType } = input;

  if (requirements?.network !== "hedera:testnet") {
    throw new Error(`refusing to sign for network ${String(requirements?.network)} — testnet only`);
  }
  if (typeof memo !== "string" || memo.length === 0) {
    throw new Error("memo (quote id) is required — an unbound payment is not signed here");
  }
  if (typeof accountId !== "string" || !/^\d+\.\d+\.\d+$/.test(accountId)) {
    throw new Error("accountId must be a Hedera account id");
  }

  const abs = resolve(String(keyPath ?? ".local/hedera-payer.key"));
  for (const bad of FORBIDDEN_KEY_PREFIXES) {
    if (abs.startsWith(bad)) {
      throw new Error(`refusing to read a key from ${abs} — that path belongs to the production stack`);
    }
  }
  if (!existsSync(abs)) throw new Error(`no payer key at ${abs}`);

  // ── the only place the key exists ─────────────────────────────────────────
  const key = parsePayerKey(readFileSync(abs, "utf8").trim(), (keyType ?? "ECDSA_SECP256K1") as HederaKeyType);

  const signer = createMemoBindingHederaSigner({
    accountId,
    privateKey: key,
    network: "hedera:testnet",
    memo,
  });

  const scheme = new ExactHederaScheme(signer as never);
  const result = await scheme.createPaymentPayload(X402_VERSION, requirements);

  // Only the signed payload leaves. No key, no key fingerprint, no seed.
  process.stdout.write(
    Buffer.from(
      JSON.stringify({
        x402Version: X402_VERSION,
        scheme: "exact",
        network: "hedera:testnet",
        payload: (result as any).payload,
      }),
      "utf8",
    ).toString("base64"),
  );
}

main().catch((e) => {
  // Error messages are written to stderr and never include the key or the file
  // contents — parsePayerKey is careful not to echo its input for this reason.
  process.stderr.write(`signer-process: ${(e as Error).message}\n`);
  process.exit(1);
});
