/**
 * HTTP 402 payment challenge construction.
 *
 * This is real, shipping logic — not a mock. It runs offline because building a
 * challenge requires no chain access, only the quote the policy engine already
 * approved.
 *
 * The one non-obvious field is `memo`. x402 does not require it, but without it
 * there is no on-chain link between a transfer and the request it paid for: a
 * verifier could confirm "someone sent 0.05 HBAR to this account" and nothing
 * more. Putting `quote_id` in the transaction memo is what turns a payment into
 * a payment *for something*, and it is the field the mirror-node verifier reads
 * back in CP-H2.
 */
import {
  canonicalDigest,
  assertValid,
  toIso,
  type Clock,
  systemClock,
  PAYMENT_CHALLENGE_SCHEMA,
  SCHEMA_VERSION,
  quoteId as makeQuoteId,
  idempotencyKey as makeIdempotencyKey,
} from "../../shared-schemas/src/index.ts";
import type { PaymentChallenge, Quote } from "./interfaces.ts";

export const X402_VERSION = 2;

export interface QuoteInput {
  offer: {
    offer_id: string;
    service: { resource_url: string; http_method: string };
    network: "hedera:testnet";
    asset: string;
    atomic_amount: string;
    pay_to: string;
    quote_ttl_seconds: number;
  };
  request_hash: string;
  nonce: string;
  payer_account_id: string;
  decision_id: string;
  clock?: Clock;
}

/** Derive a fully-bound quote. Deterministic: same inputs, same quote_id. */
export function issueQuote(input: QuoteInput): Quote {
  const nowMs = (input.clock ?? systemClock).nowMs();
  const issued_at = toIso(nowMs);
  const expires_at = toIso(nowMs + input.offer.quote_ttl_seconds * 1000);

  const quote_id = makeQuoteId(input.offer.offer_id, input.request_hash, input.nonce, issued_at);
  const idempotency_key = makeIdempotencyKey(quote_id, input.request_hash, input.payer_account_id);

  const core = {
    offer_id: input.offer.offer_id,
    resource_url: input.offer.service.resource_url,
    http_method: input.offer.service.http_method,
    network: input.offer.network,
    asset: input.offer.asset,
    atomic_amount: input.offer.atomic_amount,
    pay_to: input.offer.pay_to,
    request_hash: input.request_hash,
    quote_id,
    issued_at,
    expires_at,
  };

  return {
    ...core,
    quote_hash: canonicalDigest(core),
    idempotency_key,
    decision_id: input.decision_id,
    max_timeout_seconds: input.offer.quote_ttl_seconds,
  };
}

/** Build the 402 body. Pure function of the quote. */
export function createPaymentChallenge(quote: Quote): PaymentChallenge {
  const challenge: PaymentChallenge = {
    schema: `nomos.gx402.payment_challenge.${SCHEMA_VERSION}`,
    x402_version: X402_VERSION,
    accepts: [
      {
        scheme: "exact",
        network: quote.network,
        asset: quote.asset,
        atomic_amount: quote.atomic_amount,
        pay_to: quote.pay_to,
        max_timeout_seconds: quote.max_timeout_seconds,
        resource: quote.resource_url,
        memo: quote.quote_id,
      },
    ],
    nomos: {
      quote_id: quote.quote_id,
      quote_hash: quote.quote_hash,
      request_hash: quote.request_hash,
      idempotency_key: quote.idempotency_key,
      issued_at: quote.issued_at,
      expires_at: quote.expires_at,
      decision_id: quote.decision_id,
    },
  };
  assertValid(challenge, PAYMENT_CHALLENGE_SCHEMA);
  return challenge;
}

export type QuoteExpiryVerdict = { expired: boolean; reason: string };

/**
 * Expiry is decided against the SERVER clock and the quote's own `expires_at`.
 * A client-supplied "now" is a client-supplied TTL.
 */
export function checkQuoteExpiry(quote: Quote, clock: Clock = systemClock): QuoteExpiryVerdict {
  const now = clock.nowMs();
  const exp = Date.parse(quote.expires_at);
  if (!Number.isFinite(exp)) return { expired: true, reason: "QUOTE_EXPIRY_UNPARSABLE" };
  return now > exp
    ? { expired: true, reason: "QUOTE_EXPIRED" }
    : { expired: false, reason: "QUOTE_FRESH" };
}
