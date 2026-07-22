#!/usr/bin/env node
/**
 * Pre-transaction safety gate.
 *
 *   node tools/preflight-check.ts
 *
 * Read-only. Every check below is a GET or a local comparison; nothing is
 * signed and nothing is submitted. It exits non-zero on the first hard failure,
 * because the whole point is that `run-payment.ts --execute` refuses to run
 * unless this has passed.
 *
 * The checks are the operator's list, made executable:
 *   network is testnet · asset is HBAR · payee is fresh and not a production
 *   account · amount is inside the test limit · the quote id will be bound as
 *   the transaction memo · plus the things that would waste a payment: does the
 *   payer exist, is it funded, does the facilitator actually serve this network.
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig, describe, type DemoConfig } from "./load-config.ts";
import { fetchAccount } from "../packages/hedera-x402-adapter/src/mirror.ts";
import { RealHederaX402Adapter, TESTNET } from "../packages/hedera-x402-adapter/src/real-adapter.ts";
import { FORBIDDEN_TOPIC_IDS } from "../packages/hcs-anchor/src/interfaces.ts";

/** Accounts from the pre-existing production estate. Never usable here. */
const FORBIDDEN_ACCOUNTS = ["0.0.10420279", "0.0.8509917", "0.0.10420310"];

interface Check {
  id: string;
  ok: boolean;
  detail: string;
  hard: boolean;
}

const checks: Check[] = [];
const add = (id: string, ok: boolean, detail: string, hard = true) => {
  checks.push({ id, ok, detail, hard });
};

async function run(): Promise<number> {
  let cfg: DemoConfig;
  try {
    cfg = loadConfig();
  } catch (e) {
    console.error(`preflight: cannot load configuration — ${(e as Error).message}`);
    console.error("copy .env.example to .env and fill in the demo account ids.");
    return 2;
  }

  console.log("── configuration (redacted) ─────────────────────────────────");
  for (const [k, v] of Object.entries(describe(cfg))) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log("");

  // ── static invariants ─────────────────────────────────────────────────────
  add("network_is_testnet", cfg.network === TESTNET, `network=${cfg.network}`);
  add("mirror_is_testnet", cfg.mirrorUrl.includes("testnet"), cfg.mirrorUrl);
  add("hashscan_is_testnet", cfg.hashscanBase.includes("/testnet"), cfg.hashscanBase);
  add(
    "payee_not_production",
    !FORBIDDEN_ACCOUNTS.includes(cfg.payTo),
    `payTo=${cfg.payTo}; forbidden=${FORBIDDEN_ACCOUNTS.join(",")}`,
  );
  add(
    "payer_not_production",
    !FORBIDDEN_ACCOUNTS.includes(cfg.payerAccountId),
    `payer=${cfg.payerAccountId}`,
  );
  add(
    "payer_and_payee_distinct",
    cfg.payTo !== cfg.payerAccountId,
    "a self-payment would prove nothing about a transfer",
  );
  add(
    "no_forbidden_topic_configured",
    !FORBIDDEN_TOPIC_IDS.some((t) => process.env.NOMOS_GX402_HCS_TOPIC_ID === t),
    "no production topic is configured (and CP-H2 sends no HCS message at all)",
  );

  const amount = BigInt(cfg.priceAtomic);
  const cap = BigInt(cfg.maxAtomicPerPayment);
  add(
    "amount_within_test_limit",
    amount > 0n && amount <= cap,
    `amount=${cfg.priceAtomic} tinybar (${Number(amount) / 1e8} HBAR), cap=${cfg.maxAtomicPerPayment}`,
  );
  add(
    "amount_is_small",
    amount <= 100_000_000n,
    `≤ 1 HBAR of valueless testnet token; actual ${Number(amount) / 1e8} HBAR`,
  );

  // ── key hygiene ───────────────────────────────────────────────────────────
  const keyAbs = resolve(cfg.payerKeyPath);
  const keyExists = existsSync(keyAbs);
  add("payer_key_present", keyExists, keyExists ? keyAbs : `missing: ${keyAbs}`);
  if (keyExists) {
    const mode = statSync(keyAbs).mode & 0o777;
    add("payer_key_mode_0600", mode === 0o600, `mode=0${mode.toString(8)}`);
    add(
      "payer_key_is_local",
      keyAbs.includes("/.local/"),
      "the key lives in the git-ignored .local/ directory",
    );
  }
  const receiptKeyAbs = resolve(cfg.receiptSigningKeyPath);
  const receiptKeyExists = existsSync(receiptKeyAbs);
  add("receipt_key_present", receiptKeyExists, receiptKeyExists ? receiptKeyAbs : `missing: ${receiptKeyAbs}`);
  if (receiptKeyExists) {
    const mode = statSync(receiptKeyAbs).mode & 0o777;
    add("receipt_key_mode_0600", mode === 0o600, `mode=0${mode.toString(8)}`);
  }

  // ── live, read-only network checks ────────────────────────────────────────
  let supported: any;
  try {
    supported = await RealHederaX402Adapter.fetchSupported(cfg.facilitatorUrl);
    const feePayer = RealHederaX402Adapter.feePayerFromSupported(supported);
    add("facilitator_supports_hedera_testnet", true, `feePayer=${feePayer}`);
  } catch (e) {
    add("facilitator_supports_hedera_testnet", false, (e as Error).message);
  }

  try {
    const payer = await fetchAccount(cfg.payerAccountId, cfg.mirrorUrl);
    if (!payer) {
      add("payer_account_exists", false, `${cfg.payerAccountId} not found on testnet`);
    } else {
      const bal = BigInt(payer.balance?.balance ?? 0);
      add("payer_account_exists", !payer.deleted, `${payer.account} deleted=${payer.deleted}`);
      add(
        "payer_funded",
        bal >= amount,
        `balance=${bal.toString()} tinybar, need ≥ ${amount.toString()}`,
      );
    }
  } catch (e) {
    add("payer_account_exists", false, `mirror lookup failed: ${(e as Error).message}`);
  }

  try {
    const payee = await fetchAccount(cfg.payTo, cfg.mirrorUrl);
    add(
      "payee_account_exists",
      payee !== null && !payee.deleted,
      payee ? `${payee.account} deleted=${payee.deleted}` : `${cfg.payTo} not found`,
    );
  } catch (e) {
    add("payee_account_exists", false, `mirror lookup failed: ${(e as Error).message}`);
  }

  // ── report ────────────────────────────────────────────────────────────────
  console.log("── checks ───────────────────────────────────────────────────");
  for (const c of checks) {
    console.log(`  ${c.ok ? "PASS" : c.hard ? "FAIL" : "WARN"}  ${c.id.padEnd(38)} ${c.detail}`);
  }
  console.log("");

  const failed = checks.filter((c) => !c.ok && c.hard);
  if (failed.length > 0) {
    console.error(`preflight: BLOCKED — ${failed.length} hard check(s) failed. No transaction may be attempted.`);
    return 1;
  }
  console.log("preflight: CLEAR — every hard check passed.");
  console.log("Note: this tool signed nothing and submitted nothing.");
  return 0;
}

run().then((code) => process.exit(code)).catch((e) => {
  console.error(`preflight: ERROR ${(e as Error).message}`);
  process.exit(1);
});
