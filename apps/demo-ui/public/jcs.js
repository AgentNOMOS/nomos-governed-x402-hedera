/**
 * RFC 8785 (JCS) canonicalization, browser edition.
 *
 * A faithful port of `packages/shared-schemas/src/canonical.ts`, including both
 * of its deliberate restrictions: non-integer numbers are rejected, and
 * undefined / NaN / Infinity are rejected rather than silently dropped.
 *
 * The port exists so the page can *recompute* the receipt's record digest in
 * the visitor's own browser instead of asking them to believe a printed string.
 * `tests/unit/demo-ui-page.test.ts` runs this file against the real receipt and
 * asserts it agrees with the Node implementation byte for byte — a divergence
 * here would turn an honest check into a decorative one, so it fails the build.
 *
 * This file hashes. It cannot sign, and it cannot create a receipt.
 */
(function (root) {
  "use strict";

  function CanonicalizationError(code, path, message) {
    var e = new Error(code + " at " + (path || "$") + ": " + message);
    e.name = "CanonicalizationError";
    e.code = code;
    return e;
  }

  function serialize(value, path) {
    if (value === null) return "null";

    var t = typeof value;

    if (t === "boolean") return value ? "true" : "false";

    if (t === "number") {
      if (!isFinite(value)) {
        throw CanonicalizationError("NON_FINITE_NUMBER", path, "NaN and Infinity have no JSON representation");
      }
      if (!Number.isInteger(value)) {
        throw CanonicalizationError("NON_INTEGER_NUMBER", path, "fractional numbers are rejected by this profile");
      }
      if (!Number.isSafeInteger(value)) {
        throw CanonicalizationError("UNSAFE_INTEGER", path, "integer exceeds Number.MAX_SAFE_INTEGER");
      }
      return String(value);
    }

    if (t === "string") return JSON.stringify(value);

    if (Array.isArray(value)) {
      var items = value.map(function (v, i) {
        return serialize(v, path + "[" + i + "]");
      });
      return "[" + items.join(",") + "]";
    }

    if (t === "object") {
      // JCS sorts by UTF-16 code unit, which is exactly what the default
      // Array#sort on strings does. A custom comparator would risk locale.
      var keys = Object.keys(value).sort();
      var parts = [];
      for (var i = 0; i < keys.length; i += 1) {
        var k = keys[i];
        var child = value[k];
        if (child === undefined) {
          throw CanonicalizationError("UNDEFINED_VALUE", path + "." + k, "undefined is not canonicalizable");
        }
        parts.push(JSON.stringify(k) + ":" + serialize(child, path + "." + k));
      }
      return "{" + parts.join(",") + "}";
    }

    throw CanonicalizationError("UNSUPPORTED_TYPE", path, "values of type " + t + " cannot be canonicalized");
  }

  /** Canonical UTF-8 string of `value`. */
  function canonicalString(value) {
    if (value === undefined) {
      throw CanonicalizationError("UNDEFINED_VALUE", "$", "undefined is not canonicalizable");
    }
    return serialize(value, "");
  }

  function toHex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  /**
   * `sha256:<hex>` over the canonical form of `value`.
   *
   * Rejects rather than degrades: without WebCrypto there is no digest, and a
   * page that cannot compute one must say so instead of showing a tick.
   */
  async function canonicalDigest(value) {
    var subtle = root.crypto && root.crypto.subtle;
    if (!subtle || typeof subtle.digest !== "function") {
      throw CanonicalizationError("NO_WEBCRYPTO", "$", "crypto.subtle is unavailable in this context");
    }
    var bytes = new TextEncoder().encode(canonicalString(value));
    var digest = await subtle.digest("SHA-256", bytes);
    return "sha256:" + toHex(digest);
  }

  /** Truncated-hash id, matching `packages/shared-schemas/src/ids.ts`. */
  async function taggedId(prefix, parts, hexLen) {
    var digest = await canonicalDigest(parts);
    return prefix + digest.slice("sha256:".length, "sha256:".length + hexLen);
  }

  root.NOMOS_JCS = {
    canonicalString: canonicalString,
    canonicalDigest: canonicalDigest,
    receiptId: function (idemKey, transactionId, recordDigest) {
      return taggedId("poa_", [idemKey, transactionId, recordDigest], 24);
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
