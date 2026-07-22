/**
 * Memo-binding Hedera payment signer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  THIS IS THE ONLY FILE IN THE PROJECT THAT TOUCHES A PAYER PRIVATE KEY.
 *  It takes a key and payment requirements, and returns signed transaction
 *  bytes. It returns nothing else, logs nothing, and throws away the client it
 *  builds. It is intended to run in its own process (see
 *  `services/agent-client/src/signer-process.ts`), so the key never enters the
 *  agent's memory or an LLM context.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## Why this exists instead of `createClientHederaSigner`
 *
 * `@x402/hedera` ships a perfectly good default client signer. It builds the
 * TransferTransaction, sets the transaction id to the facilitator fee payer,
 * freezes and signs. What it does **not** do is set a transaction memo — the
 * scheme has no concept of one.
 *
 * Without a memo, the resulting on-chain artifact proves that *some* account
 * sent *some* amount to *our* account. It does not prove which request that
 * payment was for. Anyone watching the payee could point at the same
 * transaction and claim it paid for something else entirely.
 *
 * So this signer reproduces the default construction exactly — same transfer
 * pair, same fee-payer-owned transaction id, same freeze-then-sign order — and
 * adds one line: `setTransactionMemo(quoteId)`.
 *
 * That is safe with respect to facilitator verification. The facilitator
 * decodes the transaction and checks `hasNonTransferOperations`, which is
 * computed purely as `!(tx instanceof TransferTransaction)`; the memo is
 * transaction metadata, not an operation, so a memo-carrying TransferTransaction
 * is still a TransferTransaction. The facilitator's other checks — transfer
 * amounts, the payer signature over the frozen body, and the pre-settlement
 * balance preflight — are unaffected by a memo.
 *
 * The memo is capped at 100 bytes by the network. A quote id is 26 ASCII
 * characters, so there is ample headroom; the check below is there because a
 * silent truncation would break the binding it exists to create.
 */
import {
  AccountId,
  Hbar,
  PrivateKey,
  TokenId,
  TransactionId,
  TransferTransaction,
} from "@x402/hedera";
import { createHederaClient } from "@x402/hedera";

import { HBAR_ASSET_ID } from "./interfaces.ts";
export { HBAR_ASSET_ID };

/** Hedera's hard limit on a transaction memo. */
export const MEMO_MAX_BYTES = 100;

export type HederaKeyType = "ECDSA_SECP256K1" | "ED25519";

export class PaymentSignerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentSignerError";
    this.code = code;
  }
}

/** Parse a private key string according to its declared type. Never logs it. */
export function parsePayerKey(keyString: string, keyType: HederaKeyType): PrivateKey {
  if (!keyString || keyString.trim() === "") {
    throw new PaymentSignerError("KEY_MISSING", "no payer private key was provided");
  }
  try {
    return keyType === "ED25519"
      ? PrivateKey.fromStringED25519(keyString.trim())
      : PrivateKey.fromStringECDSA(keyString.trim());
  } catch {
    // Deliberately does not echo the input — an error message is a log line.
    throw new PaymentSignerError(
      "KEY_UNPARSABLE",
      `the payer key could not be parsed as ${keyType}; check NOMOS_GX402_PAYER_KEY_TYPE`,
    );
  }
}

export interface MemoBindingSignerOptions {
  accountId: string;
  privateKey: PrivateKey;
  network: string;
  /** The quote id. Goes into the transaction memo verbatim. */
  memo: string;
}

/**
 * Build a `ClientHederaSigner` whose transaction carries `memo`.
 *
 * Structurally compatible with `@x402/hedera`'s `ClientHederaSigner` type, so
 * it drops straight into `new ExactHederaScheme(signer)`.
 */
export function createMemoBindingHederaSigner(opts: MemoBindingSignerOptions): {
  accountId: string;
  createPartiallySignedTransferTransaction(requirements: any): Promise<string>;
} {
  const memoBytes = Buffer.byteLength(opts.memo, "utf8");
  if (memoBytes === 0 || memoBytes > MEMO_MAX_BYTES) {
    throw new PaymentSignerError(
      "MEMO_LENGTH",
      `memo must be 1..${MEMO_MAX_BYTES} bytes, got ${memoBytes} — a truncated memo is a broken binding`,
    );
  }
  if (opts.network !== "hedera:testnet") {
    throw new PaymentSignerError(
      "NETWORK_NOT_TESTNET",
      `this project signs on hedera:testnet only, got ${opts.network}`,
    );
  }

  const payer = AccountId.fromString(opts.accountId);

  return {
    accountId: payer.toString(),

    async createPartiallySignedTransferTransaction(requirements: any): Promise<string> {
      if (requirements.network !== "hedera:testnet") {
        throw new PaymentSignerError("NETWORK_NOT_TESTNET", `refusing to sign for ${requirements.network}`);
      }

      const feePayer = requirements.extra?.feePayer;
      if (typeof feePayer !== "string" || feePayer.trim() === "") {
        throw new PaymentSignerError(
          "FEE_PAYER_MISSING",
          "paymentRequirements.extra.feePayer is required — the facilitator pays the network fee",
        );
      }

      const amount = BigInt(requirements.amount);
      if (amount <= 0n) {
        throw new PaymentSignerError("AMOUNT_NOT_POSITIVE", "amount must be greater than zero");
      }

      const payTo = AccountId.fromString(requirements.payTo);

      const tx = new TransferTransaction();
      if (requirements.asset === HBAR_ASSET_ID) {
        tx.addHbarTransfer(payer, Hbar.fromTinybars((-amount).toString()));
        tx.addHbarTransfer(payTo, Hbar.fromTinybars(amount.toString()));
      } else {
        const tokenId = TokenId.fromString(requirements.asset);
        tx.addTokenTransfer(tokenId, payer, -amount);
        tx.addTokenTransfer(tokenId, payTo, amount);
      }

      // ── the one line that distinguishes this signer ───────────────────────
      tx.setTransactionMemo(opts.memo);

      // The transaction id belongs to the FEE PAYER, not to us: the facilitator
      // is the paying account for network fees, and the id must match the
      // account that submits. Consequence worth remembering when reading a
      // receipt: `hedera_transaction_id` starts with the facilitator's account,
      // while `payer` is the account actually debited.
      tx.setTransactionId(TransactionId.generate(AccountId.fromString(feePayer)));

      const client = createHederaClient(opts.network);
      try {
        tx.freezeWith(client);
        const signed = await tx.sign(opts.privateKey);
        return Buffer.from(signed.toBytes()).toString("base64");
      } finally {
        client.close();
      }
    },
  };
}
