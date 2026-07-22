/**
 * Time handling.
 *
 * Two rules, both learned the hard way elsewhere in this codebase's lineage:
 *
 *   1. Every timestamp that is written into a signed record is UTC, second
 *      precision, `YYYY-MM-DDTHH:MM:SSZ`. Sub-second precision and offsets are
 *      two more ways for two honest implementations to disagree about a hash.
 *
 *   2. Expiry is decided by the *server's* clock, never by a timestamp the
 *      caller supplied. A caller-controlled clock is a caller-controlled TTL.
 */

/** A pluggable clock so tests never depend on wall time. */
export interface Clock {
  nowMs(): number;
}

export const systemClock: Clock = { nowMs: () => Date.now() };

/** Fixed clock for deterministic tests and fixtures. */
export function fixedClock(isoOrMs: string | number): Clock {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(isoOrMs);
  if (!Number.isFinite(ms)) throw new Error(`fixedClock: unparsable time ${String(isoOrMs)}`);
  return { nowMs: () => ms };
}

/** UTC, second precision, Z-suffixed. The only timestamp format we emit. */
export function toIso(ms: number): string {
  if (!Number.isFinite(ms)) throw new Error("toIso: non-finite timestamp");
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Parse one of our timestamps back to epoch ms. Throws on anything else. */
export function fromIso(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso)) {
    throw new Error(`fromIso: expected YYYY-MM-DDTHH:MM:SSZ, got ${iso}`);
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`fromIso: unparsable ${iso}`);
  return ms;
}

/** `YYYY-MM-DD` in UTC — the bucket key for per-UTC-day caps. */
export function utcDayKey(ms: number): string {
  return toIso(ms).slice(0, 10);
}
