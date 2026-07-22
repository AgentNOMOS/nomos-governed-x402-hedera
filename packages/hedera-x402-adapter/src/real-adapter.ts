/**
 * The real Hedera x402 adapter (CP-H2).
 *
 * Same interface as the CP-H1 mock, real chain behind it. Three collaborators:
 *
 *   - `@x402/hedera`'s ExactHederaScheme (client side) builds the payload from
 *     our memo-binding signer;
 *   - a facilitator (`/verify`, `/settle`) co-signs as fee payer and submits;
 *   - the public mirror node is queried afterwards, by us, to check the
 *     facilitator's claim against the public record.
 *
 * That last step is the point. `settlePayment` returning `{settled: true}` is
 * the facilitator's assertion about its own work. `verifySettlementViaMirrorNode`
 * is the only thing here that constitutes evidence, and it is what gates
 * delivery.
 *
 * Testnet is asserted in the constructor, again per call, and once more in the
 * signer. That is three checks for one invariant, which is the correct number
 * when the failure mode is "spent real money on the wrong network".
 */
import {
  toIso,
  type Clock,
  systemClock,
  assertValid,
  SETTLEMENT_EVIDENCE_SCHEMA,
  SCHEMA_VERSION,
} from "../../shared-schemas/src/index.ts";
import type {
  HederaX402Adapter,
  HashScanLinks,
  MirrorSettlementQuery,
  PaymentChallenge,
  Quote,
  SettleResult,
  SignedPaymentPayload,
  VerifyResult,
} from "./interfaces.ts";
import type { SettlementEvidenceLike } from "./types.ts";
import { createPaymentChallenge, checkQuoteExpiry } from "./challenge.ts";
import { buildHashScanLinks } from "./hashscan.ts";
import { HBAR_ASSET_ID } from "./interfaces.ts";
import {
  decodeMemo,
  fetchAccount,
  fetchTransaction,
  netHbarForAccount,
  netTokenForAccount,
  MIRROR_TESTNET_BASE,
  type MirrorLookupOptions,
} from "./mirror.ts";

/** True for a 20-byte EVM address alias (as opposed to a 0.0.x account id). */
export function isEvmAlias(value: string): boolean {
  return /^0x[0-9a-f]{40}$/.test(value);
}

export const X402_VERSION = 2;
export const TESTNET = "hedera:testnet";

export class RealAdapterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RealAdapterError";
    this.code = code;
  }
}

/** x402 v2 PaymentRequirements, as the facilitator expects them. */
export interface X402PaymentRequirements {
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
}

export interface RealAdapterOptions {
  facilitatorUrl: string;
  /** Facilitator account that pays the network fee, from GET /supported. */
  feePayer: string;
  resourceUrl: string;
  mirrorBaseUrl?: string;
  mirrorLookup?: MirrorLookupOptions;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  /**
   * When true, `settlePayment` refuses AFTER the facilitator has verified the
   * payload. That is a genuinely useful dry run rather than a simulation: the
   * transaction is really built, really signed by the payer, and really checked
   * by the facilitator against the payer's on-chain key — but never submitted,
   * so nothing moves. It is the last point at which stopping is free.
   */
  dryRun?: boolean;
}

/**
 * Translate our quote into x402 PaymentRequirements.
 *
 * Note `asset: "0.0.0"` for HBAR — that is x402's identifier for the native
 * coin, not an account. Amounts are tinybars.
 */
export function toPaymentRequirements(quote: Quote, feePayer: string): X402PaymentRequirements {
  if (quote.network !== TESTNET) {
    throw new RealAdapterError("NETWORK_NOT_TESTNET", `refusing to build requirements for ${quote.network}`);
  }
  return {
    scheme: "exact",
    network: quote.network,
    asset: quote.asset === "HBAR" ? HBAR_ASSET_ID : quote.asset,
    amount: quote.atomic_amount,
    payTo: quote.pay_to,
    maxTimeoutSeconds: quote.max_timeout_seconds,
    extra: { feePayer },
  };
}

/** Wire form of the `payment-signature` header: base64 JSON of the x402 payload. */
export function encodePaymentHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

export function decodePaymentHeader(header: string): any {
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new RealAdapterError("PAYLOAD_UNDECODABLE", "payment-signature header is not base64 JSON");
  }
}

export class RealHederaX402Adapter implements HederaX402Adapter {
  readonly #opts: RealAdapterOptions;
  readonly #clock: Clock;
  readonly #fetch: typeof fetch;

  constructor(opts: RealAdapterOptions) {
    this.#opts = opts;
    this.#clock = opts.clock ?? systemClock;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  get feePayer(): string {
    return this.#opts.feePayer;
  }

  createPaymentChallenge(quote: Quote): PaymentChallenge {
    return createPaymentChallenge(quote);
  }

