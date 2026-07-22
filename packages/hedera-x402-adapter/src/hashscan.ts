/**
 * HashScan and mirror-node link construction.
 *
 * Pure string building — no network access, fully unit-testable, and testnet by
 * construction. The links are *convenience for humans*; the cryptographic
 * bindings in the receipt are what actually prove anything. That ordering
 * matters: a demo that proves things by pointing at an explorer has proved
 * nothing a screenshot could not fake.
 */
import type { HashScanLinks } from "./interfaces.ts";

export const HASHSCAN_TESTNET = "https://hashscan.io/testnet";
export const MIRROR_TESTNET = "https://testnet.mirrornode.hedera.com/api/v1";

/**
 * HashScan's transaction path wants the id with `@` and `.` replaced by `-`.
 * `0.0.1234@1700000000.123456789` -> `0.0.1234-1700000000-123456789`
 */
export function hashscanTxSlug(transactionId: string): string {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(transactionId);
  if (!m) throw new Error(`MALFORMED_TRANSACTION_ID: ${transactionId}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function buildHashScanLinks(args: {
  transaction_id: string;
  account_id?: string;
  topic_id?: string;
  sequence_number?: number;
  hashscanBase?: string;
  mirrorBase?: string;
}): HashScanLinks {
  const hs = args.hashscanBase ?? HASHSCAN_TESTNET;
  const mirror = args.mirrorBase ?? MIRROR_TESTNET;
  const slug = hashscanTxSlug(args.transaction_id);
  const account = args.account_id ?? args.transaction_id.split("@")[0];

  const links: HashScanLinks = {
    transaction: `${hs}/transaction/${slug}`,
    account: `${hs}/account/${account}`,
    mirror_transaction: `${mirror}/transactions/${slug}`,
  };

  if (args.topic_id) {
    links.topic = `${hs}/topic/${args.topic_id}`;
    if (args.sequence_number !== undefined) {
      links.topic_message = `${hs}/topic/${args.topic_id}/message/${args.sequence_number}`;
      links.mirror_topic_message = `${mirror}/topics/${args.topic_id}/messages/${args.sequence_number}`;
    }
  }

  return links;
}
