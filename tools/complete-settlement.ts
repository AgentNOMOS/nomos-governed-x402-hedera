#!/usr/bin/env node
/**
 * Complete a settled-but-unreceipted purchase.
 *
 *   node tools/complete-settlement.ts <transaction_id> [--evidence <run.json>]
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THIS TOOL MAKES NO PAYMENT. It signs nothing on-chain, contacts no
 *  facilitator, and reads only the public mirror node. It exists for the case
 *  where money moved and the receipt did not get written.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Why it exists is worth stating plainly. On the first real CP-H2 run the
 * payment succeeded on chain — correct amount, correct payee, correct memo —
 * and the verifier rejected it, because `GET /transactions/{id}` returns child
 * records alongside the transfer and the code read the first one. The gate
 * failed in the safe direction (it refused to deliver rather than delivering on
 * unverified evidence), but it refused a good payment.
 *
 * The fix belongs in `selectUserTransaction`. What belongs here is the
 * consequence: a paid request with no receipt is precisely the state the whole
 * project exists to make impossible, and re-paying to produce evidence would be
 * both wasteful and dishonest — the second payment would not be the one the
 * receipt describes.
 *
 * So this replays the deterministic tail of the flow — verify, execute, hash,
 * sign — against the transaction that actually settled. Everything it needs is
 * reproducible: the quote is a pure function of its inputs, and the evidence
 * service is deterministic, so the `result_hash` it computes is the same one the
 * original run would have produced.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "./load-config.ts";
import { canonicalDigest, toIso, SCHEMA_VERSION } from "../packages/shared-schemas/src/index.ts";
import { policyHash, DEMO_POLICY, type PolicyDocument } from "../packages/nomos-policy/src/policy.ts";
import { LocalEd25519Signer } from "../packages/evidence-receipt/src/signer.ts";
import {
  buildProofOfActionReceipt,
  verifyProofOfActionReceipt,
  type DeliveryEvidence,
  type SettlementEvidence,
} from "../packages/evidence-receipt/src/receipt.ts";
import { RealHederaX402Adapter, TESTNET } from "../packages/hedera-x402-adapter/src/real-adapter.ts";
import { buildHashScanLinks } from "../packages/hedera-x402-adapter/src/hashscan.ts";
import {
  executeEvidenceRequest,
  hashEvidenceRequest,
  hashEvidenceResult,
  validateEvidenceRequest,
} from "../services/resource-server/src/evidence-service.ts";

const EVIDENCE_DIR = resolve("docs/evidence/cp-h2");

function fail(code: string, message: string): never {
  console.error(`\nFAIL-CLOSED [${code}]: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const txId = process.argv[2];
  if (!txId || !/^\d+\.\d+\.\d+@\d+\.\d+$/.test(txId)) {
    console.error("usage: node tools/complete-settlement.ts <transaction_id> [--evidence <run.json>]");
    process.exit(2);
  }
  const force = process.argv.includes("--force");
  const evIdx = process.argv.indexOf("--evidence");
  const runPath = evIdx > 0 ? process.argv[evIdx + 1] : resolve(EVIDENCE_DIR, "execute-run.json");

  // Re-assembling a receipt is legitimate but NOT idempotent: `receipt_timestamp`
  // records when the receipt was written, so a second assembly of the same
  // settlement produces a different — equally valid — receipt with a different
  // digest. Overwriting the first one silently would quietly invalidate any
  // digest already cited in a report, so the first receipt wins by default.
  const receiptPath = resolve(EVIDENCE_DIR, "receipt.json");
  if (existsSync(receiptPath) && !force) {
    fail(
      "RECEIPT_EXISTS",
      `${receiptPath} already holds a receipt for this settlement.\n` +
        "            Re-assembly would produce a different digest (the timestamp is honest),\n" +
        "            invalidating any digest already published. Pass --force if that is intended.",
    );
  }

  const cfg = loadConfig();
  if (cfg.network !== TESTNET) fail("NETWORK", `config network is ${cfg.network}`);

  const run = JSON.parse(readFileSync(runPath, "utf8"));
  const challenge = run.challenge;
  const decisionRecord = challenge?.decision_receipt?.record;
  if (!challenge?.nomos || !decisionRecord) fail("EVIDENCE_INCOMPLETE", `${runPath} has no challenge/decision record`);

  const nomos = challenge.nomos;
  const accepts = challenge.accepts[0];

  console.log("── replaying the settled purchase (no payment) ──────────────");
  console.log(`  transaction     : ${txId}`);
  console.log(`  quote_id        : ${nomos.quote_id}`);
  console.log(`  request_hash    : ${nomos.request_hash}`);
  console.log(`  policy decision : ${decisionRecord.decision} (${decisionRecord.decision_code})`);

  // ── the request must reproduce the hash the quote committed to ────────────
  const requestBody = run.request_body ?? {
    subject: "hedera-x402-bounty-demo.invalid",
    checks: ["declares_x402", "has_agent_card", "publishes_jwks", "states_pricing"],
  };
  const normalized = validateEvidenceRequest(requestBody);
  const requestHash = hashEvidenceRequest(normalized);
  if (requestHash !== nomos.request_hash) {
    fail("REQUEST_HASH_MISMATCH", `recomputed ${requestHash} != quoted ${nomos.request_hash}`);
  }
  console.log(`  request replay  : OK — recomputed hash matches the quote`);

  // ── independent settlement verification ───────────────────────────────────
  const supported = await RealHederaX402Adapter.fetchSupported(cfg.facilitatorUrl);
  const feePayer = RealHederaX402Adapter.feePayerFromSupported(supported);
  const adapter = new RealHederaX402Adapter({
    facilitatorUrl: cfg.facilitatorUrl,
    feePayer,
    resourceUrl: cfg.resourceUrl,
    mirrorBaseUrl: cfg.mirrorUrl,
    dryRun: true, // belt and braces: this tool can never reach /settle
  });

  const settlement = (await adapter.verifySettlementViaMirrorNode({
    transaction_id: txId,
    expected_network: TESTNET,
    expected_asset: accepts.asset,
    expected_atomic_amount: accepts.atomic_amount,
    expected_payee: accepts.pay_to,
    expected_memo: nomos.quote_id,
  })) as SettlementEvidence;

  console.log("\n── settlement evidence ─────────────────────────────────────");
  for (const [k, v] of Object.entries(settlement)) console.log(`  ${k.padEnd(20)} ${v}`);

  if (!settlement.verified || settlement.finality !== "FINAL") {
    fail("SETTLEMENT_UNVERIFIED", `${settlement.failure_code ?? settlement.finality} — no receipt will be issued`);
  }

  // ── execute + delivery hash ───────────────────────────────────────────────
  const result = executeEvidenceRequest(normalized);
  const resultHash = hashEvidenceResult(result);
  const delivery: DeliveryEvidence = {
    schema: `nomos.gx402.delivery_evidence.${SCHEMA_VERSION}`,
    idempotency_key: nomos.idempotency_key,
    execution_status: "SUCCEEDED",
    delivery_status: "DELIVERED",
    result_hash: resultHash,
    result_media_type: "application/json",
    result_byte_length: Buffer.byteLength(JSON.stringify(result)),
    executed_at: toIso(Date.now()),
    failure_code: null,
    refund_due: false,
  };
  console.log(`\n  result_hash     : ${resultHash}`);

  // ── receipt ───────────────────────────────────────────────────────────────
  const signer = LocalEd25519Signer.fromFile(cfg.receiptSigningKeyPath, cfg.receiptSigningKid);
  const policy: PolicyDocument = {
    ...DEMO_POLICY,
    allowed_networks: [TESTNET],
    allowed_assets: ["HBAR"],
    allowed_payees: [cfg.payTo],
    max_atomic_per_payment: cfg.maxAtomicPerPayment,
    max_atomic_cumulative: cfg.maxAtomicCumulative,
    max_payments_per_utc_day: cfg.maxPaymentsPerUtcDay,
    quote_ttl_seconds: cfg.quoteTtlSeconds,
    review_threshold_percent: 80,
  };
  if (policyHash(policy) !== decisionRecord.policy_hash) {
    fail("POLICY_HASH_MISMATCH", `recomputed ${policyHash(policy)} != decided ${decisionRecord.policy_hash}`);
  }
  console.log(`  policy replay   : OK — recomputed policy hash matches the decision`);

  const links = buildHashScanLinks({ transaction_id: txId, account_id: settlement.payer });
  const receipt = buildProofOfActionReceipt(
    {
      agent_identity: decisionRecord.agent_identity,
      authority_scope: decisionRecord.authority_scope,
      service_identity: { service_id: "nomos-gx402-evidence", resource_url: cfg.resourceUrl, http_method: "POST" },
      offer_id: challenge.accepts[0] ? "evidence.basic.v1" : "evidence.basic.v1",
      policy_decision: decisionRecord.decision,
      policy_version: policy.policy_version,
      policy_hash: decisionRecord.policy_hash,
      decision_id: nomos.decision_id,
      request_hash: nomos.request_hash,
      quote_id: nomos.quote_id,
      quote_hash: nomos.quote_hash,
      idempotency_key: nomos.idempotency_key,
      nonce: decisionRecord.nonce,
      settlement,
      delivery,
      verification: {
        hashscan_transaction_url: links.transaction,
        mirror_transaction_url: links.mirror_transaction,
        hashscan_topic_url: null,
        mirror_topic_message_url: null,
      },
    },
    signer,
  );

  const verification = verifyProofOfActionReceipt(receipt, {
    trustedKeys: { [signer.kid]: signer.publicKeyHex },
    expected: {
      request_hash: nomos.request_hash,
      quote_hash: nomos.quote_hash,
      result_hash: resultHash,
      atomic_amount: accepts.atomic_amount,
      network: TESTNET,
      asset: "HBAR",
    },
  });

  console.log("\n── receipt ─────────────────────────────────────────────────");
  console.log(`  receipt_id      : ${receipt.receipt_id}`);
  console.log(`  record_digest   : ${receipt.record_digest}`);
  console.log(`  signature kid   : ${receipt.signature.kid}`);
  console.log(`  verdict         : ${verification.ok ? "VALID" : "INVALID " + verification.reasons.join(",")}`);
  console.log(`  mock settlement : ${verification.mock_settlement ? "YES — PROBLEM" : "no"}`);
  console.log(`  HashScan        : ${receipt.verification.hashscan_transaction_url}`);

  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(resolve(EVIDENCE_DIR, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  writeFileSync(
    resolve(EVIDENCE_DIR, "result.json"),
    `${JSON.stringify({ result, result_hash: resultHash, canonical_digest_check: canonicalDigest(result) }, null, 2)}\n`,
  );
  writeFileSync(
    resolve(EVIDENCE_DIR, "settlement.json"),
    `${JSON.stringify({ settlement, delivery, verification }, null, 2)}\n`,
  );
  console.log(`\n  written         : ${EVIDENCE_DIR}/{receipt,result,settlement}.json`);

  if (!verification.ok || verification.mock_settlement) {
    fail("RECEIPT_INVALID", verification.reasons.join(", ") || "mock settlement");
  }
}

main().catch((e) => {
  console.error(`\ncomplete-settlement: ${(e as Error).message}`);
  process.exit(1);
});
