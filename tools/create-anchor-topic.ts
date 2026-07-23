#!/usr/bin/env node
/**
 * CP-H7D — create the one consensus topic. GRANT A.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  A DRY RUN BUILDS NO TRANSACTION.                                        ║
 * ║                                                                          ║
 * ║  Not "builds one and does not send it" — builds none. No SDK import, no  ║
 * ║  client, no `TopicCreateTransaction` object, no freeze, no signature, no ║
 * ║  transaction id. The SDK is loaded inside the guard's allowed branch and ║
 * ║  nowhere else, and a test reads this file's source to prove it.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 *   node tools/create-anchor-topic.ts                 # dry run
 *   node tools/create-anchor-topic.ts --execute       # gated by Grant A; refuses today
 *   node tools/create-anchor-topic.ts --emit-grant-b  # only after a confirmed read-back
 *
 * Why this is a separate tool from `anchor-receipt.ts`:
 *
 *   Creating a topic without an admin key fixes its memo and submit key for
 *   good. Publishing a message to a topic that has already been inspected is an
 *   ordinary, bounded act. Those two deserve separate approvals, and a single
 *   tool holding both would have to be trusted to keep them apart at runtime.
 *   Two tools and two grant documents make the separation structural.
 *
 * Nothing here sets a security-relevant field by default. Memo, submit key,
 * auto-renew account, auto-renew period and the fee ceiling are all read from
 * the frozen configuration and asserted before use — an SDK default is a value
 * nobody chose, and on an immutable topic that would be permanent.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MESSAGE_SUBMIT_MAX_FEE_TINYBAR,
  TOPIC_CONFIG,
  anchorEnvelopeBytes,
  anchorKey,
  assertTopicConfig,
  buildAnchorEnvelope,
  evaluateTopicCreateGuard,
  parseTopicCreateGrant,
  topicConfigBytes,
  topicConfigDigest,
  verifyTopicReadback,
  type ObservedTopic,
  type TopicCreateGuardState,
} from "../packages/hcs-anchor/src/index.ts";
import { verifyProofOfActionReceipt } from "../packages/evidence-receipt/src/receipt.ts";
import { NETWORK, toIso } from "../packages/shared-schemas/src/index.ts";
import { loadConfig, readEnvFile } from "./load-config.ts";

const RECEIPT_PATH = resolve("docs/evidence/cp-h2/receipt.json");
const GRANT_A_FILE = resolve(".local/HCS_TOPIC_CREATE_AUTHORIZED");
const CREATED_MARKER = resolve(".local/HCS_TOPIC_CREATED");
const TOPIC_EVIDENCE = resolve("docs/evidence/cp-h7/topic-evidence.json");
const DRYRUN_FILE = resolve("docs/evidence/cp-h7/topic-create-dry-run.json");

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeAtomic(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

/**
 * Record that a topic creation happened, the moment a transaction id exists —
 * not when the result is good. CP-H2 lost that distinction once already: the
 * payment settled, the run threw before the marker was written, and the budget
 * looked unspent while the money was gone.
 */
function markTopicCreated(transactionId: string, topicId: string | null): void {
  if (existsSync(CREATED_MARKER)) return;
  writeAtomic(
    CREATED_MARKER,
    `${transactionId}\n${new Date().toISOString()}\ntopic=${topicId ?? "pending"}\n`,
    0o600,
  );
  console.log(`\n   topic-created marker written (${transactionId}) — further --execute runs are blocked.`);
}

/**
 * Derive the payer's public key. Reads the private key only far enough to take
 * its public half; nothing derived from the secret is returned beyond that.
 */
async function derivePayerPublicKey(keyPath: string): Promise<string | null> {
  if (!existsSync(keyPath)) return null;
  try {
    const { PrivateKey } = await import("@x402/hedera");
    return PrivateKey.fromStringECDSA(readFileSync(keyPath, "utf8").trim()).publicKey.toStringRaw().toLowerCase();
  } catch {
    return null;
  }
}

/** How many topics this payer has already created. `null` means the question is unanswered. */
async function countExistingTopicCreates(mirrorUrl: string, account: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${mirrorUrl}/transactions?account.id=${account}&transactiontype=CONSENSUSCREATETOPIC&limit=25`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { transactions?: unknown[] };
    return (body.transactions ?? []).length;
  } catch {
    return null;
  }
}

async function fetchTopic(mirrorUrl: string, topicId: string): Promise<ObservedTopic | null> {
  try {
    const res = await fetch(`${mirrorUrl}/topics/${topicId}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return (await res.json()) as ObservedTopic;
  } catch {
    return null;
  }
}

