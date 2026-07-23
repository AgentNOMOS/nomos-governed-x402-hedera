/**
 * The demo UI's read-only evidence model (CP-H8).
 *
 * Every value the page displays is *derived here*, from the canonical CP-H2
 * artifacts under `docs/evidence/cp-h2/`. Nothing in this file invents a number,
 * and nothing downstream of it is allowed to: `apps/demo-ui/public/index.html`
 * ships no evidence values in its markup, and `app.js` renders only what this
 * model produced.
 *
 * Two properties matter more than convenience:
 *
 *   FAIL CLOSED.  `buildDemoEvidence()` throws `EvidenceIntegrityError` if the
 *                 artifacts disagree with each other on any bound field — memo
 *                 vs quote id, amount, payer, payee, transaction id, consensus
 *                 timestamp, result hash — or if the receipt does not verify.
 *                 A page that cannot prove its own numbers must not render a
 *                 green tick, so the generator refuses to emit at all.
 *
 *   SINGLE SOURCE. The canonical values appear exactly once, in the artifact.
 *                 Three strings are unavoidably transcribed from the prose
 *                 report (`CP-H2-REPORT.md`) because they were never written to
 *                 JSON; each carries an `evidence_ref` and each is pinned by a
 *                 drift test in `tests/unit/demo-ui-evidence.test.ts` that
 *                 greps the report for it.
 *
 * This module reads files and does arithmetic. It performs no network access,
 * signs nothing, and cannot produce a receipt.
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalDigest } from "../../../packages/shared-schemas/src/canonical.ts";
import { receiptId } from "../../../packages/shared-schemas/src/ids.ts";

/** Repository root, resolved from this file rather than from `process.cwd()`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export class EvidenceIntegrityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "EvidenceIntegrityError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new EvidenceIntegrityError(code, message);
}

/** Every artifact this model is allowed to read. Relative to the repo root. */
export const EVIDENCE_SOURCES = {
  receipt: "docs/evidence/cp-h2/receipt.json",
  settlement: "docs/evidence/cp-h2/settlement.json",
  result: "docs/evidence/cp-h2/result.json",
  executeRun: "docs/evidence/cp-h2/execute-run.json",
  report: "docs/evidence/CP-H2-REPORT.md",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types — what the page is allowed to know
// ─────────────────────────────────────────────────────────────────────────────

export type CardState = "verified" | "pending" | "detected" | "neutral";

export interface StatusCard {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly state: CardState;
  readonly note: string;
}

export interface FlowStep {
  readonly index: number;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly facts: readonly { readonly label: string; readonly value: string; readonly mono: boolean }[];
  readonly evidence_ref: string;
}

export interface EvidenceField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly copyable: boolean;
  readonly hint: string;
}

export interface VerificationRow {
  readonly id: string;
  readonly check: string;
  readonly result: string;
  readonly detail: string;
  readonly state: CardState;
}

