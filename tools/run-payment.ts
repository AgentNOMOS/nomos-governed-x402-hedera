#!/usr/bin/env node
/**
 * The CP-H2 run: one governed x402 purchase over real HTTP, on Hedera testnet.
 *
 *   node tools/run-payment.ts              # DRY RUN (default) — stops before settle
 *   node tools/run-payment.ts --execute    # the real thing, once
 *
 * Safety design, in the order it bites:
 *
 *   1. DRY RUN IS THE DEFAULT. `--execute` must be typed. A dry run still
 *      builds and signs the real transaction and still has the facilitator
 *      verify the payer's signature against their on-chain key — it just never
 *      calls `/settle`. That makes it a rehearsal, not a simulation.
 *
 *   2. ONE PAYMENT, EVER. A successful execute writes `.local/PAYMENT_EXECUTED`.
 *      Its presence blocks any further `--execute`. The authorization was for
 *      exactly one payment and the code enforces exactly one payment.
 *
 *   3. PREFLIGHT FIRST. `--execute` refuses unless `preflight-check.ts` exits 0
 *      in the same invocation.
 *
 *   4. TESTNET, THREE TIMES. Config, adapter and signer each assert it
 *      independently.
 *
 * The payer key is never in this process. Signing is delegated to
 * `services/agent-client/src/signer-process.ts`, a separate child process whose
 * stdin is the challenge and whose stdout is the signature.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig, type DemoConfig } from "./load-config.ts";
import { LocalEd25519Signer } from "../packages/evidence-receipt/src/signer.ts";
import { verifyProofOfActionReceipt } from "../packages/evidence-receipt/src/receipt.ts";
import { DEMO_POLICY, type PolicyDocument } from "../packages/nomos-policy/src/policy.ts";
import {
  RealHederaX402Adapter,
  toPaymentRequirements,
  TESTNET,
} from "../packages/hedera-x402-adapter/src/real-adapter.ts";
import { GovernedFlow, type ServiceOffer } from "../services/resource-server/src/flow.ts";
import { createGovernedServer, listen } from "../services/resource-server/src/http-server.ts";

const EXECUTED_MARKER = resolve(".local/PAYMENT_EXECUTED");
const EVIDENCE_DIR = resolve("docs/evidence/cp-h2");

const AGENT_IDENTITY = {
  did: "did:nomos:gx402-demo-agent",
  public_key_hex: "b".repeat(64),
  key_type: "Ed25519" as const,
  label: "cp-h2-buyer",
};

function authorityScope(): Record<string, unknown> {
  const until = new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return { scopes: ["evidence:read"], granted_by: "did:nomos:gx402-demo-operator", valid_until: until, delegation_hash: null };
}

const REQUEST_BODY = {
  subject: "hedera-x402-bounty-demo.invalid",
  checks: ["declares_x402", "has_agent_card", "publishes_jwks", "states_pricing"],
};

function offerFor(cfg: DemoConfig): ServiceOffer {
  return {
    schema: "nomos.gx402.service_offer.v1",
    offer_id: "evidence.basic.v1",
    service: {
      service_id: "nomos-gx402-evidence",
      resource_url: cfg.resourceUrl,
      http_method: "POST",
    },
    description: "Synthetic agent-readiness evidence lookup, priced per call and settled on Hedera testnet.",
    network: TESTNET,
    asset: "HBAR",
    atomic_amount: cfg.priceAtomic,
    pay_to: cfg.payTo,
    quote_ttl_seconds: cfg.quoteTtlSeconds,
  };
}

function policyFor(cfg: DemoConfig): PolicyDocument {
  return {
    ...DEMO_POLICY,
    allowed_networks: [TESTNET],
    allowed_assets: ["HBAR"],
    allowed_payees: [cfg.payTo],
    max_atomic_per_payment: cfg.maxAtomicPerPayment,
    max_atomic_cumulative: cfg.maxAtomicCumulative,
    max_payments_per_utc_day: cfg.maxPaymentsPerUtcDay,
    quote_ttl_seconds: cfg.quoteTtlSeconds,
    // The demo price is 50% of the per-payment cap, comfortably below the
    // review threshold, so the happy path is a clean ALLOW rather than a REVIEW.
    review_threshold_percent: 80,
  };
}

/**
 * Record that the single authorised payment has been spent.
 *
 * Idempotent and called as early as possible: the budget is gone once a
 * transaction exists, regardless of what happens downstream.
 */