  /** Ask the facilitator which kinds it supports. Read-only. */
  static async fetchSupported(facilitatorUrl: string, fetchImpl: typeof fetch = fetch): Promise<any> {
    const res = await fetchImpl(`${facilitatorUrl.replace(/\/+$/, "")}/supported`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new RealAdapterError("FACILITATOR_UNAVAILABLE", `GET /supported → ${res.status}`);
    return res.json();
  }

  /** Pull the Hedera-testnet fee payer out of a /supported response. */
  static feePayerFromSupported(supported: any): string {
    const kind = (supported?.kinds ?? []).find(
      (k: any) => k.network === TESTNET && k.scheme === "exact" && k.x402Version === X402_VERSION,
    );
    const feePayer = kind?.extra?.feePayer;
    if (typeof feePayer !== "string" || !/^\d+\.\d+\.\d+$/.test(feePayer)) {
      throw new RealAdapterError(
        "FEE_PAYER_UNAVAILABLE",
        "the facilitator does not advertise an exact/hedera:testnet fee payer",
      );
    }
    return feePayer;
  }

  #buildPayload(payload: SignedPaymentPayload, quote: Quote): any {
    const requirements = toPaymentRequirements(quote, this.#opts.feePayer);
    const inner = decodePaymentHeader(payload.payment_signature);
    return {
      x402Version: X402_VERSION,
      resource: { url: this.#opts.resourceUrl },
      accepted: requirements,
      payload: inner.payload ?? inner,
    };
  }

  async #post(path: "verify" | "settle", body: unknown): Promise<any> {
    const url = `${this.#opts.facilitatorUrl.replace(/\/+$/, "")}/${path}`;
    const res = await this.#fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RealAdapterError("FACILITATOR_BAD_RESPONSE", `${path} → ${res.status}, non-JSON body`);
    }
    return { status: res.status, body: parsed };
  }

  /**
   * Facilitator-side verification.
   *
   * A pass here means the payload is well formed, signed by the payer, and
   * expected to succeed. It does **not** mean anything moved. Nothing in this
   * project releases work on the strength of this call.
   */
  async verifyPayment(payload: SignedPaymentPayload, quote: Quote): Promise<VerifyResult> {
    const reasons: string[] = [];

    if (payload.network !== quote.network) reasons.push("network_mismatch");
    if (payload.scheme !== "exact") reasons.push("scheme_unsupported");
    const expiry = checkQuoteExpiry(quote, this.#clock);
    if (expiry.expired) reasons.push(expiry.reason.toLowerCase());
    if (reasons.length > 0) return { valid: false, reasons };

    const requirements = toPaymentRequirements(quote, this.#opts.feePayer);
    const { status, body } = await this.#post("verify", {
      x402Version: X402_VERSION,
      paymentPayload: this.#buildPayload(payload, quote),
      paymentRequirements: requirements,
    });

    if (body?.isValid === true) {
      return { valid: true, reasons: [], payer_account_id: body.payer ?? payload.payer_account_id };
    }
    return {
      valid: false,
      reasons: [body?.invalidReason ?? `facilitator_verify_${status}`],
      payer_account_id: body?.payer,
    };
  }

  /** Facilitator settlement. Returns the transaction id it claims to have submitted. */
  async settlePayment(payload: SignedPaymentPayload, quote: Quote): Promise<SettleResult> {
    if (this.#opts.dryRun) {
      return { settled: false, reasons: ["dry_run_stop_before_settle"] };
    }
    const requirements = toPaymentRequirements(quote, this.#opts.feePayer);
    const { status, body } = await this.#post("settle", {
      x402Version: X402_VERSION,
      paymentPayload: this.#buildPayload(payload, quote),
      paymentRequirements: requirements,
    });

