/**
 * HTTP transport for the governed flow — a real 402 over the wire.
 *
 * Deliberately `node:http` and nothing else: the interesting part of this
 * project is the governance chain, and a framework would only add surface a
 * reviewer has to read past.
 *
 * Routes:
 *
 *   GET  /.well-known/offer   → the service offer (public, no secrets)
 *   POST /v1/evidence         → 402 without a payment, 200 with a settled one
 *   GET  /health              → liveness
 *
 * Header names follow the Hedera x402 reference flow:
 *   `payment-required`   on the 402 response  (base64 JSON challenge)
 *   `payment-signature`  on the retry request (base64 JSON payload)
 *   `payment-response`   on the 200 response  (base64 JSON settlement)
 *
 * The server holds NO Hedera key. It cannot sign a payment even if it wanted
 * to; the facilitator is the fee payer and the agent's isolated signer holds
 * the payer key. The only key this process touches is the receipt-signing key,
 * which has no on-chain authority at all.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { GovernedFlow } from "./flow.ts";
import type { EvidenceRequest } from "./evidence-service.ts";
import { encodePaymentHeader, decodePaymentHeader } from "../../../packages/hedera-x402-adapter/src/real-adapter.ts";

export interface HttpServerOptions {
  flow: GovernedFlow;
  port: number;
  /** Identity presented by the demo agent. In a real deployment this arrives authenticated. */
  agentIdentity: Record<string, unknown>;
  authorityScope: Record<string, unknown>;
  payerAccountId: string;
  /** Optional sink for structured request logs. Never receives payloads or keys. */
  log?: (line: Record<string, unknown>) => void;
}

const MAX_BODY_BYTES = 64 * 1024;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(Buffer.from(chunk as Buffer));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function createGovernedServer(opts: HttpServerOptions): Server {
  const log = opts.log ?? (() => {});
  /** quote_id → the request body it was issued for, so the retry can be matched. */
  const pending = new Map<string, EvidenceRequest>();

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${opts.port}`);

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { status: "ok", environment: "TESTNET_DEMO_ONLY" });
      }

      if (req.method === "GET" && url.pathname === "/.well-known/offer") {
        return json(res, 200, opts.flow.discover());
      }

      if (req.method !== "POST" || url.pathname !== "/v1/evidence") {
        return json(res, 404, { error: "not_found" });
      }

      const rawBody = await readBody(req);
      let body: EvidenceRequest;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return json(res, 400, { error: "invalid_json" });
      }

      const paymentHeader = req.headers["payment-signature"];

      // ── leg 1: no payment yet → policy decision, then 402 or 403 ──────────
      if (typeof paymentHeader !== "string" || paymentHeader.length === 0) {
        const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const nonce = `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

        let outcome;
        try {
          outcome = opts.flow.preflight({
            agent_identity: opts.agentIdentity,
            authority_scope: opts.authorityScope,
            request_body: body,
            request_id: requestId,
            nonce,
            payer_account_id: opts.payerAccountId,
          });
        } catch (e) {
          return json(res, 422, { error: (e as any).code ?? "invalid_request" });
        }

        if (outcome.httpStatus === 403) {
          log({ event: "policy_denied", code: (outcome.decision_receipt.record as any).decision_code });
          // A denial ships its receipt. The refusal is auditable, not just asserted.
          return json(res, 403, {
            error: "policy_denied",
            decision: outcome.decision,
            decision_receipt: outcome.decision_receipt,
          });
        }

        pending.set(outcome.quote!.quote_id, body);
        log({ event: "challenge_issued", quote_id: outcome.quote!.quote_id, amount: outcome.quote!.atomic_amount });

        return json(
          res,
          402,
          {
            error: "payment_required",
            ...outcome.challenge,
            decision_receipt: outcome.decision_receipt,
          },
          { "payment-required": encodePaymentHeader(outcome.challenge) },
        );
      }

      // ── leg 2: payment presented → settle, verify, execute, receipt ───────
      const quoteId = String(req.headers["payment-quote-id"] ?? "");
      if (!quoteId) return json(res, 400, { error: "missing_payment_quote_id_header" });

      const originalBody = pending.get(quoteId);
      if (!originalBody) return json(res, 409, { error: "unknown_quote" });

      let decoded: any;
      try {
        decoded = decodePaymentHeader(paymentHeader);
      } catch {
        return json(res, 400, { error: "invalid_payment_signature_header" });
      }

      const quote = opts.flow.knownQuote(quoteId);
      if (!quote) return json(res, 409, { error: "unknown_quote" });

      const outcome = await opts.flow.submitPayment({
        quote_id: quoteId,
        payload: {
          payment_signature: paymentHeader,
          payer_account_id: opts.payerAccountId,
          scheme: "exact",
          network: "hedera:testnet",
        },
        request_body: body,
        agent_identity: opts.agentIdentity,
        authority_scope: opts.authorityScope,
        decision_id: quote.decision_id,
        nonce: quote.quote_id,
        anchor: false, // CP-H7. No HCS message is sent in CP-H2.
      });

      log({ event: "payment_outcome", quote_id: quoteId, status: outcome.httpStatus, code: outcome.code });

      if (outcome.httpStatus !== 200) {
        return json(res, outcome.httpStatus, {
          error: outcome.code,
          settlement: outcome.settlement ?? null,
        });
      }

      return json(
        res,
        200,
        {
          result: outcome.result,
          receipt: outcome.receipt,
          idempotent_replay: outcome.idempotent_replay === true,
        },
        {
          "payment-response": encodePaymentHeader({
            success: true,
            transaction: (outcome.receipt!.record as any).hedera_transaction_id,
            network: "hedera:testnet",
            payer: (outcome.receipt!.record as any).payer,
          }),
        },
      );
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "BODY_TOO_LARGE") return json(res, 413, { error: "body_too_large" });
      log({ event: "server_error", error: (e as Error).name });
      return json(res, 500, { error: "internal_error" });
    }
  });
}

/** Convenience for scripts: start and resolve once listening. */
export function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise());
  });
}
