/**
 * Deterministic JSON canonicalization + SHA-256 hashing.
 *
 * Profile: RFC 8785 (JCS), with two deliberate *restrictions* that make the
 * profile strictly narrower — and therefore safer — than plain JCS:
 *
 *   R1  NON-INTEGER NUMBERS ARE REJECTED.
 *       JCS defines a serialization for IEEE-754 doubles, but a monetary
 *       amount that survives a float round-trip is a bug waiting to be
 *       exploited. Atomic amounts in this project are always integers or
 *       decimal strings. Anything with a fractional part fails closed.
 *
 *   R2  `undefined`, functions, symbols, NaN and +/-Infinity are rejected
 *       rather than silently dropped or coerced. A field that cannot be
 *       canonicalized must never be quietly excluded from a signature.
 *
 * Everything else follows JCS: object keys sorted by UTF-16 code unit,
 * no insignificant whitespace, minimal string escaping, UTF-8 output.
 *
 * Rationale for R1/R2: a hash is only a binding if *every* semantic difference
 * changes it and *no* representation difference does. Dropping a key or
 * rounding a number breaks the first half of that sentence.
 */
import { createHash } from "node:crypto";

export class CanonicalizationError extends Error {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string, message: string) {
    super(`${code} at ${path || "$"}: ${message}`);
    this.name = "CanonicalizationError";
    this.code = code;
    this.path = path;
  }
}

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | CanonicalValue[]
  | { [k: string]: CanonicalValue };

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";

  const t = typeof value;

  if (t === "boolean") return value ? "true" : "false";

  if (t === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new CanonicalizationError(
        "NON_FINITE_NUMBER",
        path,
        `NaN and Infinity have no JSON representation (got ${String(n)})`,
      );
    }
    if (!Number.isInteger(n)) {
      throw new CanonicalizationError(
        "NON_INTEGER_NUMBER",
        path,
        `fractional numbers are rejected by this profile (got ${String(n)}); ` +
          `use an integer of atomic units or a decimal string`,
      );
    }
    if (!Number.isSafeInteger(n)) {
      throw new CanonicalizationError(
        "UNSAFE_INTEGER",
        path,
        `integer exceeds Number.MAX_SAFE_INTEGER and cannot round-trip ` +
          `(got ${String(n)}); use a decimal string`,
      );
    }
    // Safe integers serialize identically under ES6 Number::toString and JCS.
    return String(n);
  }

  if (t === "string") {
    // JSON.stringify produces JCS-conformant minimal escaping for strings.
    return JSON.stringify(value as string);
  }

  if (Array.isArray(value)) {
    const parts = value.map((v, i) => serialize(v, `${path}[${i}]`));
    return `[${parts.join(",")}]`;
  }

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    // JCS: sort by UTF-16 code unit. Default Array#sort on strings does exactly
    // that, so no custom comparator is needed (and adding one would risk
    // introducing a locale-sensitive comparison).
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const child = obj[k];
      if (child === undefined) {
        throw new CanonicalizationError(
          "UNDEFINED_VALUE",
          `${path}.${k}`,
          "undefined is not canonicalizable; omit the key or use null explicitly",
        );
      }
      parts.push(`${JSON.stringify(k)}:${serialize(child, `${path}.${k}`)}`);
    }
    return `{${parts.join(",")}}`;
  }

  throw new CanonicalizationError(
    "UNSUPPORTED_TYPE",
    path,
    `values of type ${t} cannot be canonicalized`,
  );
}

/** Canonical UTF-8 bytes of `value`. Throws on anything non-canonicalizable. */
export function canonicalize(value: unknown): Buffer {
  if (value === undefined) {
    throw new CanonicalizationError(
      "UNDEFINED_VALUE",
      "$",
      "undefined is not canonicalizable",
    );
  }
  return Buffer.from(serialize(value, ""), "utf8");
}

/** Canonical UTF-8 *string* of `value`. Useful for debugging and fixtures. */
export function canonicalString(value: unknown): string {
  return canonicalize(value).toString("utf8");
}

/** Lowercase hex SHA-256 of arbitrary bytes. */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `sha256:<hex>` over the canonical form of `value`. The project's only digest format. */
export function canonicalDigest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalize(value))}`;
}

/** True iff `s` is a well-formed digest produced by {@link canonicalDigest}. */
export function isDigest(s: unknown): s is string {
  return typeof s === "string" && /^sha256:[0-9a-f]{64}$/.test(s);
}

/**
 * Domain-separated signing input: `<domain>` || 0x00 || canonical(record).
 *
 * The NUL byte cannot occur inside a domain label, so no record can ever be
 * reinterpreted under a different domain — a signature over a prepayment
 * decision can never be replayed as a proof-of-action receipt.
 */
export function signingInput(domain: string, record: unknown): Buffer {
  if (!domain || /\0/.test(domain)) {
    throw new CanonicalizationError(
      "BAD_DOMAIN",
      "$",
      "signature domain must be non-empty and NUL-free",
    );
  }
  return Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0x00]),
    canonicalize(record),
  ]);
}

/**
 * Digest of a record with the fields that *carry* the digest removed, so the
 * digest can be embedded in the object it describes without self-reference.
 */
export function digestExcluding(record: Record<string, unknown>, exclude: readonly string[]): string {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!exclude.includes(k)) body[k] = v;
  }
  return canonicalDigest(body);
}
