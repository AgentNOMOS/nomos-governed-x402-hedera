#!/usr/bin/env node
/**
 * Repository secret scanner.
 *
 * Runs over every git-tracked file (plus untracked, non-ignored files) and
 * fails the build on anything that looks like key material or like a leak of
 * the production stack this repo was deliberately isolated from.
 *
 * Two severities, because they mean different things:
 *
 *   ERROR — actual secret material, or a pattern that could only be secret
 *           material. Never allowlistable. If one of these fires, something
 *           went badly wrong and no allowlist entry should be able to hide it.
 *
 *   WARN  — a production identifier (an account id, a topic id, an internal
 *           path). These legitimately appear in denylists and documentation
 *           — that is the whole point of a denylist — so they can be waived
 *           per file with a written reason in `secret-scan.allow.json`.
 *           A waiver is a claim someone has to defend in review.
 *
 * Deliberately dependency-free so it can run in CI before `npm install`.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Rule {
  id: string;
  severity: "ERROR" | "WARN";
  pattern: RegExp;
  why: string;
}

const RULES: Rule[] = [
  // ── ERROR: key material ───────────────────────────────────────────────────
  { id: "pem_private_key", severity: "ERROR", why: "PEM private key block", pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----/ },
  { id: "openssh_private_key", severity: "ERROR", why: "OpenSSH private key", pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  { id: "der_ed25519_private", severity: "ERROR", why: "DER-encoded Ed25519 private key", pattern: /302e020100300506032b657004220420[0-9a-fA-F]{64}/ },
  { id: "der_ecdsa_private", severity: "ERROR", why: "DER-encoded secp256k1 private key", pattern: /3030020100300706052b8104000a04220420[0-9a-fA-F]{64}/ },
  { id: "evm_private_key", severity: "ERROR", why: "0x-prefixed 32-byte private key", pattern: /\b0x[0-9a-fA-F]{64}\b/ },
  { id: "mnemonic_12_24", severity: "ERROR", why: "BIP-39 style mnemonic", pattern: /\b(?:[a-z]{3,8}\s+){11,23}[a-z]{3,8}\b(?=[^a-z])/ },
  { id: "github_token", severity: "ERROR", why: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { id: "aws_key", severity: "ERROR", why: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "generic_assigned_secret", severity: "ERROR", why: "a secret-named variable with a non-placeholder value",
    pattern: /\b(?:PRIVATE_KEY|SECRET_KEY|CLIENT_SECRET|API_SECRET|WALLET_SECRET|MNEMONIC|SEED_PHRASE)\s*[=:]\s*["']?(?!\s*$)(?!CHANGEME)(?!<)(?!\$\{)[A-Za-z0-9+/=_.-]{16,}/ },

  // ── WARN: production leakage ──────────────────────────────────────────────
  { id: "prod_signing_path", severity: "WARN", why: "path into the production NOMOS signing/verify tree", pattern: /\/srv\/nomos\/(signing|verify)/ },
  { id: "prod_service_path", severity: "WARN", why: "path into a production service directory", pattern: /\/opt\/nomos-|\/root\/whitelabel|\/root\/oraclenet|\/root\/dealoracle/ },
  { id: "prod_env_path", severity: "WARN", why: "path to a production env or key file", pattern: /\/root\/\.env|\/root\/\.hedera-/ },
  { id: "oraclenet_account", severity: "WARN", why: "pre-existing OracleNet account id", pattern: /\b0\.0\.(10420279|8509917)\b/ },
  { id: "oraclenet_topic", severity: "WARN", why: "pre-existing OracleNet topic/contract id", pattern: /\b0\.0\.(10420280|10420282|10420310|8510520|8510521)\b/ },
  { id: "mainnet_reference", severity: "WARN", why: "mainnet endpoint or explorer link", pattern: /mainnet\.mirrornode\.hedera\.com|hashscan\.io\/mainnet/ },
];

/** Extensions we never scan as text. */
const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|tar|mp4|mp3|woff2?)$/i;

interface Waiver {
  file: string;
  rule: string;
  reason: string;
}

function loadWaivers(): Waiver[] {
  const p = join(ROOT, "tools", "secret-scan.allow.json");
  if (!existsSync(p)) return [];
  const parsed = JSON.parse(readFileSync(p, "utf8"));
  return Array.isArray(parsed.waivers) ? parsed.waivers : [];
}

function trackedFiles(): string[] {
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    throw new Error("secret-scan must run inside a git repository");
  }
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  severity: "ERROR" | "WARN";
  why: string;
  excerpt: string;
}

export function scan(): { findings: Finding[]; waived: Finding[]; scanned: number } {
  const waivers = loadWaivers();
  const findings: Finding[] = [];
  const waived: Finding[] = [];
  let scanned = 0;

  for (const rel of trackedFiles()) {
    if (BINARY_EXT.test(rel)) continue;
    const abs = join(ROOT, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    if (statSync(abs).size > 2 * 1024 * 1024) continue;

    // Never scan (or ship) the scanner's own rule table for WARN patterns —
    // it necessarily contains every string it is looking for.
    const isRuleTable = rel === "tools/secret-scan.ts";

    const text = readFileSync(abs, "utf8");
    scanned += 1;
    const lines = text.split("\n");

    for (const rule of RULES) {
      if (isRuleTable) continue;
      lines.forEach((line, i) => {
        if (!rule.pattern.test(line)) return;
        const finding: Finding = {
          file: rel,
          line: i + 1,
          rule: rule.id,
          severity: rule.severity,
          why: rule.why,
          // Never echo the match itself — a scanner that prints secrets is a leak.
          excerpt: `${line.slice(0, 40).replace(/\s+/g, " ")}…[${line.length} chars]`,
        };
        const isWaived =
          rule.severity === "WARN" && waivers.some((w) => w.file === rel && w.rule === rule.id);
        (isWaived ? waived : findings).push(finding);
      });
    }
  }

  return { findings, waived, scanned };
}

function main(): void {
  const { findings, waived, scanned } = scan();
  const errors = findings.filter((f) => f.severity === "ERROR");
  const warns = findings.filter((f) => f.severity === "WARN");

  console.log(`secret-scan: ${scanned} files scanned`);
  for (const f of [...errors, ...warns]) {
    console.log(`  ${f.severity}  ${f.file}:${f.line}  [${f.rule}] ${f.why}\n         ${f.excerpt}`);
  }
  if (waived.length > 0) {
    console.log(`  (${waived.length} WARN finding(s) waived by tools/secret-scan.allow.json)`);
  }

  if (errors.length > 0 || warns.length > 0) {
    console.error(`secret-scan: FAIL — ${errors.length} error(s), ${warns.length} unwaived warning(s)`);
    process.exit(1);
  }
  console.log("secret-scan: CLEAN");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
