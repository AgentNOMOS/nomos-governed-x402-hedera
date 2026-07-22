/**
 * Hedera x402 adapter — interface surface (CP-H1).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  STATUS: interfaces + offline mock only. NO Hedera SDK is imported here yet,
 *  no key is read, no socket is opened, no transaction exists. The real
 *  implementation lands in CP-H2 behind exactly these signatures.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Key custody rule, enforced by the shape of these types rather than by
 * documentation alone:
 *
 *   `PaymentSigner` is the ONLY thing in this project that can touch a payer
 *   private key. It takes bytes and returns bytes. It never receives the agent's
 *   context, never returns the key, and nothing else in the interface graph has
 *   a field where a key could be passed. Swapping it for an HSM, a KMS or the
 *   Hiero CLI is a one-line change with no ripple.
 *
 * Protocol facts this surface is modelled on (verified 2026-07-22 from the
 * Hedera-linked reference project and the npm registry — see
 * docs/architecture/REFERENCE_NOTES.md; no code was copied):
 *   - package `@x402/hedera` (npm 2.19.0) implements the Hedera `exact` scheme
 *   - network id string is `hedera:testnet`, NOT a CAIP-2 `eip155:*` value
 *   - 402 carries a `payment-required` header; the retry carries
 *     `payment-signature`; the outcome comes back in `payment-response`
 *     (base64 JSON) whose `transaction` field holds the Hedera transaction id
 *   - a facilitator acts as fee payer, so the resource server holds no key
 */

export type Network = "hedera:testnet";
export type Asset = string; // "HBAR" or an HTS token id

export interface Quote {
  quote_id: string;
  quote_hash: string;
  request_hash: string;
  idempotency_key: string;
  decision_id: string;
  offer_id: string;
  resource_url: string;
  http_method: string;
  network: Network;
  asset: Asset;
  atomic_amount: string;
  pay_to: string;
  issued_at: string;
  expires_at: string;
  max_timeout_seconds: number;
}

export interface PaymentChallenge {
  schema: string;
  x402_version: number;
  accepts: Array<{
    scheme: "exact";
    network: Network;
    asset: Asset;
    atomic_amount: string;
    pay_to: string;
    max_timeout_seconds: number;
    resource: string;
    memo?: string;
  }>;
  nomos: {
    quote_id: string;
    quote_hash: string;
    request_hash: string;
    idempotency_key: string;
    issued_at: string;
    expires_at: string;
    decision_id: string;
  };
}

/**
 * Opaque, transport-level payment payload.
 *
 * Modelled on the reference flow's `payment-signature` header value: an opaque
 * string the client obtained from a signer and echoes back. Keeping it opaque
 * means the resource server cannot accidentally introspect key material.
 */
export interface SignedPaymentPayload {
  /** Value for the `payment-signature` request header. */
  payment_signature: string;
  /** Non-secret: which account the signature commits. */
  payer_account_id: string;
  /** Scheme identifier, for forward compatibility with future x402 schemes. */
  scheme: "exact";
  network: Network;
}

/**
 * The ONLY key-bearing interface in the project.
 *
 * Implementations must be process-isolated from the agent: the reference flow
 * runs signing in a separate script whose stdin is the challenge and whose
 * stdout is the signature, precisely so the key never enters an LLM context.
 */
export interface PaymentSigner {
  readonly payerAccountId: string;
  /** @param challengeHeader the raw `payment-required` header value from the 402 */
  signPaymentPayload(challengeHeader: string): Promise<SignedPaymentPayload>;
}

export interface VerifyResult {
  valid: boolean;
  /** Reason codes, never free-form messages, so callers can branch safely. */
  reasons: string[];
  payer_account_id?: string;
}

export interface SettleResult {
  settled: boolean;
  transaction_id?: string;
  consensus_timestamp?: string;
  reasons: string[];
}

export interface MirrorSettlementQuery {
  transaction_id: string;
  expected_network: Network;
  expected_asset: Asset;
  expected_atomic_amount: string;
  expected_payee: string;
  /** The quote id that MUST appear in the transaction memo. */
  expected_memo: string;
}

export interface HashScanLinks {
  transaction: string;
  account: string;
  topic?: string;
  topic_message?: string;
  mirror_transaction: string;
  mirror_topic_message?: string;
}

/**
 * The full adapter contract.
 *
 * `verifyPayment` and `settlePayment` are separate on purpose. The reference
 * implementation settles *after* the handler returns, and documents the
 * resulting hole itself: "a verify-pass / settle-fail means data was delivered
 * without payment landing". This project does not accept that trade — see
 * `docs/PROTOCOL_FLOW.md`, delivery is gated on settlement being FINAL.
 */
export interface HederaX402Adapter {
  createPaymentChallenge(quote: Quote): PaymentChallenge;
  verifyPayment(payload: SignedPaymentPayload, quote: Quote): Promise<VerifyResult>;
  settlePayment(payload: SignedPaymentPayload, quote: Quote): Promise<SettleResult>;
  verifySettlementViaMirrorNode(query: MirrorSettlementQuery): Promise<import("./types.ts").SettlementEvidenceLike>;
  buildHashScanLinks(args: {
    transaction_id: string;
    account_id?: string;
    topic_id?: string;
    sequence_number?: number;
  }): HashScanLinks;
}
