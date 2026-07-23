# Protocol Flow

> **Current public-release status (CP-H2 / CP-H7 / CP-H8):** the chain below is
> implemented and tested end to end. A real 0.05 HBAR x402 payment settled on
> Hedera testnet, and its signed receipt digest is confirmed as message 1 on HCS
> topic `0.0.9703011`. Mock adapters remain only for the offline suite; their
> signed artifacts still carry `MOCK_OFFLINE`, so they cannot be confused with
> the public testnet evidence.

---

## The chain

```
  ┌─────────────┐
  │  Discovery  │  GET /.well-known/offer  →  service offer (public, no secrets)
  └──────┬──────┘
         │
  ┌──────▼──────────────┐
  │ NOMOS Policy        │  identity · authority · network · asset · payee
  │ Preflight           │  amount · spend caps · quote TTL · nonce
  └──────┬──────────────┘
         │  ALLOW ────────────────► continue
         │  DENY / REVIEW ────────► 403 + signed decision receipt, no challenge
         │
  ┌──────▼──────┐
  │  HTTP 402   │  accepts[] (scheme=exact, network=hedera:testnet, memo=quote_id)
  │             │  nomos{ quote_id, quote_hash, request_hash, idempotency_key,
  └──────┬──────┘         issued_at, expires_at, decision_id }
         │
  ┌──────▼──────────────┐
  │ Hedera Payment      │  the agent asks an ISOLATED signer for a signature
  │ Authorization       │  the key never enters the agent or an LLM context
  └──────┬──────────────┘
         │
  ┌──────▼──────────────┐
  │ Settlement          │  mirror node: amount · asset · network · payee · MEMO
  │ Verification        │  must be FINAL   ◄── THE GATE
  └──────┬──────────────┘
         │  not verified ────────► 402, nothing executed, nothing booked
         │
  ┌──────▼──────┐
  │  Execution  │  deterministic evidence service
  └──────┬──────┘
         │
  ┌──────▼──────────────┐
  │ Delivery Hash       │  result_hash = canonical digest of what was delivered
  └──────┬──────────────┘
         │
  ┌──────▼──────────────────────┐
  │ Signed Proof-of-Action      │  Ed25519 over domain||0x00||canon(record)
  │ Receipt                     │  binds identity → authority → policy → request
  └──────┬──────────────────────┘         → quote → payment → delivery
         │
  ┌──────▼──────────────┐
  │ HCS Anchor          │  submit record_digest to a topic  (ADDITIVE)
  │ (optional)          │  failure ⇒ status PENDING, receipt stays valid
  └──────┬──────────────┘
         │
  ┌──────▼──────────────┐
  │ HashScan / Receipt  │  links for humans, hashes for machines
  │ Verification        │  `node tools/verify-receipt.ts receipt.json kid=…`
  └─────────────────────┘
```

---

## The binding chain

This is the part that turns a payment into *proof of a specific action*. Each
link is a hash committed by the next.

```
request body ──canon──► request_hash ─┐
                                      ├─► quote (quote_hash) ──► quote_id
offer ────────canon──► (in quote) ────┘                            │
                                                                   │
                                        quote_id is placed in the ─┘
                                        TRANSACTION MEMO on-chain
                                                   │
                                                   ▼
                        settlement evidence: memo == quote_id
                                            amount == quote.atomic_amount
                                            payee  == quote.pay_to
                                            asset  == quote.asset
                                            network== quote.network
                                            finality == FINAL
                                                   │
result ───────canon──► result_hash ────────────────┤
                                                   ▼
                                    proof-of-action record
                                                   │
                                          canon ───┴──► record_digest
                                                   │
                                    Ed25519 signature over
                                    DOMAIN || 0x00 || canon(record)
                                                   │
                                                   ▼
                                          HCS anchor of record_digest
```

**Break any link and verification fails.** That is the demonstrable claim, and
`tests/integration/flow.test.ts` breaks each one on purpose to prove it.

### Why the memo matters more than it looks

Without `quote_id` in the transaction memo, a verifier can establish only that
*someone sent the right amount to the right account*. It cannot establish that
the payment was for **this** request. The memo is the single on-chain field that
turns a transfer into a transfer *for something*, and it is checked in
`verifySettlementViaMirrorNode`. A payment with a missing or foreign memo is
refused with `SETTLEMENT_UNVERIFIED:memo_not_bound_to_quote`.

---

## Ordering rule: verify is not paid

Delivery happens **only** after settlement is observed FINAL and bound.

This is not a theoretical concern. The Hedera x402 reference project documents
the opposite behaviour in its own README as a known v1 limitation: *"settle runs
after the handler returns: a verify-pass / settle-fail means data was delivered
without payment landing."* The production Base gateway this project's governance
logic descends from shipped the mirror-image bug — settling on any response with
status < 400, including errors — and fixed it the same way.

So the gate is where it is on purpose, and four integration tests exist solely
to keep it there.

---

## Idempotency and replay — two different guards

They are often conflated. They protect different things.

| | Idempotency key | Replay key |
|---|---|---|
| Bound to | `quote_id + request_hash + payer` | `network + transaction_id` |
| Exists | **before** any payment | only **after** a settlement |
| Protects against | a client retrying after a timeout | an attacker re-presenting a settled payment |
| On a hit | return the stored result and the **same** receipt, execute nothing | `409 TRANSACTION_REPLAY`, execute nothing |

The idempotency key deliberately does **not** include the transaction id. If it
did, a retry after a network blip would look like a new purchase and would
execute twice.

---

## Failure states

| State | HTTP | Receipt? | Notes |
|---|---|---|---|
| Policy DENY / REVIEW | 403 | **yes**, signed decision receipt | Same complete binding as an ALLOW |
| Spend cap reached | 403 at preflight | yes | Counted *before* payment, never after |
| Quote expired | 402 | no | Decided on the server clock only |
| Request ≠ quote | 409 | no | `PAYMENT_REQUEST_MISMATCH` |
| Unknown quote | 409 | no | |
| Payment invalid | 402 | no | |
| Settlement unverified / not FINAL | 402 | no | Nothing executed, nothing booked |
| Transaction replay | 409 | no | Returns nothing; the first receipt already exists |
| Idempotent retry | 200 | **the original receipt** | Charged once |
| **Paid, execution failed** | 200 | **yes** | `execution_status: FAILED`, `delivery_status: NOT_DELIVERED`, `refund_due: true` — the debt is *recorded*, never auto-settled |
| **Delivered, anchor failed** | 200 | **yes, valid** | `anchor.status: PENDING`/`FAILED`; anchoring is additive |

The last two rows are the interesting ones. A system that only produces evidence
when everything goes right produces evidence exactly when it is least needed.

---

## Fail-closed defaults

* An empty payee allowlist denies everything. There is no implicit trust.
* An unrecognised JSON-Schema keyword is an error, not a pass.
* A replay key that cannot be derived throws rather than failing open.
* A required field that is present-but-`undefined` counts as missing.
* A fractional number cannot be canonicalized at all, so a float amount cannot
  be signed.
* A malformed request still yields a complete, signed DENY — the one case where
  an attacker controls the input is not the case with no evidence trail.