/**
 * Print the data an operator needs in order to write Grant B.
 *
 * Deliberately not a grant, and deliberately not written to
 * `.local/HCS_ANCHOR_AUTHORIZED`. This system may compute the values an
 * authorization would contain; it may not author its own authorization. The
 * operator copies these into the grant file, which is the moment a human
 * decides.
 */
function emitGrantBData(topicId: string): void {
  const receipt = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
  // `created_at` is pinned here so the approved bytes and the submitted bytes
  // are the same bytes. Everything else in the envelope is already fixed by
  // the receipt.
  const envelope = buildAnchorEnvelope(receipt, Date.now());
  const bytes = anchorEnvelopeBytes(envelope);

  console.log("\n── data for GRANT B (copy into .local/HCS_ANCHOR_AUTHORIZED) ──");
  console.log("   This is not a grant. It is the material one would contain.");
  console.log("   Set expires_at no more than 30 minutes ahead.\n");
  console.log(
    JSON.stringify(
      {
        grant: "NOMOS_GX402_CP_H7_ANCHOR_SUBMIT_GRANT_V2",
        network: NETWORK,
        topic_id: topicId,
        receipt_id: envelope.receipt_id,
        record_digest: envelope.record_digest,
        anchor_key: anchorKey(NETWORK, envelope.receipt_id, envelope.record_digest),
        envelope_created_at: envelope.created_at,
        envelope_sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        envelope_bytes: bytes.length,
        max_transaction_fee_tinybar: MESSAGE_SUBMIT_MAX_FEE_TINYBAR,
        expires_at: "<UTC, at most 30 minutes ahead>",
      },
      null,
      2,
    ),
  );
  console.log("\n   Note: envelope_created_at is pinned. Re-running this command produces");
  console.log("   a different created_at and therefore a different envelope_sha256 — use");
  console.log("   one emission, and submit within its grant window.");
}

