/**
 * Hedera mirror-node client — the independent settlement verifier.
 *
 * This is the component that makes the receipt worth anything. The facilitator
 * tells us a settlement succeeded; the mirror node lets us check that claim
 * against the public record, which is a different thing entirely. A facilitator's
 * word is not independent evidence about the facilitator.
 *
 * Read-only: GET requests to the public testnet mirror node, nothing else. No
 * key, no signature, no submission.
 *
 * Two behaviours worth knowing about:
 *
 *   PROPAGATION. Hedera reaches consensus in seconds, but the mirror node is an
 *   asynchronous index of that consensus. Querying immediately after settlement
 *   routinely 404s on a transaction that absolutely exists. Treating that as
 *   "payment not found" would be wrong, so lookup retries on a bounded schedule
 *   and reports PENDING rather than FAILED when it runs out — and PENDING never
 *   releases work.
 *
 *   MEMO ENCODING. The mirror node returns `memo_base64`, not the memo. Decoding
 *   it is the last step of the on-chain binding: this is where we learn whether
 *   the transaction that moved the money names the quote it paid for.
 */

export const MIRROR_TESTNET_BASE = "https://testnet.mirrornode.hedera.com/api/v1";

export class MirrorNodeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MirrorNodeError";
    this.code = code;
  }
}

/** `0.0.1234@1700000000.000000001` → `0.0.1234-1700000000-000000001` */
export function toMirrorTxId(transactionId: string): string {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(transactionId);
  if (!m) throw new MirrorNodeError("MALFORMED_TRANSACTION_ID", `cannot convert ${transactionId}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export interface MirrorTransfer {
  account: string;
  amount: number;
}

export interface MirrorTransaction {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  name: string;
  charged_tx_fee: number;
  memo_base64: string | null;
  transfers: MirrorTransfer[];
  token_transfers?: Array<{ token_id: string; account: string; amount: number }>;
}

async function getJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: "application/json" } });
    if (res.status === 404) throw new MirrorNodeError("NOT_FOUND", `404 for ${url}`);
    if (!res.ok) throw new MirrorNodeError("HTTP_ERROR", `${res.status} for ${url}`);
    return await res.json();
  } catch (e) {
    if (e instanceof MirrorNodeError) throw e;
    if ((e as Error).name === "AbortError") throw new MirrorNodeError("TIMEOUT", `timeout for ${url}`);
    throw new MirrorNodeError("NETWORK", `${(e as Error).message} for ${url}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface MirrorLookupOptions {
  baseUrl?: string;
  /** Total attempts including the first. */
  attempts?: number;
  /** Delay between attempts, ms. */
  delayMs?: number;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch a transaction, retrying while the mirror node has not caught up.
 *
 * Returns `null` — not an error — when the transaction is still not indexed
 * after the retry budget. The caller must map that to PENDING, never to FAILED
 * and never to "verified".
 */
export async function fetchTransaction(
  transactionId: string,
  opts: MirrorLookupOptions = {},
): Promise<MirrorTransaction | null> {
  const base = opts.baseUrl ?? MIRROR_TESTNET_BASE;
  const attempts = opts.attempts ?? 12;
  const delayMs = opts.delayMs ?? 1500;
  const sleep = opts.sleep ?? defaultSleep;
  const url = `${base}/transactions/${toMirrorTxId(transactionId)}`;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const body = (await getJson(url)) as { transactions?: MirrorTransaction[] };
      const tx = body.transactions?.[0];
      if (tx) return tx;
    } catch (e) {
      // NOT_FOUND is the expected state while the index catches up. Anything
      // else is a real problem and should surface immediately rather than be
      // buried under eleven more retries.
      if (!(e instanceof MirrorNodeError) || e.code !== "NOT_FOUND") throw e;
    }
    if (i < attempts - 1) await sleep(delayMs);
  }
  return null;
}

export interface MirrorAccount {
  account: string;
  balance: { balance: number; timestamp: string };
  deleted: boolean;
  evm_address: string | null;
  key: { _type: string; key: string } | null;
}

/** Account lookup. Returns null when the account does not exist. */
export async function fetchAccount(
  accountIdOrEvmAddress: string,
  baseUrl: string = MIRROR_TESTNET_BASE,
): Promise<MirrorAccount | null> {
  try {
    return (await getJson(`${baseUrl}/accounts/${accountIdOrEvmAddress}`)) as MirrorAccount;
  } catch (e) {
    if (e instanceof MirrorNodeError && e.code === "NOT_FOUND") return null;
    throw e;
  }
}

/** Decode `memo_base64`. Returns null when the transaction carried no memo. */
export function decodeMemo(tx: MirrorTransaction): string | null {
  if (!tx.memo_base64) return null;
  const decoded = Buffer.from(tx.memo_base64, "base64").toString("utf8");
  return decoded.length === 0 ? null : decoded;
}

/**
 * Net HBAR movement for an account within a transaction, in tinybars.
 *
 * Summed rather than taken from the first matching entry: a single transaction
 * may credit or debit the same account more than once, and reading only the
 * first row is how an amount check gets quietly fooled.
 */
export function netHbarForAccount(tx: MirrorTransaction, accountId: string): bigint {
  return (tx.transfers ?? [])
    .filter((t) => t.account === accountId)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
}

/** Net movement of an HTS token for an account, in the token's smallest units. */
export function netTokenForAccount(tx: MirrorTransaction, tokenId: string, accountId: string): bigint {
  return (tx.token_transfers ?? [])
    .filter((t) => t.token_id === tokenId && t.account === accountId)
    .reduce((sum, t) => sum + BigInt(t.amount), 0n);
}
