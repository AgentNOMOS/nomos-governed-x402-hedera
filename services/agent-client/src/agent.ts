/**
 * The buying agent.
 *
 * Note what the agent does NOT have: a private key. It holds an identity and a
 * delegation, it drives the HTTP flow, and when a signature is needed it asks a
 * `PaymentSigner` for one. In CP-H2 that signer is a separate process whose
 * stdin is the challenge and whose stdout is the signature — the key never
 * enters the agent's memory, let alone an LLM context window.
 *
 * The agent also verifies the receipt it receives rather than trusting it. An
 * agent that accepts any receipt the seller hands it has not been given proof
 * of anything; it has been given a claim.
 */
import { verifyProofOfActionReceipt, type ProofOfActionReceipt } from "../../../packages/evidence-receipt/src/index.ts";
import type { SignedPaymentPayload, Quote } from "../../../packages/hedera-x402-adapter/src/index.ts";
import type { EvidenceRequest, EvidenceResult } from "../../resource-server/src/evidence-service.ts";
import type { GovernedFlow, PaidOutcome, PreflightOutcome } from "../../resource-server/src/flow.ts";

export interface AgentIdentity {
  did: string;
  public_key_hex: string;
  key_type: "Ed25519";
  label?: string;
}

export interface AuthorityScope {
  scopes: string[];
  granted_by: string;
  valid_until: string;
  delegation_hash?: string | null;
}

/** How the agent obtains a payment signature. The only key-adjacent dependency. */
export interface AgentPaymentSigner {
  readonly payerAccountId: string;
  sign(quote: Quote): Promise<SignedPaymentPayload> | SignedPaymentPayload;
}

export interface PurchaseOutcome {
  ok: boolean;
  stage: "PREFLIGHT" | "PAYMENT" | "VERIFY" | "DONE";
  code: string;
  preflight: PreflightOutcome;
  paid?: PaidOutcome;
  result?: EvidenceResult;
  receipt?: ProofOfActionReceipt;
  verification?: { ok: boolean; reasons: string[]; mock_settlement: boolean };
}

export class GovernedAgent {
  // Explicit fields rather than TypeScript parameter properties: the whole repo
  // runs under Node's strip-only type erasure, which supports no syntax that
  // emits code. That constraint is deliberate — it keeps the project buildless.
  readonly #identity: AgentIdentity;
  readonly #authority: AuthorityScope;
  readonly #signer: AgentPaymentSigner;

  constructor(identity: AgentIdentity, authority: AuthorityScope, signer: AgentPaymentSigner) {
    this.#identity = identity;
    this.#authority = authority;
    this.#signer = signer;
  }

  /**
   * Run the full purchase.
   *
   * `trustedKeys` is how the caller states which receipt-signing keys it is
   * willing to believe. Omitting it still checks internal consistency and the
   * signature itself, but cannot detect a receipt signed by a stranger — so
   * production callers should always pass it.
   */
  async purchase(
    flow: GovernedFlow,
    args: {
      request_body: EvidenceRequest;
      request_id: string;
      nonce: string;
      anchor?: boolean;
      trustedKeys?: Readonly<Record<string, string>>;
    },
  ): Promise<PurchaseOutcome> {
    const preflight = flow.preflight({
      agent_identity: this.#identity as unknown as Record<string, unknown>,
      authority_scope: this.#authority as unknown as Record<string, unknown>,
      request_body: args.request_body,
      request_id: args.request_id,
      nonce: args.nonce,
      payer_account_id: this.#signer.payerAccountId,
    });

    if (preflight.httpStatus !== 402 || !preflight.quote) {
      return {
        ok: false,
        stage: "PREFLIGHT",
        code: `POLICY_${preflight.decision}`,
        preflight,
      };
    }

    const payload = await this.#signer.sign(preflight.quote);

    const paid = await flow.submitPayment({
      quote_id: preflight.quote.quote_id,
      payload,
      request_body: args.request_body,
      agent_identity: this.#identity as unknown as Record<string, unknown>,
      authority_scope: this.#authority as unknown as Record<string, unknown>,
      decision_id: preflight.quote.decision_id,
      nonce: args.nonce,
      anchor: args.anchor,
    });

    if (paid.httpStatus !== 200 || !paid.receipt) {
      return { ok: false, stage: "PAYMENT", code: paid.code, preflight, paid };
    }

    // Independent verification against what the agent believes it ordered.
    const verification = verifyProofOfActionReceipt(paid.receipt, {
      trustedKeys: args.trustedKeys,
      expected: {
        request_hash: preflight.quote.request_hash,
        quote_hash: preflight.quote.quote_hash,
        atomic_amount: preflight.quote.atomic_amount,
        payee: preflight.quote.pay_to,
        network: preflight.quote.network,
        asset: preflight.quote.asset,
      },
    });

    if (!verification.ok) {
      return { ok: false, stage: "VERIFY", code: `RECEIPT_REJECTED:${verification.reasons[0]}`, preflight, paid, verification };
    }

    return {
      ok: true,
      stage: "DONE",
      code: paid.code,
      preflight,
      paid,
      result: paid.result,
      receipt: paid.receipt,
      verification,
    };
  }
}
