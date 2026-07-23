#!/usr/bin/env node
/**
 * Standalone anchor verifier.
 *
 *   node tools/verify-anchor.ts <anchor-evidence.json> <receipt.json> [--mirror]
 *
 * Same intent as `verify-receipt.ts`: runnable by someone who does not trust
 * us. It rebuilds the envelope from the receipt, rebuilds the bytes from the
 * envelope, and — with `--mirror` — fetches the message from a public mirror
 * node and compares the bytes that are actually on the topic.
 *
 * Without `--mirror` this can prove internal consistency and nothing more. It
 * says so, in those words, rather than printing a green verdict that a reader
 * might take for a statement about the ledger.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyAnchorEvidence, type ObservedTopicMessage } from "../packages/hcs-anchor/src/index.ts";
import { readEnvFile } from "./load-config.ts";

async function fetchMessage(
  mirrorUrl: string,
  topicId: string,
  sequenceNumber: number,
): Promise<ObservedTopicMessage | null> {
  try {
    const res = await fetch(`${mirrorUrl}/topics/${topicId}/messages/${sequenceNumber}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ObservedTopicMessage;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const [evidencePath, receiptPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const useMirror = process.argv.includes("--mirror");

  if (!evidencePath || !receiptPath) {
    console.error("usage: node tools/verify-anchor.ts <anchor-evidence.json> <receipt.json> [--mirror]");
    return 2;
  }
  for (const p of [evidencePath, receiptPath]) {
    if (!existsSync(resolve(p))) {
      console.error(`not found: ${p}`);
      return 2;
    }
  }

  const evidence = JSON.parse(readFileSync(resolve(evidencePath), "utf8"));
  const receipt = JSON.parse(readFileSync(resolve(receiptPath), "utf8"));

  let observed: ObservedTopicMessage | null = null;
  if (useMirror) {
    const env = readEnvFile();
    const mirror = env.NOMOS_GX402_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com/api/v1";
    if (!evidence.topic_id || !evidence.sequence_number) {
      console.error("--mirror needs topic_id and sequence_number in the evidence record");
      return 1;
    }
    observed = await fetchMessage(mirror, evidence.topic_id, Number(evidence.sequence_number));
    if (!observed) {
      console.error(`mirror node returned no message for ${evidence.topic_id}#${evidence.sequence_number}`);
      return 1;
    }
  }

  const v = verifyAnchorEvidence(evidence, receipt, observed);

  console.log(`receipt          : ${receipt.receipt_id ?? "<none>"}`);
  console.log(`anchored digest  : ${evidence.envelope?.record_digest ?? "<none>"}`);
  console.log(`topic            : ${evidence.topic_id ?? "<none>"}#${evidence.sequence_number ?? "-"}`);
  console.log(`status           : ${evidence.status ?? "<none>"}`);
  console.log(`verdict          : ${v.ok ? "VALID" : "INVALID"}`);
  if (v.observed_envelope_digest) console.log(`observed digest  : ${v.observed_envelope_digest}`);
  if (!useMirror) {
    console.log("warning   : no --mirror — this checked internal consistency only. It is NOT");
    console.log("            evidence that anything reached a consensus topic.");
  }
  for (const r of v.reasons) console.log(`  reason        : ${r}`);
  return v.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code));
}