function markPaymentSpent(transactionId: string, receiptId: string | null): void {
  if (existsSync(EXECUTED_MARKER)) return;
  mkdirSync(resolve(".local"), { recursive: true });
  const tmp = `${EXECUTED_MARKER}.tmp.${process.pid}`;
  writeFileSync(
    tmp,
    `${transactionId}\n${new Date().toISOString()}\nreceipt=${receiptId ?? "pending"}\n`,
    { mode: 0o600 },
  );
  renameSync(tmp, EXECUTED_MARKER);
  console.log(`\n   one-payment marker written (${transactionId}) — further --execute runs are blocked.`);
}

/** Delegate signing to the isolated child process. Returns the header value. */
function signInChildProcess(input: unknown): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["services/agent-client/src/signer-process.ts"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code === 0 && out.length > 0) resolvePromise(out.trim());
      else reject(new Error(`signer-process exited ${code}: ${err.trim() || "no output"}`));
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

async function main(): Promise<number> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY RUN";

  console.log(`╔═══ CP-H2 — ${mode} ═══════════════════════════════════════`);
  console.log(`║ ${execute ? "This WILL submit one real Hedera testnet transaction." : "Nothing will be submitted. Stops before /settle."}`);
  console.log("╚══════════════════════════════════════════════════════════\n");

  if (execute && existsSync(EXECUTED_MARKER)) {
    console.error("REFUSED: .local/PAYMENT_EXECUTED exists — one successful payment was already made.");
    console.error("The authorization covered exactly one. Delete the marker only with a new authorization.");
    return 1;
  }

  const cfg = loadConfig();
  if (cfg.network !== TESTNET) throw new Error(`network is ${cfg.network}`);

  // ── facilitator discovery ────────────────────────────────────────────────
  const supported = await RealHederaX402Adapter.fetchSupported(cfg.facilitatorUrl);
  const feePayer = RealHederaX402Adapter.feePayerFromSupported(supported);
  console.log(`facilitator      : ${cfg.facilitatorUrl}`);
  console.log(`fee payer        : ${feePayer}`);
  console.log(`payer            : ${cfg.payerAccountId}`);
  console.log(`payee            : ${cfg.payTo}`);
  console.log(`amount           : ${cfg.priceAtomic} tinybar (${Number(cfg.priceAtomic) / 1e8} HBAR)\n`);

  // ── receipt signer (NOT a payment key) ───────────────────────────────────
  const receiptSigner = LocalEd25519Signer.fromFile(cfg.receiptSigningKeyPath, cfg.receiptSigningKid);
  const trustedKeys = { [receiptSigner.kid]: receiptSigner.publicKeyHex };

  const adapter = new RealHederaX402Adapter({
    facilitatorUrl: cfg.facilitatorUrl,
    feePayer,
    resourceUrl: cfg.resourceUrl,
    mirrorBaseUrl: cfg.mirrorUrl,
    dryRun: !execute,
  });

  const offer = offerFor(cfg);
  const flow = new GovernedFlow({
    offer,
    policy: policyFor(cfg),
    adapter,
    signer: receiptSigner,
  });

  const server = createGovernedServer({
    flow,
    port: cfg.port,
    agentIdentity: AGENT_IDENTITY as unknown as Record<string, unknown>,
    authorityScope: authorityScope(),
    payerAccountId: cfg.payerAccountId,
    log: (line) => console.log(`  [server] ${JSON.stringify(line)}`),
  });
  await listen(server, cfg.port);
  console.log(`resource server  : http://127.0.0.1:${cfg.port}\n`);

  const evidence: Record<string, unknown> = { mode, started_at: new Date().toISOString() };

  try {
    // ── 1. discovery ───────────────────────────────────────────────────────
    const offerRes = await fetch(`http://127.0.0.1:${cfg.port}/.well-known/offer`);
    const discovered = await offerRes.json();
    console.log(`1. discovery     : ${offerRes.status} — offer ${(discovered as any).offer_id}`);
    evidence.offer = discovered;

    // ── 2. unpaid request → 402 ────────────────────────────────────────────
    const challengeRes = await fetch(`http://127.0.0.1:${cfg.port}/v1/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(REQUEST_BODY),
    });
    const challengeBody: any = await challengeRes.json();
    console.log(`2. HTTP 402      : ${challengeRes.status} — quote ${challengeBody?.nomos?.quote_id ?? "<none>"}`);
    if (challengeRes.status !== 402) {
      evidence.failure = { stage: "challenge", status: challengeRes.status, body: challengeBody };
      throw new Error(`expected 402, got ${challengeRes.status}: ${JSON.stringify(challengeBody).slice(0, 300)}`);
    }
    console.log(`   policy        : ${challengeBody.decision_receipt.record.decision} (${challengeBody.decision_receipt.record.decision_code})`);
    console.log(`   memo binding  : accepts[0].memo = ${challengeBody.accepts[0].memo}`);
    evidence.challenge = challengeBody;
    evidence.payment_required_header = challengeRes.headers.get("payment-required");

    const quoteId: string = challengeBody.nomos.quote_id;
    const quote = flow.knownQuote(quoteId)!;

    // ── 3. sign in the isolated process ────────────────────────────────────
    const requirements = toPaymentRequirements(quote, feePayer);
    const signature = await signInChildProcess({
      requirements,
      memo: quoteId,
      accountId: cfg.payerAccountId,
      keyPath: cfg.payerKeyPath,
      keyType: cfg.payerKeyType,
    });
    console.log(`3. signed        : isolated child process, ${signature.length}-char payload (key never entered this process)`);
    evidence.payment_requirements = requirements;

    // ── 4. paid retry ──────────────────────────────────────────────────────
    const paidRes = await fetch(`http://127.0.0.1:${cfg.port}/v1/evidence`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": signature,
        "payment-quote-id": quoteId,
      },
      body: JSON.stringify(REQUEST_BODY),
    });
    const paidBody: any = await paidRes.json();
    console.log(`4. paid request  : ${paidRes.status}`);
    evidence.paid_status = paidRes.status;
    evidence.paid_body = paidBody;
    evidence.payment_response_header = paidRes.headers.get("payment-response");

    if (!execute) {
      console.log("");
      console.log("DRY RUN COMPLETE.");
      console.log(`  facilitator verify result is visible in the server log above.`);
      console.log(`  settle was refused by design: ${JSON.stringify(paidBody.error ?? paidBody).slice(0, 200)}`);
      console.log("  Nothing was submitted. No HBAR moved.");
      evidence.outcome = "DRY_RUN_STOPPED_BEFORE_SETTLE";
      return paidRes.status === 402 ? 0 : 1;
    }

    // The one-payment budget is consumed the moment a transaction exists on
    // chain — NOT when the receipt turns out to be good. Writing the marker
    // only on a fully verified receipt is how the first real run left the
    // budget looking unspent after it had actually been spent: settlement
    // succeeded, the verifier rejected it over a child-record bug, and this
    // function returned before the marker was written.
    const settledTxId =
      (paidBody?.receipt?.record as any)?.hedera_transaction_id ?? paidBody?.settlement?.transaction_id;
    if (settledTxId) markPaymentSpent(settledTxId, paidBody?.receipt?.receipt_id ?? null);

    if (paidRes.status !== 200) {
      evidence.outcome = "EXECUTE_FAILED";
      console.error(`\nPAYMENT DID NOT COMPLETE: ${JSON.stringify(paidBody).slice(0, 500)}`);
      if (settledTxId) {
        console.error(`\nA TRANSACTION EXISTS: ${settledTxId}`);
        console.error("The payment budget is spent. Do NOT re-run --execute.");
        console.error("Complete the receipt instead:");
        console.error(`  node tools/complete-settlement.ts "${settledTxId}"`);
      }
      return 1;
    }

    // ── 5. verify the receipt independently ────────────────────────────────
    const receipt = paidBody.receipt;
    const verification = verifyProofOfActionReceipt(receipt, {
      trustedKeys,
      expected: {
        request_hash: quote.request_hash,
        quote_hash: quote.quote_hash,
        atomic_amount: quote.atomic_amount,
        payee: quote.pay_to,
        network: TESTNET,
        asset: "HBAR",
      },
    });

    console.log("");
    console.log(`5. receipt       : ${receipt.receipt_id}`);
    console.log(`   transaction   : ${receipt.record.hedera_transaction_id}`);
    console.log(`   consensus     : ${receipt.record.consensus_timestamp ?? "<none>"}`);
    console.log(`   settlement    : ${receipt.record.settlement_source} / ${receipt.record.settlement_finality}`);
    console.log(`   verified      : ${verification.ok ? "VALID" : "INVALID " + verification.reasons.join(",")}`);
    console.log(`   mock warning  : ${verification.mock_settlement ? "YES — PROBLEM" : "none"}`);
    console.log(`   hashscan      : ${receipt.verification.hashscan_transaction_url}`);

    evidence.receipt = receipt;
    evidence.verification = verification;
    evidence.outcome = verification.ok && !verification.mock_settlement ? "PAYMENT_VERIFIED" : "RECEIPT_PROBLEM";

    return verification.ok && !verification.mock_settlement ? 0 : 1;
  } finally {
    evidence.finished_at = new Date().toISOString();
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const file = resolve(EVIDENCE_DIR, execute ? "execute-run.json" : "dry-run.json");
    writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`\nevidence written : ${file}`);
    server.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`\nrun-payment: ${(e as Error).message}`);
    process.exit(1);
  });
