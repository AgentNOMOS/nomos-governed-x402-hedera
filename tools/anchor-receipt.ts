#!/usr/bin/env node
/**
 * CP-H7 — anchor a proof-of-action receipt digest to a Hedera consensus topic.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  DRY RUN IS THE DEFAULT AND THE ONLY PATH THAT RUNS TODAY.               ║
 * ║                                                                          ║
 * ║  A dry run never imports the Hedera SDK, never constructs a client and   ║
 * ║  never reads a key. It builds the exact bytes, prints them, and stops.   ║
 * ║  `--execute` exists, and as of this checkpoint it refuses: there is no   ║
 * ║  grant document, anchoring is disabled in config, and no topic is        ║
 * ║  configured. It prints every unmet condition rather than the first.      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   node tools/anchor-receipt.ts                      # dry run, default receipt
 *   node tools/anchor-receipt.ts --receipt <file>     # dry run, another receipt
 *   node tools/anchor-receipt.ts --execute            # gated; refuses today
 *
 * Two lessons from CP-H2 are wired in rather than written down:
 *
 *   The marker is written the moment a transaction id exists, not when the
 *   result is good. In CP-H2 the payment succeeded and the run aborted before
 *   the budget marker was written, which left the money spent and the lock
 *   open. Here `markAnchorSubmitted` fires on the transaction id.
 *
 *   Confirmation is a separate step from submission. The submit path writes
 *   `status: "SUBMITTED"`. Only a mirror-node read-back that matches the
 *   envelope byte for byte promotes it to CONFIRMED. Nothing may present an
 *   anchor as proven in between.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  anchorEnvelopeBytes,
  anchorEnvelopeDigest,
  anchorKey,
  assertEnvelopeBinding,
  buildAnchorEnvelope,
  evaluateAnchorGuard,
  findDuplicateAnchor,
  parseAnchorGrant,
  verifyAnchorEvidence,
  ANCHOR_ENVELOPE_BYTE_BUDGET,
  AnchorBindingError,
  type AnchorEnvelope,
  type AnchorGuardState,
  type ObservedTopicMessage,
} from "../packages/hcs-anchor/src/index.ts";
import { verifyProofOfActionReceipt } from "../packages/evidence-receipt/src/receipt.ts";
import { NETWORK, toIso } from "../packages/shared-schemas/src/index.ts";
import { loadConfig, readEnvFile } from "./load-config.ts";

const DEFAULT_RECEIPT = "docs/evidence/cp-h2/receipt.json";
const GRANT_FILE = resolve(".local/HCS_ANCHOR_AUTHORIZED");
const EXECUTED_MARKER = resolve(".local/HCS_ANCHOR_EXECUTED");
const EVIDENCE_FILE = resolve("docs/evidence/cp-h7/anchor-evidence.json");
const DRYRUN_FILE = resolve("docs/evidence/cp-h7/anchor-dry-run.json");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** Write atomically, so a crash mid-write cannot leave half an evidence file. */
function writeAtomic(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

/**
 * Record that the anchor budget is spent. Idempotent, and called as early as a
 * transaction id exists — see the header note.
 */
function markAnchorSubmitted(transactionId: string, key: string): void {
  if (existsSync(EXECUTED_MARKER)) return;
  writeAtomic(
    EXECUTED_MARKER,
    `${transactionId}\n${new Date().toISOString()}\nanchor_key=${key}\n`,
    0o600,
  );
  console.log(`\n   anchor marker written (${transactionId}) — further --execute runs are blocked.`);
}

/** Read the topic's existing messages. Read-only, and failure is not fatal — it is a blocker. */
async function fetchTopicMessages(mirrorUrl: string, topicId: string): Promise<ObservedTopicMessage[] | null> {
  try {
    const res = await fetch(`${mirrorUrl}/topics/${topicId}/messages?limit=100&order=desc`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { messages?: ObservedTopicMessage[] };
    return body.messages ?? [];
  } catch {
    return null;
  }
}

function printEnvelope(envelope: AnchorEnvelope, bytes: Buffer): void {
  console.log("── envelope ──────────────────────────────────────────────────");
  console.log(JSON.stringify(envelope, null, 2));
  console.log("\n── canonical bytes (exactly what would be submitted) ─────────");
  console.log(bytes.toString("utf8"));
  console.log(`\nbyte length      : ${bytes.length}  (budget ${ANCHOR_ENVELOPE_BYTE_BUDGET}, protocol chunk limit 1024)`);
  console.log(`envelope digest  : ${anchorEnvelopeDigest(envelope)}`);
}

async function main(): Promise<number> {
  const execute = process.argv.includes("--execute");
  const receiptPath = resolve(arg("--receipt") ?? DEFAULT_RECEIPT);

  console.log(`╔═══ CP-H7 — ${execute ? "EXECUTE (gated)" : "DRY RUN"} ═══════════════════════════`);
  console.log(
    `║ ${execute ? "Would submit to Hedera testnet ONLY if every gate below passes." : "Nothing is submitted. No SDK, no client, no key is loaded."}`,
  );
  console.log("╚══════════════════════════════════════════════════════════════\n");

  // ── the receipt has to be real before anything is derived from it ─────────
  if (!existsSync(receiptPath)) {
    console.error(`REFUSED: receipt not found: ${receiptPath}`);
    return 1;
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const verification = verifyProofOfActionReceipt(receipt, {});
  console.log(`receipt          : ${receipt.receipt_id}`);
  console.log(`receipt verdict  : ${verification.ok ? "VALID" : "INVALID"}`);
  if (!verification.ok) {
    for (const r of verification.reasons) console.error(`  reason        : ${r}`);
    console.error("\nREFUSED: refusing to anchor a receipt that does not verify.");
    return 1;
  }
  if (verification.mock_settlement) {
    console.error("REFUSED: settlement_source is MOCK_OFFLINE — that receipt evidences no real payment.");
    return 1;
  }

  // ── build the envelope; every field comes from the receipt ────────────────
  let envelope: AnchorEnvelope;
  try {
    envelope = buildAnchorEnvelope(receipt, Date.now());
    assertEnvelopeBinding(envelope, receipt);
  } catch (err) {
    const code = err instanceof AnchorBindingError ? err.code : "UNKNOWN";
    console.error(`REFUSED: envelope could not be bound to the receipt (${code})`);
    console.error(`  ${String(err instanceof Error ? err.message : err)}`);
    return 1;
  }

  const bytes = anchorEnvelopeBytes(envelope);
  const key = anchorKey(NETWORK, envelope.receipt_id, envelope.record_digest);
  console.log(`anchor key       : ${key}\n`);
  printEnvelope(envelope, bytes);

  // ── gather the guard state ────────────────────────────────────────────────
  const cfg = loadConfig();
  const env = readEnvFile();
  const configuredTopicId = (process.env.NOMOS_GX402_HCS_TOPIC_ID ?? env.NOMOS_GX402_HCS_TOPIC_ID ?? "").trim();
  const anchorEnabled = (process.env.NOMOS_GX402_ANCHOR_ENABLED ?? env.NOMOS_GX402_ANCHOR_ENABLED ?? "false").trim() === "true";

  let topicMessages: ObservedTopicMessage[] | null = null;
  if (configuredTopicId) topicMessages = await fetchTopicMessages(cfg.mirrorUrl, configuredTopicId);
  const duplicate = topicMessages
    ? findDuplicateAnchor(topicMessages, envelope.receipt_id, envelope.record_digest)
    : null;

  const state: AnchorGuardState = {
    grant: parseAnchorGrant(readIfPresent(GRANT_FILE)),
    executedMarker: readIfPresent(EXECUTED_MARKER),
    anchorEnabled,
    configuredTopicId,
    payerKeyPresent: existsSync(resolve(cfg.payerKeyPath)),
    network: cfg.network,
    receiptId: envelope.receipt_id,
    recordDigest: envelope.record_digest,
    // A run with no configured topic would have to create one first, which is
    // a second transaction. Counting it here is what makes the grant's
    // max_transactions mean something.
    plannedTransactions: configuredTopicId ? 1 : 2,
    duplicateOnTopic: duplicate !== null,
    topicScanned: topicMessages !== null,
    nowMs: Date.now(),
  };

  const verdict = evaluateAnchorGuard(state);

  console.log("\n── preflight guard ───────────────────────────────────────────");
  console.log(`network          : ${state.network}`);
  console.log(`anchor enabled   : ${state.anchorEnabled}`);
  console.log(`configured topic : ${state.configuredTopicId || "<unset>"}`);
  console.log(`grant document   : ${state.grant ? `present (topic ${state.grant.topic_id}, expires ${state.grant.expires_at})` : "absent or invalid"}`);
  console.log(`executed marker  : ${state.executedMarker ? "present — budget spent" : "absent"}`);
  console.log(`payer key file   : ${state.payerKeyPresent ? "present (contents never read here)" : "absent"}`);
  console.log(`topic scanned    : ${state.topicScanned ? `yes (${topicMessages?.length ?? 0} messages)` : "no"}`);
  console.log(`duplicate anchor : ${state.duplicateOnTopic ? "YES — already anchored" : "none found"}`);
  console.log(`planned txs      : ${state.plannedTransactions}`);
  console.log(`verdict          : ${verdict.allowed ? "ALLOWED" : "BLOCKED"}`);
  for (const n of verdict.notes) console.log(`  note          : ${n}`);
  for (const b of verdict.blockers) console.log(`  blocker       : ${b}`);

  // ── dry run stops here, and says exactly what would follow ────────────────
  if (!execute) {
    const plan = {
      mode: "DRY_RUN",
      generated_at: toIso(Date.now()),
      receipt_path: receiptPath.replace(resolve("."), "."),
      receipt_id: envelope.receipt_id,
      receipt_verdict: "VALID",
      anchor_key: key,
      envelope,
      envelope_canonical_utf8: bytes.toString("utf8"),
      envelope_bytes: bytes.length,
      envelope_digest: anchorEnvelopeDigest(envelope),
      guard: verdict,
      would_submit: {
        network: NETWORK,
        topic_id: state.configuredTopicId || null,
        transactions: state.plannedTransactions,
        transaction_sequence: state.configuredTopicId
          ? ["TopicMessageSubmitTransaction"]
          : ["TopicCreateTransaction", "TopicMessageSubmitTransaction"],
        message_bytes: bytes.length,
        submitted: false,
        signed: false,
      },
      note:
        "Nothing was signed, submitted or persisted to the ledger. The Hedera SDK was " +
        "not imported by this run.",
    };
    writeAtomic(DRYRUN_FILE, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`\ndry-run artifact : ${DRYRUN_FILE.replace(resolve("."), ".")}`);
    console.log("\nNothing was signed or submitted. Re-run with --execute once a grant exists.");
    return 0;
  }

  // ── execute path ──────────────────────────────────────────────────────────
  if (!verdict.allowed) {
    console.error("\nREFUSED: the preflight guard did not pass. No transaction was prepared,");
    console.error("signed or submitted. Clear every blocker above — a grant document is not");
    console.error("a file that exists, it is a document naming this topic and this receipt.");
    return 1;
  }

  // Reached only with a valid grant. The SDK is imported here, and nowhere
  // above, so a dry run provably cannot construct a transaction.
  const { Client, PrivateKey, AccountId, TopicMessageSubmitTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(cfg.payerAccountId),
    PrivateKey.fromStringECDSA(readFileSync(resolve(cfg.payerKeyPath), "utf8").trim()),
  );

  let transactionId: string | null = null;
  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(state.configuredTopicId)
      .setMessage(bytes)
      .execute(client);
    transactionId = tx.transactionId?.toString() ?? null;
    if (transactionId) markAnchorSubmitted(transactionId, key);

    const rec = await tx.getReceipt(client);
    const evidence = {
      schema: "nomos.gx402.hcs_anchor_evidence.v1",
      status: "SUBMITTED" as const,
      network: NETWORK,
      anchor_key: key,
      envelope,
      envelope_digest: anchorEnvelopeDigest(envelope),
      envelope_bytes: bytes.length,
      topic_id: state.configuredTopicId,
      sequence_number: rec.topicSequenceNumber ? Number(rec.topicSequenceNumber) : null,
      transaction_id: transactionId,
      consensus_timestamp: null,
      running_hash: rec.topicRunningHash ? Buffer.from(rec.topicRunningHash).toString("hex") : null,
      submitted_at: toIso(Date.now()),
      confirmed_at: null,
      hashscan_url: `${cfg.hashscanBase}/topic/${state.configuredTopicId}`,
      mirror_url: `${cfg.mirrorUrl}/topics/${state.configuredTopicId}/messages`,
      failure_code: null,
    };
    writeAtomic(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`);

    console.log(`\nsubmitted        : sequence ${evidence.sequence_number}, tx ${transactionId}`);
    console.log(`evidence         : ${EVIDENCE_FILE.replace(resolve("."), ".")} (status SUBMITTED)`);
    console.log("\nRun tools/verify-anchor.ts to promote this to CONFIRMED against a mirror node.");
    console.log("Until then nothing may present this receipt as anchored.");

    // Best-effort local re-verification. It cannot reach CONFIRMED without an
    // observation, and saying so is the point.
    const selfCheck = verifyAnchorEvidence(evidence, receipt, null);
    console.log(`self check       : ${selfCheck.ok ? "consistent" : selfCheck.reasons.join(", ")}`);
    return 0;
  } catch (err) {
    console.error(`\nsubmit failed    : ${String(err instanceof Error ? err.message : err)}`);
    if (transactionId) {
      console.error("A transaction id exists — the marker was written and the budget is spent.");
    }
    return 1;
  } finally {
    client.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