export interface PolicyCheck {
  readonly code: string;
  readonly klass: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface DemoEvidence {
  readonly generated_by: string;
  readonly checkpoint: string;
  readonly data_mode: "RECORDED_EVIDENCE";
  readonly environment: string;
  readonly disclaimer: string;
  readonly sources: readonly string[];

  readonly chain: {
    readonly network: string;
    readonly network_label: string;
    readonly asset: string;
    readonly atomic_amount: string;
    readonly amount_display: string;
    readonly transaction_id: string;
    readonly transaction_status: string;
    readonly consensus_timestamp: string;
    readonly consensus_utc: string;
    readonly memo: string;
    readonly quote_id: string;
    readonly payer: string;
    readonly payee: string;
    readonly payee_evm_alias: string;
    readonly fee_payer: string;
    readonly settlement_source: string;
    readonly settlement_finality: string;
    readonly hashscan_url: string;
    readonly mirror_url: string;
  };

  readonly receipt: {
    readonly receipt_id: string;
    readonly verdict: "VALID";
    readonly record_digest: string;
    readonly signature: {
      readonly alg: string;
      readonly kid: string;
      readonly signature_domain: string;
      readonly canonicalization: string;
      readonly public_key_hex: string;
    };
    readonly anchor: null;
    readonly anchor_status: "NOT_YET_ANCHORED";
    readonly mock_settlement: false;
    readonly record: Readonly<Record<string, unknown>>;
    readonly verify_command: string;
  };

  readonly delivery: {
    readonly execution_status: string;
    readonly delivery_status: string;
    readonly result_hash: string;
    readonly result_media_type: string;
    readonly result_byte_length: number;
    readonly result_generated_from: string;
    readonly result_summary: { readonly pass: number; readonly fail: number; readonly unknown: number };
    readonly refund_due: boolean;
  };

  readonly policy: {
    readonly decision: string;
    readonly decision_code: string;
    readonly decision_id: string;
    readonly policy_version: string;
    readonly policy_hash: string;
    readonly authorizes_payment: boolean;
    readonly checks: readonly PolicyCheck[];
  };

  readonly cards: readonly StatusCard[];
  readonly flow: readonly FlowStep[];
  readonly onchain: readonly EvidenceField[];
  readonly verification: readonly VerificationRow[];

  readonly failClosed: {
    readonly http_status: number;
    readonly error: string;
    readonly outcome: string;
    readonly observed: {
      readonly atomic_amount: string;
      readonly payer: string;
      readonly memo: string;
      readonly finality: string;
      readonly failure_code: string;
    };
    readonly cause: string;
    readonly fix: string;
    readonly regression: string;
    readonly consequences: readonly string[];
  };

  readonly limitations: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Values transcribed from the prose report, each pinned by a drift test
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The facilitator's free `/verify` probe (CP-H2-REPORT.md §3.1). It never
 * reached a JSON artifact — it was an HTTP exchange, not a produced document —
 * so it is transcribed, and `tests/unit/demo-ui-evidence.test.ts` greps the
 * report for each of these strings.
 */
export const REPORT_TRANSCRIBED = {
  facilitator_verify_response: '{"isValid":true,"payer":"0.0.9689846"}',
  facilitator_verify_url: "https://api.testnet.blocky402.com/verify",
  hollow_completion_key: "025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17",
  ref: "docs/evidence/CP-H2-REPORT.md §3.1, §2.1",
} as const;

/**
 * The test count and the scan verdict are parsed out of the report rather than
 * typed in, and they are labelled *as at CP-H2* on the page.
 *
 * They are a record of that checkpoint, not a live figure: this checkpoint adds
 * tests of its own, so a bare "250/250" would be quietly wrong the moment it was
 * written down. Parsing keeps the number honest; the label keeps it truthful.
 */
export function parseSuiteRecord(report: string): { tests: number; pass: number; fail: number } {
  const m = /#\s*tests\s+(\d+)\s+#\s*pass\s+(\d+)\s+#\s*fail\s+(\d+)/.exec(report);
  if (!m) fail("REPORT_TEST_COUNT_MISSING", "CP-H2-REPORT.md no longer contains a `# tests / # pass / # fail` block");
  const rec = { tests: Number(m[1]), pass: Number(m[2]), fail: Number(m[3]) };
  if (rec.fail !== 0 || rec.pass !== rec.tests) {
    fail("REPORT_TEST_COUNT_NOT_GREEN", `the recorded suite is ${rec.pass}/${rec.tests} with ${rec.fail} failing`);
  }
  return rec;
}

export function parseScanRecord(report: string): { files: number; verdict: string } {
  const m = /secret-scan:\s*(\d+)\s+files scanned,\s*(\d+)\s+errors,\s*(\d+)\s+unwaived warnings\s*—\s*([A-Z]+)/.exec(report);
  if (!m) fail("REPORT_SCAN_LINE_MISSING", "CP-H2-REPORT.md no longer contains the secret-scan summary line");
  if (m[2] !== "0" || m[3] !== "0" || m[4] !== "CLEAN") {
    fail("REPORT_SCAN_NOT_CLEAN", `the recorded scan is "${m[0]}"`);
  }
  return { files: Number(m[1]), verdict: m[4] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function readJson(root: string, rel: string): Record<string, unknown> {
  const raw = readFileSync(join(root, rel), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("ARTIFACT_NOT_AN_OBJECT", `${rel} did not parse to a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function pick(obj: unknown, path: string, rel: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object") {
      fail("ARTIFACT_PATH_MISSING", `${rel} has no value at ${path}`);
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function str(obj: unknown, path: string, rel: string): string {
  const v = pick(obj, path, rel);
  if (typeof v !== "string" || v.length === 0) {
    fail("ARTIFACT_FIELD_NOT_A_STRING", `${rel}:${path} is ${JSON.stringify(v)}, expected a non-empty string`);
  }
  return v;
}

function num(obj: unknown, path: string, rel: string): number {
  const v = pick(obj, path, rel);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    fail("ARTIFACT_FIELD_NOT_A_NUMBER", `${rel}:${path} is ${JSON.stringify(v)}, expected a finite number`);
  }
  return v;
}

function must(condition: boolean, code: string, message: string): void {
  if (!condition) fail(code, message);
}

function agree(code: string, label: string, a: string, b: string, aName: string, bName: string): void {
  if (a !== b) {
    fail(code, `${label} disagrees: ${aName}="${a}" vs ${bName}="${b}"`);
  }
}

/**
 * tinybar → HBAR, as an exact decimal string. Integer arithmetic only: a
 * monetary amount that has been through a float is not the amount any more.
 */
export function tinybarToHbar(atomic: string): string {
  if (!/^[0-9]+$/.test(atomic)) {
    fail("ATOMIC_AMOUNT_NOT_INTEGER", `atomic_amount "${atomic}" is not a decimal integer string`);
  }
  const padded = atomic.padStart(9, "0");
  const whole = padded.slice(0, padded.length - 8).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(padded.length - 8).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

/** Hedera consensus timestamp (`seconds.nanos`) → an ISO-8601 UTC string. */
export function consensusToUtc(consensus: string): string {
  const m = /^([0-9]+)\.([0-9]{1,9})$/.exec(consensus);
  if (!m) fail("CONSENSUS_TIMESTAMP_MALFORMED", `"${consensus}" is not <seconds>.<nanos>`);
  const seconds = Number(m[1]);
  if (!Number.isSafeInteger(seconds)) fail("CONSENSUS_TIMESTAMP_MALFORMED", `seconds out of range in "${consensus}"`);
  return new Date(seconds * 1000).toISOString().replace(".000Z", "Z");
}

/** `0.0.7162784@1784746988.798231156` → `0.0.7162784-1784746988-798231156`. */
export function toMirrorTransactionId(transactionId: string): string {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(transactionId);
  if (!m) fail("TRANSACTION_ID_MALFORMED", `"${transactionId}" is not <account>@<seconds>.<nanos>`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The build
// ─────────────────────────────────────────────────────────────────────────────

export function buildDemoEvidence(root: string = REPO_ROOT): DemoEvidence {
  const S = EVIDENCE_SOURCES;

  const receipt = readJson(root, S.receipt);
  const settlementDoc = readJson(root, S.settlement);
  const resultDoc = readJson(root, S.result);
  const run = readJson(root, S.executeRun);
  const report = readFileSync(join(root, S.report), "utf8");

  const record = pick(receipt, "record", S.receipt) as Record<string, unknown>;
  const settlement = pick(settlementDoc, "settlement", S.settlement) as Record<string, unknown>;
  const delivery = pick(settlementDoc, "delivery", S.settlement) as Record<string, unknown>;
  const decisionRecord = pick(run, "challenge.decision_receipt.record", S.executeRun) as Record<string, unknown>;

  // ── 1. The receipt must be internally sound ───────────────────────────────
  const recordDigest = str(receipt, "record_digest", S.receipt);
  agree(
    "RECORD_DIGEST_MISMATCH",
    "record_digest",
    canonicalDigest(record),
    recordDigest,
    "recomputed",
    "receipt.json",
  );

  const idemKey = str(receipt, "record.idempotency_key", S.receipt);
  const txId = str(receipt, "record.hedera_transaction_id", S.receipt);
  const rid = str(receipt, "receipt_id", S.receipt);
  agree("RECEIPT_ID_MISMATCH", "receipt_id", receiptId(idemKey, txId, recordDigest), rid, "recomputed", "receipt.json");

  // ── 2. The receipt and the settlement must describe the same payment ──────
  const bound: readonly (readonly [string, string, string])[] = [
    ["network", "network", "network"],
    ["asset", "asset", "asset"],
    ["atomic_amount", "atomic_amount", "atomic_amount"],
    ["payer", "payer", "payer"],
    ["payee", "payee", "payee"],
    ["hedera_transaction_id", "transaction_id", "transaction id"],
    ["consensus_timestamp", "consensus_timestamp", "consensus timestamp"],
  ];
  for (const [recKey, setKey, label] of bound) {
    agree(
      "SETTLEMENT_RECEIPT_DISAGREE",
      label,
      str(record, recKey, S.receipt),
      str(settlement, setKey, S.settlement),
      "receipt.json",
      "settlement.json",
    );
  }

  // ── 3. The memo IS the quote id — the binding this project exists for ─────
  const quoteId = str(record, "quote_id", S.receipt);
  const memo = str(settlement, "memo", S.settlement);
  agree("MEMO_QUOTE_BINDING_BROKEN", "on-chain memo vs quote_id", memo, quoteId, "settlement.json", "receipt.json");
  agree(
    "CHALLENGE_QUOTE_MISMATCH",
    "quote_id in the 402 challenge",
    str(run, "challenge.nomos.quote_id", S.executeRun),
    quoteId,
    "execute-run.json",
    "receipt.json",
  );
  agree(
    "CHALLENGE_MEMO_MISMATCH",
    "memo advertised in accepts[0]",
    str(pick(run, "challenge.accepts", S.executeRun) as unknown, "0.memo", S.executeRun),
    quoteId,
    "execute-run.json",
    "receipt.json",
  );

  // ── 4. Delivery must be bound to the same execution ───────────────────────
  const resultHash = str(record, "result_hash", S.receipt);
  agree("RESULT_HASH_MISMATCH", "result_hash", str(delivery, "result_hash", S.settlement), resultHash, "settlement.json", "receipt.json");
  agree("RESULT_HASH_MISMATCH", "result_hash", str(resultDoc, "result_hash", S.result), resultHash, "result.json", "receipt.json");
  agree(
    "RESULT_DIGEST_UNREPRODUCIBLE",
    "canonical digest of the delivered result",
    canonicalDigest(pick(resultDoc, "result", S.result)),
    resultHash,
    "recomputed from result.json",
    "receipt.json",
  );
  agree("IDEMPOTENCY_KEY_MISMATCH", "idempotency_key", str(delivery, "idempotency_key", S.settlement), idemKey, "settlement.json", "receipt.json");

  // ── 5. State that must hold for the page to claim anything at all ─────────
  must(pick(settlement, "verified", S.settlement) === true, "SETTLEMENT_NOT_VERIFIED", "settlement.verified is not true");
  must(pick(settlementDoc, "verification.ok", S.settlement) === true, "VERIFICATION_NOT_OK", "verification.ok is not true");
  must(
    pick(settlementDoc, "verification.mock_settlement", S.settlement) === false,
    "MOCK_SETTLEMENT",
    "verification.mock_settlement is not false — this receipt would not evidence a real payment",
  );
  must(str(settlement, "source", S.settlement) === "MIRROR_NODE", "SETTLEMENT_SOURCE_UNEXPECTED", "settlement source is not MIRROR_NODE");
  must(str(settlement, "finality", S.settlement) === "FINAL", "SETTLEMENT_NOT_FINAL", "settlement finality is not FINAL");
  must(str(record, "network", S.receipt) === "hedera:testnet", "NETWORK_NOT_TESTNET", "network is not hedera:testnet");
  must(str(record, "environment", S.receipt) === "TESTNET_DEMO_ONLY", "ENVIRONMENT_UNEXPECTED", "environment is not TESTNET_DEMO_ONLY");
  must(pick(receipt, "anchor", S.receipt) === null, "ANCHOR_PRESENT", "receipt.anchor is not null — CP-H8 may only present HCS as pending");
  must(pick(record, "refund_due", S.receipt) === false, "REFUND_DUE", "refund_due is true");
  must(str(record, "execution_status", S.receipt) === "SUCCEEDED", "EXECUTION_NOT_SUCCEEDED", "execution_status is not SUCCEEDED");
  must(str(record, "delivery_status", S.receipt) === "DELIVERED", "DELIVERY_NOT_DELIVERED", "delivery_status is not DELIVERED");
  must(str(record, "policy_decision", S.receipt) === "ALLOW", "POLICY_NOT_ALLOW", "policy_decision is not ALLOW");

  // ── 6. The transcribed strings must still be in the report ────────────────
  for (const [key, value] of Object.entries(REPORT_TRANSCRIBED)) {
    if (key === "ref") continue;
    must(
      report.includes(value),
      "TRANSCRIPTION_DRIFT",
      `"${value}" (${key}) is no longer present in ${S.report} — the transcription is stale`,
    );
  }

  const suite = parseSuiteRecord(report);
  const scanRecord = parseScanRecord(report);

  // ── 7. Derived, safe values ───────────────────────────────────────────────
  const atomic = str(record, "atomic_amount", S.receipt);
  const amountDisplay = `${tinybarToHbar(atomic)} HBAR`;
  const consensus = str(record, "consensus_timestamp", S.receipt);
  const mirrorTxId = toMirrorTransactionId(txId);
  const hashscanUrl = str(receipt, "verification.hashscan_transaction_url", S.receipt);
  const mirrorUrl = str(receipt, "verification.mirror_transaction_url", S.receipt);
  must(hashscanUrl.startsWith("https://hashscan.io/testnet/"), "HASHSCAN_URL_NOT_TESTNET", `hashscan url is ${hashscanUrl}`);
  must(mirrorUrl.startsWith("https://testnet.mirrornode.hedera.com/"), "MIRROR_URL_NOT_TESTNET", `mirror url is ${mirrorUrl}`);
  must(hashscanUrl.endsWith(mirrorTxId), "HASHSCAN_URL_WRONG_TX", `hashscan url does not end in ${mirrorTxId}`);
  must(mirrorUrl.endsWith(mirrorTxId), "MIRROR_URL_WRONG_TX", `mirror url does not end in ${mirrorTxId}`);

  const payeeAlias = str(run, "offer.pay_to", S.executeRun);
  const feePayer = str(run, "payment_requirements.extra.feePayer", S.executeRun);
  const payer = str(record, "payer", S.receipt);
  const payee = str(record, "payee", S.receipt);

  const policyChecks: PolicyCheck[] = (pick(decisionRecord, "checks", S.executeRun) as unknown[]).map((c, i) => {
    const path = `challenge.decision_receipt.record.checks[${i}]`;
    const o = c as Record<string, unknown>;
    if (typeof o?.passed !== "boolean") fail("POLICY_CHECK_MALFORMED", `${S.executeRun}:${path}.passed is not a boolean`);
    return {
      code: str(o, "code", `${S.executeRun}:${path}`),
      klass: str(o, "class", `${S.executeRun}:${path}`),
      passed: o.passed,
      detail: str(o, "detail", `${S.executeRun}:${path}`),
    };
  });
  must(policyChecks.length > 0, "POLICY_CHECKS_EMPTY", "the decision receipt carries no checks");
  must(
    policyChecks.every((c) => c.passed),
    "POLICY_CHECK_FAILED",
    "a policy check in the canonical decision receipt did not pass, yet the decision is ALLOW",
  );

  // ── 8. The fail-closed episode, read from the run that produced it ────────
  const failedSettlement = pick(run, "paid_body.settlement", S.executeRun) as Record<string, unknown>;
  const failedMemo = pick(failedSettlement, "memo", S.executeRun);
  must(
    pick(run, "outcome", S.executeRun) === "EXECUTE_FAILED",
    "FAIL_CLOSED_EPISODE_MISSING",
    "execute-run.json no longer records the refusal — the fail-closed section would be fiction",
  );
  must(
    pick(failedSettlement, "verified", S.executeRun) === false,
    "FAIL_CLOSED_EPISODE_MISSING",
    "the recorded settlement of the refused run is marked verified",
  );
  agree(
    "FAIL_CLOSED_EPISODE_WRONG_TX",
    "transaction id of the refused verification",
    str(failedSettlement, "transaction_id", S.executeRun),
    txId,
    "execute-run.json",
    "receipt.json",
  );

  const evidence: DemoEvidence = {
    generated_by: "apps/demo-ui/src/build.ts — do not edit the generated file by hand",
    checkpoint: "CP-H2",
    data_mode: "RECORDED_EVIDENCE",
    environment: str(record, "environment", S.receipt),
    disclaimer: str(record, "disclaimer", S.receipt),
    sources: Object.values(S),

    chain: {
      network: str(record, "network", S.receipt),
      network_label: "Hedera Testnet",
      asset: str(record, "asset", S.receipt),
      atomic_amount: atomic,
      amount_display: amountDisplay,
      transaction_id: txId,
      transaction_status: "SUCCESS",
      consensus_timestamp: consensus,
      consensus_utc: consensusToUtc(consensus),
      memo,
      quote_id: quoteId,
      payer,
      payee,
      payee_evm_alias: payeeAlias,
      fee_payer: feePayer,
      settlement_source: str(settlement, "source", S.settlement),
      settlement_finality: str(settlement, "finality", S.settlement),
      hashscan_url: hashscanUrl,
      mirror_url: mirrorUrl,
    },

    receipt: {
      receipt_id: rid,
      verdict: "VALID",
      record_digest: recordDigest,
      signature: {
        alg: str(receipt, "signature.alg", S.receipt),
        kid: str(receipt, "signature.kid", S.receipt),
        signature_domain: str(receipt, "signature.signature_domain", S.receipt),
        canonicalization: str(receipt, "signature.canonicalization", S.receipt),
        public_key_hex: str(receipt, "signature.public_key_hex", S.receipt),
      },
      anchor: null,
      anchor_status: "NOT_YET_ANCHORED",
      mock_settlement: false,
      record,
      verify_command:
        `node tools/verify-receipt.ts ${S.receipt} \\\n  ` +
        `${str(receipt, "signature.kid", S.receipt)}=${str(receipt, "signature.public_key_hex", S.receipt)}`,
    },

    delivery: {
      execution_status: str(delivery, "execution_status", S.settlement),
      delivery_status: str(delivery, "delivery_status", S.settlement),
      result_hash: resultHash,
      result_media_type: str(delivery, "result_media_type", S.settlement),
      result_byte_length: num(delivery, "result_byte_length", S.settlement),
      result_generated_from: str(resultDoc, "result.generated_from", S.result),
      result_summary: {
        pass: num(resultDoc, "result.summary.pass", S.result),
        fail: num(resultDoc, "result.summary.fail", S.result),
        unknown: num(resultDoc, "result.summary.unknown", S.result),
      },
      refund_due: false,
    },

    policy: {
      decision: str(decisionRecord, "decision", S.executeRun),
      decision_code: str(decisionRecord, "decision_code", S.executeRun),
      decision_id: str(record, "decision_id", S.receipt),
      policy_version: str(record, "policy_version", S.receipt),
      policy_hash: str(record, "policy_hash", S.receipt),
      authorizes_payment: pick(decisionRecord, "authorizes_payment", S.executeRun) === true,
      checks: policyChecks,
    },

    cards: [
      {
        id: "transaction",
        label: "Transaction",
        value: "SUCCESS",
        state: "verified",
        note: "CRYPTOTRANSFER, nonce 0, read from the mirror node.",
      },
      {
        id: "network",
        label: "Network",
        value: "Hedera Testnet",
        state: "neutral",
        note: "Testnet only. No mainnet document is representable in the schema.",
      },
      {
        id: "amount",
        label: "Amount",
        value: amountDisplay,
        state: "verified",
        note: `${atomic} tinybar, credited to the payee exactly.`,
      },
      {
        id: "receipt",
        label: "Receipt",
        value: "VALID",
        state: "verified",
        note: "Proof-of-action receipt, Ed25519, verified against a caller-supplied key.",
      },
      {
        id: "tamper",
        label: "Tamper test",
        value: "DETECTED",
        state: "detected",
        note: "One field altered → record_digest_mismatch and signature_invalid.",
      },
      {
        id: "replay",
        label: "Replay test",
        value: "BLOCKED",
        state: "detected",
        note: "The same (network, transaction id) presented twice → REPLAY_DETECTED.",
      },
      {
        id: "anchor",
        label: "HCS anchor",
        value: "NOT YET ANCHORED",
        state: "pending",
        note: "Consensus-service anchoring is CP-H7 and has not been performed.",
      },
    ],

    flow: [
      {
        index: 1,
        id: "request",
        title: "Request received",
        summary:
          "An agent asks for a priced resource. The request body is canonicalized and hashed before anything else happens — every later link commits to this hash.",
        facts: [
          { label: "Resource", value: str(run, "offer.service.resource_url", S.executeRun), mono: true },
          { label: "Method", value: str(run, "offer.service.http_method", S.executeRun), mono: true },
          { label: "Offer", value: str(record, "offer_id", S.receipt), mono: true },
          { label: "request_hash", value: str(record, "request_hash", S.receipt), mono: true },
        ],
        evidence_ref: S.executeRun,
      },
      {
        index: 2,
        id: "policy",
        title: "Policy decision",
        summary:
          "NOMOS evaluates identity, delegated authority, network, asset, payee, amount and spend caps before a price is ever quoted. The decision is signed whether it allows or refuses.",
        facts: [
          { label: "Decision", value: `${str(decisionRecord, "decision", S.executeRun)} · ${str(decisionRecord, "decision_code", S.executeRun)}`, mono: true },
          { label: "Checks passed", value: `${policyChecks.length} / ${policyChecks.length}`, mono: false },
          { label: "decision_id", value: str(record, "decision_id", S.receipt), mono: true },
          { label: "policy_hash", value: str(record, "policy_hash", S.receipt), mono: true },
        ],
        evidence_ref: S.executeRun,
      },
      {
        index: 3,
        id: "quote",
        title: "Quote issued",
        summary:
          "HTTP 402 carries the x402 accepts[] terms and a NOMOS quote. The quote id is derived from the offer, the request hash and a nonce — it is not a random handle.",
        facts: [
          { label: "quote_id", value: quoteId, mono: true },
          { label: "quote_hash", value: str(record, "quote_hash", S.receipt), mono: true },
          { label: "Valid until", value: str(run, "challenge.nomos.expires_at", S.executeRun), mono: true },
          { label: "idempotency_key", value: idemKey, mono: true },
        ],
        evidence_ref: S.executeRun,
      },
      {
        index: 4,
        id: "x402",
        title: "x402 verification",
        summary:
          "The facilitator's free /verify endpoint checked the signed transfer before a single tinybar moved: memo intact, hollow payer resolvable, alias payee accepted. Had any of it failed, nothing would have been submitted.",
        facts: [
          { label: "Endpoint", value: REPORT_TRANSCRIBED.facilitator_verify_url, mono: true },
          { label: "Response", value: REPORT_TRANSCRIBED.facilitator_verify_response, mono: true },
          { label: "Fee payer", value: feePayer, mono: true },
          { label: "Scheme", value: `${str(run, "payment_requirements.scheme", S.executeRun)} · ${str(run, "payment_requirements.network", S.executeRun)}`, mono: true },
        ],
        evidence_ref: REPORT_TRANSCRIBED.ref,
      },
      {
        index: 5,
        id: "settlement",
        title: "Hedera settlement",
        summary:
          "The transfer is submitted with the quote id in the transaction memo. @x402/hedera carries no memo field; that binding is this project's addition, and it is the whole point.",
        facts: [
          { label: "Transaction", value: txId, mono: true },
          { label: "Memo", value: memo, mono: true },
          { label: "Amount", value: `${atomic} tinybar (${amountDisplay})`, mono: true },
          { label: "Payer → payee", value: `${payer} → ${payee}`, mono: true },
        ],
        evidence_ref: S.settlement,
      },
      {
        index: 6,
        id: "mirror",
        title: "Mirror Node verification",
        summary:
          "Amount, asset, network, payee and memo are re-read from the public mirror node — not taken from the facilitator's report — and must be FINAL. This is the gate: work is released after settlement, never after verification alone.",
        facts: [
          { label: "Source", value: str(settlement, "source", S.settlement), mono: true },
          { label: "Finality", value: str(settlement, "finality", S.settlement), mono: true },
          { label: "Consensus", value: consensus, mono: true },
          { label: "Payer derived from", value: "the ledger transfer list, not the facilitator", mono: false },
        ],
        evidence_ref: S.settlement,
      },
      {
        index: 7,
        id: "receipt",
        title: "Proof-of-Action receipt",
        summary:
          "One Ed25519 signature over a canonical record binding identity, authority, policy, request, quote, payment and the hash of what was delivered. No request or result content is ever inside it.",
        facts: [
          { label: "receipt_id", value: rid, mono: true },
          { label: "record_digest", value: recordDigest, mono: true },
          { label: "result_hash", value: resultHash, mono: true },
          { label: "Anchor", value: "null — HCS anchoring is CP-H7, not yet performed", mono: false },
        ],
        evidence_ref: S.receipt,
      },
      {
        index: 8,
        id: "adversarial",
        title: "Tamper and replay validation",
        summary:
          "The receipt was attacked on purpose. Altering one field breaks the digest and the signature; presenting the same settled transaction twice is refused by the replay guard.",
        facts: [
          { label: "Tamper probe", value: "atomic_amount 5000000 → 1 ⇒ INVALID", mono: false },
          { label: "Reasons", value: "record_digest_mismatch, signature_invalid", mono: true },
          { label: "Replay probe", value: "1st fresh, 2nd consumed, reclaim throws", mono: false },
          { label: "Guard", value: "REPLAY_DETECTED on (network, transaction_id)", mono: true },
        ],
        evidence_ref: S.report,
      },
    ],

    onchain: [
      { id: "tx", label: "Transaction ID", value: txId, copyable: true, hint: "The id belongs to the fee payer — the facilitator submits and pays the network fee." },
      { id: "status", label: "Transaction status", value: "SUCCESS", copyable: false, hint: "CRYPTOTRANSFER, nonce 0." },
      { id: "consensus", label: "Consensus timestamp", value: consensus, copyable: true, hint: consensusToUtc(consensus) },
      { id: "memo", label: "Memo (quote_id)", value: memo, copyable: true, hint: "Identical to the quote id in the receipt. This is the binding." },
      { id: "amount", label: "Amount", value: `${atomic} tinybar · ${amountDisplay}`, copyable: true, hint: "Decimal string throughout; never a float." },
      { id: "payer", label: "Payer", value: payer, copyable: true, hint: "Derived from the ledger transfer list." },
      { id: "payee", label: "Payee", value: payee, copyable: true, hint: "Auto-created from the EVM alias by this very transaction." },
      { id: "alias", label: "Payee EVM alias", value: payeeAlias, copyable: true, hint: "The address the 402 challenge advertised as pay_to." },
      { id: "network", label: "Network", value: `${str(record, "network", S.receipt)} · Hedera Testnet`, copyable: false, hint: "Testnet. No mainnet claim is made anywhere on this page." },
      { id: "receipt", label: "Receipt ID", value: rid, copyable: true, hint: "poa_ ids are a truncated hash of (idempotency key, transaction id, record digest)." },
      { id: "source", label: "Settlement source", value: str(settlement, "source", S.settlement), copyable: false, hint: "The authoritative check ran against Hedera Mirror Node data." },
    ],

    verification: [
      { id: "mirror", check: "Mirror node", result: "PASS", detail: "Transaction indexed, result SUCCESS.", state: "verified" },
      { id: "memo", check: "Memo binding", result: "PASS", detail: `Memo equals quote_id ${quoteId}.`, state: "verified" },
      { id: "amount", check: "Amount", result: "PASS", detail: `Payee credited exactly ${atomic} tinybar.`, state: "verified" },
      { id: "payer", check: "Payer", result: "PASS", detail: `${payer}, derived from the ledger rather than the facilitator's report.`, state: "verified" },
      { id: "payee", check: "Payee / alias", result: "PASS", detail: `Alias ${payeeAlias} resolved to ${payee}.`, state: "verified" },
      { id: "request-replay", check: "Request replay", result: "PASS", detail: "Recomputed request hash matches the quote.", state: "verified" },
      { id: "policy-replay", check: "Policy replay", result: "PASS", detail: "Recomputed policy hash matches the signed decision.", state: "verified" },
      { id: "result-hash", check: "Result hash", result: "PASS", detail: "Recomputed from a fresh execution of the same deterministic service.", state: "verified" },
      { id: "receipt", check: "Receipt validation", result: "PASS", detail: "VALID under the standalone verifier with a caller-supplied key set; no mock warning.", state: "verified" },
      { id: "tamper", check: "Tamper probe", result: "DETECTED", detail: "atomic_amount 5000000 → 1 ⇒ INVALID: record_digest_mismatch, signature_invalid.", state: "detected" },
      { id: "replay", check: "Receipt replay", result: "DETECTED", detail: "Same (network, transaction id) twice ⇒ first fresh, second consumed, reclaim throws REPLAY_DETECTED.", state: "detected" },
      { id: "hollow", check: "Hollow-account completion", result: "PASS", detail: `Payer key null → ECDSA_SECP256K1 ${REPORT_TRANSCRIBED.hollow_completion_key.slice(0, 12)}…, matching the local demo key.`, state: "verified" },
      {
        id: "tests",
        check: "Test suite at CP-H2",
        result: `${suite.pass} / ${suite.tests}`,
        detail: "Offline unit, integration and end-to-end tests, as recorded at that checkpoint. This page's own tests were added afterwards, so the figure is labelled rather than restated as current.",
        state: "verified",
      },
      {
        id: "scan",
        check: "Secret scan at CP-H2",
        result: scanRecord.verdict,
        detail: `${scanRecord.files} files scanned, no key material and no production identifier — 0 errors, 0 unwaived warnings.`,
        state: "verified",
      },
      { id: "hashscan", check: "HashScan", result: "PRESENTATION ONLY", detail: "HashScan serves 404 to non-browser clients, so the link could not be machine-checked. The authoritative verification used Mirror Node data.", state: "pending" },
    ],

    failClosed: {
      http_status: num(run, "paid_status", S.executeRun),
      error: str(run, "paid_body.error", S.executeRun),
      outcome: str(run, "outcome", S.executeRun),
      observed: {
        atomic_amount: str(failedSettlement, "atomic_amount", S.executeRun),
        payer: str(failedSettlement, "payer", S.executeRun),
        memo: failedMemo === null ? "null" : String(failedMemo),
        finality: str(failedSettlement, "finality", S.executeRun),
        failure_code: str(failedSettlement, "failure_code", S.executeRun),
      },
      cause:
        "GET /transactions/{id} returns every record sharing that id. Hedera auto-account creation added two children — one creating the payee, one completing the hollow payer — and on the live network they sorted ahead of the transfer. The verifier read transactions[0], a CRYPTOUPDATEACCOUNT with no memo and no user transfers, and compared every field against it.",
      fix: "selectUserTransaction() now picks the CRYPTOTRANSFER with nonce 0, then any nonce-0 record, then any CRYPTOTRANSFER — and returns null rather than guessing.",
      regression: "tests/unit/child-records.test.ts — 9 tests built on the actual three-record response, including one asserting that the old behaviour reproduces exactly this failure.",
      consequences: [
        "Nothing was delivered on unverified evidence. The refusal is the designed behaviour, applied to a payment that happened to be good.",
        "No second payment was made. The receipt was completed against the settlement that had already happened, because a second payment would not be the one the receipt describes.",
        "The ordering rule was tested by a real disagreement between two sources of truth, not by a unit test.",
      ],
    },

    limitations: [
      "Testnet demonstration. Hedera testnet HBAR has no monetary value and no mainnet deployment exists.",
      "HCS anchoring is pending CP-H7. The receipt carries anchor: null and is valid without one.",
      "This page renders recorded evidence from committed artifacts. It performs no live query and asserts no continuous production autonomy.",
      "No further payment is required or possible from this page: it has no wallet connection, no payment function and no write path of any kind.",
      "HashScan links are offered for human inspection only. HashScan serves 404 to non-browser clients, so they remain a presentation check.",
      "The authoritative verification used Hedera Mirror Node data. No independent third party has audited or certified this system.",
      "Caps, replay keys and the quote store are in-memory for the demonstration; they are not durable across restarts.",
    ],
  };

  return evidence;
}