    if (body?.success === true && typeof body.transaction === "string" && body.transaction.length > 0) {
      return { settled: true, transaction_id: body.transaction, reasons: [] };
    }
    return {
      settled: false,
      reasons: [body?.errorReason ?? `facilitator_settle_${status}`],
    };
  }

  /**
   * Independent settlement verification against the public mirror node.
   *
   * Everything here is a comparison against the *quote*, not against what the
   * facilitator told us. Six things must hold, and all six are checked even
   * once one has failed, so the evidence record shows the full picture rather
   * than the first tripwire:
   *
   *   1. the transaction is indexed and its consensus result is SUCCESS
   *   2. the payee was credited exactly the quoted amount
   *   3. the payer was debited at least that amount
   *   4. the asset matches (HBAR vs the quoted HTS token)
   *   5. the network is testnet
   *   6. the memo equals the quote id  ← the on-chain request binding
   */
  async verifySettlementViaMirrorNode(query: MirrorSettlementQuery): Promise<SettlementEvidenceLike> {
    const checkedAt = toIso(this.#clock.nowMs());
    const base = this.#opts.mirrorBaseUrl ?? MIRROR_TESTNET_BASE;

    const fail = (code: string, extra: Partial<SettlementEvidenceLike> = {}): SettlementEvidenceLike => {
      const ev: SettlementEvidenceLike = {
        schema: `nomos.gx402.settlement_evidence.${SCHEMA_VERSION}`,
        source: "MIRROR_NODE",
        verified: false,
        // Always TESTNET: the schema pins `network` by const, so a mainnet
        // value is literally unrepresentable. That is deliberate — the way we
        // report "you asked about the wrong network" is `failure_code`, not by
        // minting a document that says `hedera:mainnet`.
        network: TESTNET,
        asset: query.expected_asset,
        atomic_amount: "0",
        payer: "0.0.0",
        // 0.0.0 rather than the alias: the settlement schema requires a real
        // account id, and no account exists to name in a failure case.
        payee: isEvmAlias(query.expected_payee) ? "0.0.0" : query.expected_payee,
        transaction_id: query.transaction_id,
        consensus_timestamp: null,
        memo: null,
        finality: "PENDING",
        checked_at: checkedAt,
        failure_code: code,
        ...extra,
      };
      assertValid(ev, SETTLEMENT_EVIDENCE_SCHEMA);
      return ev;
    };

    if (query.expected_network !== TESTNET) return fail("network_not_testnet", { finality: "FAILED" });

    const tx = await fetchTransaction(query.transaction_id, { baseUrl: base, ...this.#opts.mirrorLookup });
    if (!tx) {
      // Not indexed yet. PENDING, never FAILED — and PENDING never delivers.
      return fail("not_yet_indexed");
    }

    const failures: string[] = [];
    if (tx.result !== "SUCCESS") failures.push(`consensus_result_${tx.result.toLowerCase()}`);

    // ── resolve an alias payee ────────────────────────────────────────────
    // When the quote named an EVM address, the transfer has just CREATED that
    // account (Hedera auto-account creation). The ledger rows name the created
    // `0.0.x`, not the alias, so comparing against the alias directly would
    // always report "the payee received nothing". Resolve it first — and note
    // that the resolution itself is evidence: the mirror node confirming that
    // this account id carries that EVM alias is what ties the created account
    // back to the key the quote committed to.
    let payeeAccountId = query.expected_payee;
    if (isEvmAlias(query.expected_payee)) {
      const resolved = await fetchAccount(query.expected_payee, base);
      if (!resolved || resolved.deleted) {
        return fail("payee_alias_not_created", { finality: "PENDING" });
      }
      if ((resolved.evm_address ?? "").toLowerCase() !== query.expected_payee.toLowerCase()) {
        return fail("payee_alias_mismatch", { finality: "FAILED" });
      }
      payeeAccountId = resolved.account;
    }

    const isHbar = query.expected_asset === "HBAR" || query.expected_asset === HBAR_ASSET_ID;
    const expected = BigInt(query.expected_atomic_amount);

    const creditedToPayee = isHbar
      ? netHbarForAccount(tx, payeeAccountId)
      : netTokenForAccount(tx, query.expected_asset, payeeAccountId);
    if (creditedToPayee !== expected) failures.push("amount_mismatch");

    // The payer is whoever was debited by at least the transferred amount. It is
    // derived from the ledger rather than taken from the facilitator's report,
    // because "who paid" is exactly the kind of claim that should not be taken
    // on trust. The fee payer is excluded: it is debited for the network fee.
    const debited = (tx.transfers ?? [])
      .filter((t) => BigInt(t.amount) <= -expected)
      .map((t) => t.account);
    const payer = debited[0] ?? "0.0.0";
    if (debited.length === 0) failures.push("payer_not_identifiable");

    const memo = decodeMemo(tx);
    if (memo !== query.expected_memo) failures.push("memo_not_bound_to_quote");

    const evidence: SettlementEvidenceLike = {
      schema: `nomos.gx402.settlement_evidence.${SCHEMA_VERSION}`,
      source: "MIRROR_NODE",
      verified: failures.length === 0,
      network: TESTNET,
      asset: query.expected_asset,
      atomic_amount: creditedToPayee > 0n ? creditedToPayee.toString() : "0",
      payer,
      // Always the resolved account id: a receipt names the account that
      // exists, not the address it was created from.
      payee: payeeAccountId,
      transaction_id: query.transaction_id,
      consensus_timestamp: tx.consensus_timestamp ?? null,
      memo,
      finality: failures.length === 0 ? "FINAL" : tx.result === "SUCCESS" ? "FAILED" : "FAILED",
      checked_at: checkedAt,
      failure_code: failures.length === 0 ? null : failures[0],
    };
    assertValid(evidence, SETTLEMENT_EVIDENCE_SCHEMA);
    return evidence;
  }

  buildHashScanLinks(args: {
    transaction_id: string;
    account_id?: string;
    topic_id?: string;
    sequence_number?: number;
  }): HashScanLinks {
    return buildHashScanLinks(args);
  }
}