async function main(): Promise<number> {
  const execute = process.argv.includes("--execute");
  const emitOnly = process.argv.includes("--emit-grant-b");

  // ── --emit-grant-b: read-back required, no transaction, no grant needed ───
  if (emitOnly) {
    const raw = readIfPresent(TOPIC_EVIDENCE);
    if (!raw) {
      console.error("REFUSED: no topic evidence — a topic must be created and read back first.");
      return 1;
    }
    const ev = JSON.parse(raw) as { status?: string; topic_id?: string };
    if (ev.status !== "CONFIRMED" || !ev.topic_id) {
      console.error(`REFUSED: topic evidence status is ${String(ev.status)} — Grant B needs a CONFIRMED read-back.`);
      return 1;
    }
    emitGrantBData(ev.topic_id);
    return 0;
  }

  console.log(`╔═══ CP-H7D — TOPIC CREATE — ${execute ? "EXECUTE (gated)" : "DRY RUN"} ═════════════`);
  console.log(
    `║ ${execute ? "Would create ONE topic if every gate passes." : "No transaction is built. No SDK is loaded."}`,
  );
  console.log("╚══════════════════════════════════════════════════════════════\n");

  // ── the configuration, asserted before anything else ─────────────────────
  try {
    assertTopicConfig(TOPIC_CONFIG);
  } catch (err) {
    console.error(`REFUSED: ${String(err instanceof Error ? err.message : err)}`);
    return 1;
  }

  const cfgDigest = topicConfigDigest(TOPIC_CONFIG);
  console.log("── topic configuration (frozen in source) ────────────────────");
  console.log(JSON.stringify(TOPIC_CONFIG, null, 2));
  console.log(`\ncanonical bytes  : ${topicConfigBytes().length}`);
  console.log(`config digest    : ${cfgDigest}`);
  console.log(`memo bytes       : ${Buffer.byteLength(TOPIC_CONFIG.memo, "utf8")} (declared ${TOPIC_CONFIG.memo_bytes})`);
  console.log(`admin key        : none — the topic will be immutable in configuration`);

  // ── the receipt this topic exists for ────────────────────────────────────
  const receipt = JSON.parse(readFileSync(RECEIPT_PATH, "utf8"));
  const rv = verifyProofOfActionReceipt(receipt, {});
  console.log(`receipt          : ${receipt.receipt_id} — ${rv.ok ? "VALID" : "INVALID"}`);
  if (!rv.ok) {
    console.error("REFUSED: refusing to create a topic for a receipt that does not verify.");
    return 1;
  }

  // ── guard state ──────────────────────────────────────────────────────────
  const cfg = loadConfig();
  const env = readEnvFile();
  const configuredTopicId = (process.env.NOMOS_GX402_HCS_TOPIC_ID ?? env.NOMOS_GX402_HCS_TOPIC_ID ?? "").trim();
  const anchorEnabled = (process.env.NOMOS_GX402_ANCHOR_ENABLED ?? env.NOMOS_GX402_ANCHOR_ENABLED ?? "false").trim() === "true";
  const payerKeyPath = resolve(cfg.payerKeyPath);

  const state: TopicCreateGuardState = {
    grant: parseTopicCreateGrant(readIfPresent(GRANT_A_FILE)),
    createdMarker: readIfPresent(CREATED_MARKER),
    anchorEnabled,
    configuredTopicId,
    payerKeyPresent: existsSync(payerKeyPath),
    derivedPayerPublicKey: await derivePayerPublicKey(payerKeyPath),
    existingTopicCreates: await countExistingTopicCreates(cfg.mirrorUrl, TOPIC_CONFIG.payer_account_id),
    nowMs: Date.now(),
  };

  const verdict = evaluateTopicCreateGuard(state);

  console.log("\n── preflight guard (GRANT A) ─────────────────────────────────");
  console.log(`anchor enabled   : ${state.anchorEnabled}`);
  console.log(`grant A document : ${state.grant ? `present, expires ${state.grant.expires_at}` : "absent or invalid"}`);
  console.log(`created marker   : ${state.createdMarker ? "present — a topic was already created" : "absent"}`);
  console.log(`configured topic : ${state.configuredTopicId || "<unset>"}`);
  console.log(`payer key file   : ${state.payerKeyPresent ? "present" : "absent"}`);
  console.log(
    `submit key check : ${
      state.derivedPayerPublicKey
        ? state.derivedPayerPublicKey === TOPIC_CONFIG.submit_key.public_key.toLowerCase()
          ? "MATCHES the configured submit key"
          : "MISMATCH"
        : "could not derive"
    }`,
  );
  console.log(
    `existing topics  : ${state.existingTopicCreates === null ? "UNKNOWN (lookup failed)" : state.existingTopicCreates}`,
  );
  console.log(`verdict          : ${verdict.allowed ? "ALLOWED" : "BLOCKED"}`);
  for (const n of verdict.notes) console.log(`  note          : ${n}`);
  for (const b of verdict.blockers) console.log(`  blocker       : ${b}`);

  // ── dry run stops here ───────────────────────────────────────────────────
  if (!execute) {
    writeAtomic(
      DRYRUN_FILE,
      `${JSON.stringify(
        {
          mode: "DRY_RUN",
          generated_at: toIso(Date.now()),
          topic_config: TOPIC_CONFIG,
          topic_config_digest: cfgDigest,
          topic_config_canonical_utf8: topicConfigBytes().toString("utf8"),
          memo_bytes: Buffer.byteLength(TOPIC_CONFIG.memo, "utf8"),
          submit_key_verified_against_payer:
            state.derivedPayerPublicKey === TOPIC_CONFIG.submit_key.public_key.toLowerCase(),
          guard: verdict,
          would_submit: {
            transactions: 1,
            transaction_type: "TopicCreateTransaction",
            built: false,
            frozen: false,
            signed: false,
            sent: false,
            transaction_id: null,
          },
          permanence_note:
            "Without an admin key the configuration and submit key cannot be changed and the topic " +
            "cannot be removed by a regular TopicDeleteTransaction. This is NOT a guarantee of " +
            "perpetual existence: expiration and auto-renew remain independent ledger properties, " +
            "and mirror-node history retention is a third-party policy, not a property of the topic.",
          note: "No transaction object was constructed. The Hedera SDK was not imported by this run.",
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\ndry-run artifact : ${DRYRUN_FILE.replace(resolve("."), ".")}`);
    console.log("\nNo transaction was built, frozen, signed or sent.");
    return 0;
  }

  // ── execute path ─────────────────────────────────────────────────────────
  if (!verdict.allowed) {
    console.error("\nREFUSED: the Grant A guard did not pass. No transaction was built, frozen,");
    console.error("signed or sent. A grant is a document naming this exact configuration digest,");
    console.error("not a file that happens to exist.");
    return 1;
  }

  // Reached only with a valid Grant A. Every field below is set explicitly;
  // nothing is left to an SDK default.
  const { Client, PrivateKey, AccountId, PublicKey, TopicCreateTransaction, Hbar, HbarUnit } = await import(
    "@hiero-ledger/sdk"
  );

  const operatorKey = PrivateKey.fromStringECDSA(readFileSync(payerKeyPath, "utf8").trim());
  const client = Client.forTestnet().setOperator(AccountId.fromString(TOPIC_CONFIG.payer_account_id), operatorKey);

  let transactionId: string | null = null;
  try {
    const tx = new TopicCreateTransaction()
      .setTopicMemo(TOPIC_CONFIG.memo)
      .setSubmitKey(PublicKey.fromStringECDSA(TOPIC_CONFIG.submit_key.public_key))
      .setAutoRenewAccountId(AccountId.fromString(TOPIC_CONFIG.auto_renew_account_id))
      .setAutoRenewPeriod(TOPIC_CONFIG.auto_renew_period_seconds)
      .setMaxTransactionFee(Hbar.from(TOPIC_CONFIG.max_transaction_fee_tinybar, HbarUnit.Tinybar));
    // No .setAdminKey(...) call exists in this file, on purpose. Omission is the
    // configuration: an admin key set "temporarily" cannot be removed later
    // without itself signing, and by then someone holds it.

    const response = await tx.execute(client);
    transactionId = response.transactionId?.toString() ?? null;
    if (transactionId) markTopicCreated(transactionId, null);

    const rec = await response.getReceipt(client);
    const topicId = rec.topicId?.toString() ?? null;
    const succeeded = rec.status?.toString() === "SUCCESS";
    console.log(`\ncreated          : topic ${topicId}, status ${rec.status?.toString()}, tx ${transactionId}`);

    if (!topicId) {
      console.error("REFUSED to continue: no topic id in the receipt. The transaction may still have landed.");
      return 1;
    }

    // ── mandatory read-back ────────────────────────────────────────────────
    // Mirror nodes lag consensus by a moment; this is the one place where
    // waiting is correct rather than lazy.
    await new Promise((r) => setTimeout(r, 5_000));
    const observed = await fetchTopic(cfg.mirrorUrl, topicId);
    const readback = verifyTopicReadback(observed, topicId, succeeded, TOPIC_CONFIG);

    console.log("\n── mirror-node read-back ─────────────────────────────────────");
    for (const c of readback.checked) {
      console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.field.padEnd(20)} expected ${c.expected} · observed ${c.observed}`);
    }
    console.log(`  verdict: ${readback.ok ? "CONFIRMED" : "NOT CONFIRMED"}`);
    for (const r of readback.reasons) console.log(`  reason : ${r}`);

    writeAtomic(
      TOPIC_EVIDENCE,
      `${JSON.stringify(
        {
          schema: "nomos.gx402.hcs_topic_evidence.v1",
          status: readback.ok ? "CONFIRMED" : "UNCONFIRMED",
          network: NETWORK,
          topic_id: topicId,
          transaction_id: transactionId,
          create_status: rec.status?.toString() ?? null,
          topic_config: TOPIC_CONFIG,
          topic_config_digest: cfgDigest,
          readback: readback,
          observed,
          created_at: toIso(Date.now()),
          hashscan_url: `${cfg.hashscanBase}/topic/${topicId}`,
          mirror_url: `${cfg.mirrorUrl}/topics/${topicId}`,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\ntopic evidence   : ${TOPIC_EVIDENCE.replace(resolve("."), ".")}`);

    if (!readback.ok) {
      console.error("\nThe topic exists but does NOT match what was approved. Grant B data is");
      console.error("withheld. Do not submit a message to this topic. Without an admin key the");
      console.error("configuration cannot be corrected — a new topic and a new Grant A are the");
      console.error("only path forward.");
      return 1;
    }

    console.log(`\nPut this in .env:  NOMOS_GX402_HCS_TOPIC_ID=${topicId}`);
    emitGrantBData(topicId);
    return 0;
  } catch (err) {
    console.error(`\ncreate failed    : ${String(err instanceof Error ? err.message : err)}`);
    if (transactionId) {
      console.error("A transaction id exists — the marker was written. Check the ledger before retrying;");
      console.error("a second create would produce a second permanent topic.");
    }
    return 1;
  } finally {
    client.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
