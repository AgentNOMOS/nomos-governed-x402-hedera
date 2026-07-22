/**
 * The paid service itself: a deterministic synthetic evidence lookup.
 *
 * Why synthetic rather than a live data feed. The assessment that preceded this
 * repo found a working production evidence stack, and deliberately excluded it:
 * binding a public demo to a live internal service buys nothing a reviewer can
 * check, and costs a coupling that could leak production data or take the demo
 * down when the upstream changes. Determinism is worth more here than realism —
 * anyone can re-run this and get byte-identical results, which is exactly what
 * makes the result_hash in the receipt meaningful.
 *
 * The service is intentionally boring. The interesting part of this project is
 * everything wrapped around it.
 */
import { canonicalDigest } from "../../../packages/shared-schemas/src/index.ts";

export interface EvidenceRequest {
  subject: string;
  /** Which checks to run. Sorted before use so request order never changes the hash. */
  checks: string[];
}

export interface EvidenceResult {
  schema: "nomos.gx402.evidence_result.v1";
  subject: string;
  checks: Array<{ check: string; verdict: "PASS" | "FAIL" | "UNKNOWN"; basis: string }>;
  summary: { pass: number; fail: number; unknown: number };
  generated_from: "SYNTHETIC_DETERMINISTIC_FIXTURE";
}

const KNOWN_CHECKS: Record<string, { verdict: "PASS" | "FAIL" | "UNKNOWN"; basis: string }> = {
  has_agent_card: { verdict: "PASS", basis: "fixture: /.well-known/agent-card.json present" },
  declares_x402: { verdict: "PASS", basis: "fixture: x402 accepts[] advertised" },
  publishes_jwks: { verdict: "FAIL", basis: "fixture: no JWKS endpoint" },
  states_pricing: { verdict: "PASS", basis: "fixture: price and asset declared" },
  has_terms: { verdict: "UNKNOWN", basis: "fixture: terms document not machine-readable" },
};

export class EvidenceServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EvidenceServiceError";
    this.code = code;
  }
}

/** Validate the request shape. Invalid input must never reach a paid path. */
export function validateEvidenceRequest(body: unknown): EvidenceRequest {
  const b = body as Partial<EvidenceRequest> | null;
  if (!b || typeof b !== "object") throw new EvidenceServiceError("INVALID_BODY", "request body must be an object");
  if (typeof b.subject !== "string" || b.subject.length < 3 || b.subject.length > 128) {
    throw new EvidenceServiceError("INVALID_SUBJECT", "subject must be a string of 3..128 chars");
  }
  if (!Array.isArray(b.checks) || b.checks.length === 0 || b.checks.length > 16) {
    throw new EvidenceServiceError("INVALID_CHECKS", "checks must be a non-empty array of at most 16 entries");
  }
  for (const c of b.checks) {
    if (typeof c !== "string" || !/^[a-z0-9_]{3,48}$/.test(c)) {
      throw new EvidenceServiceError("INVALID_CHECK_NAME", `bad check name: ${String(c)}`);
    }
  }
  // Sorted + de-duplicated so two semantically identical requests hash identically.
  return { subject: b.subject, checks: [...new Set(b.checks)].sort() };
}

/** Canonical digest of the request. This is what the quote and receipt bind. */
export function hashEvidenceRequest(req: EvidenceRequest): string {
  return canonicalDigest(req);
}

/** Execute. Pure, deterministic, no I/O. */
export function executeEvidenceRequest(req: EvidenceRequest): EvidenceResult {
  const checks = req.checks.map((check) => {
    const known = KNOWN_CHECKS[check];
    return known
      ? { check, verdict: known.verdict, basis: known.basis }
      : { check, verdict: "UNKNOWN" as const, basis: "fixture: check not in the synthetic corpus" };
  });
  return {
    schema: "nomos.gx402.evidence_result.v1",
    subject: req.subject,
    checks,
    summary: {
      pass: checks.filter((c) => c.verdict === "PASS").length,
      fail: checks.filter((c) => c.verdict === "FAIL").length,
      unknown: checks.filter((c) => c.verdict === "UNKNOWN").length,
    },
    generated_from: "SYNTHETIC_DETERMINISTIC_FIXTURE",
  };
}

/** Canonical digest of the delivered result — the receipt's `result_hash`. */
export function hashEvidenceResult(result: EvidenceResult): string {
  return canonicalDigest(result);
}
