/**
 * Minimal `.env` loader and demo configuration.
 *
 * Dependency-free (no dotenv) and deliberately narrow: it reads `KEY=value`
 * lines, ignores comments, and never expands or executes anything. The one
 * behaviour that matters is at the bottom — `describe()` returns a redacted
 * view suitable for printing into a report, and there is no code path that
 * returns a secret value in a printable structure.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DemoConfig {
  network: "hedera:testnet";
  mirrorUrl: string;
  hashscanBase: string;
  facilitatorUrl: string;
  port: number;
  payTo: string;
  payerAccountId: string;
  payerKeyPath: string;
  payerKeyType: "ECDSA_SECP256K1" | "ED25519";
  receiptSigningKeyPath: string;
  receiptSigningKid: string;
  maxAtomicPerPayment: string;
  maxAtomicCumulative: string;
  maxPaymentsPerUtcDay: number;
  quoteTtlSeconds: number;
  priceAtomic: string;
  resourceUrl: string;
}

/** Parse a `.env`-style file into a plain object. Values are never logged here. */
export function readEnvFile(path = ".env"): Record<string, string> {
  const abs = resolve(path);
  if (!existsSync(abs)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(abs, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(envPath = ".env"): DemoConfig {
  const file = readEnvFile(envPath);
  const get = (k: string, fallback?: string): string => {
    const v = process.env[k] ?? file[k] ?? fallback;
    if (v === undefined || v === "") throw new ConfigError(`missing configuration: ${k}`);
    return v;
  };

  const network = get("NOMOS_GX402_NETWORK", "hedera:testnet");
  if (network !== "hedera:testnet") {
    throw new ConfigError(`NOMOS_GX402_NETWORK must be hedera:testnet, got ${network}`);
  }

  const port = Number(get("NOMOS_GX402_PORT", "4402"));
  const resourceUrl = `http://127.0.0.1:${port}/v1/evidence`;

  return {
    network,
    mirrorUrl: get("NOMOS_GX402_MIRROR_URL", "https://testnet.mirrornode.hedera.com/api/v1"),
    hashscanBase: get("NOMOS_GX402_HASHSCAN_BASE", "https://hashscan.io/testnet"),
    facilitatorUrl: get("NOMOS_GX402_FACILITATOR_URL", "https://api.testnet.blocky402.com"),
    port,
    payTo: get("NOMOS_GX402_PAY_TO"),
    payerAccountId: get("NOMOS_GX402_PAYER_ACCOUNT_ID"),
    payerKeyPath: get("NOMOS_GX402_PAYER_KEY_PATH", ".local/hedera-payer.key"),
    payerKeyType: get("NOMOS_GX402_PAYER_KEY_TYPE", "ECDSA_SECP256K1") as DemoConfig["payerKeyType"],
    receiptSigningKeyPath: get("NOMOS_GX402_RECEIPT_SIGNING_KEY_PATH", ".local/receipt-signer.key"),
    receiptSigningKid: get("NOMOS_GX402_RECEIPT_SIGNING_KID", "nomos-gx402-demo-ed25519-1"),
    maxAtomicPerPayment: get("NOMOS_GX402_MAX_ATOMIC_PER_PAYMENT", "10000000"),
    maxAtomicCumulative: get("NOMOS_GX402_MAX_ATOMIC_CUMULATIVE", "200000000"),
    maxPaymentsPerUtcDay: Number(get("NOMOS_GX402_MAX_PAYMENTS_PER_UTC_DAY", "50")),
    quoteTtlSeconds: Number(get("NOMOS_GX402_QUOTE_TTL_SECONDS", "180")),
    priceAtomic: get("NOMOS_GX402_PRICE_ATOMIC", "5000000"),
    resourceUrl,
  };
}

/**
 * Redacted view for reports and logs.
 *
 * Key *paths* are shown because they are operational facts; key *contents* are
 * never read by this function, so there is nothing here that could leak even
 * if the result were printed by accident.
 */
export function describe(cfg: DemoConfig): Record<string, string | number> {
  return {
    network: cfg.network,
    mirrorUrl: cfg.mirrorUrl,
    facilitatorUrl: cfg.facilitatorUrl,
    port: cfg.port,
    payTo: cfg.payTo,
    payerAccountId: cfg.payerAccountId,
    payerKeyPath: `${cfg.payerKeyPath} (contents never read here)`,
    payerKeyType: cfg.payerKeyType,
    receiptSigningKid: cfg.receiptSigningKid,
    priceAtomic: cfg.priceAtomic,
    maxAtomicPerPayment: cfg.maxAtomicPerPayment,
    maxAtomicCumulative: cfg.maxAtomicCumulative,
    quoteTtlSeconds: cfg.quoteTtlSeconds,
  };
}
