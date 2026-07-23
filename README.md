# NOMOS Governed x402 on Hedera

### From Proof of Payment to Proof of Action

> ✅ **CP-H2 complete — a real x402 payment settled on Hedera testnet.**
> Transaction [`0.0.7162784@1784746988.798231156`](https://hashscan.io/testnet/transaction/0.0.7162784-1784746988-798231156)
> moved 0.05 HBAR with the quote id `q_6eb0be075ceaee4b92d86575` in the
> transaction memo, and receipt `poa_60a1c2220acb7ef835dcdca8` binds identity,
> policy, request, quote, payment and result — verifying as VALID with
> `settlement_source: MIRROR_NODE`. See
> [`docs/evidence/CP-H2-REPORT.md`](docs/evidence/CP-H2-REPORT.md).
>
> ✅ **CP-H7 complete — the receipt's digest is anchored on the Hedera Consensus
> Service.** Message 1 on topic
> [`0.0.9703011`](https://hashscan.io/testnet/topic/0.0.9703011) (submit
> `0.0.9689846@1784818787.803110569`, consensus `1784818806.041876104`) carries a
> 585-byte envelope binding `receipt_id` and `record_digest`. The signed receipt
> is **byte-identical and still carries `anchor: null`** — writing the anchor into
> it would have broken the signature it exists to carry, so the anchor is separate
> evidence that names the receipt rather than a claim inside it. Consensus binds
> *when* the digest existed and in *what order*; it does not re-check the evidence.
> See [`docs/evidence/CP-H7F-ANCHOR-CONFIRMED.md`](docs/evidence/CP-H7F-ANCHOR-CONFIRMED.md).
>
> The demo UI (CP-H8) presents both and is built but **not deployed**. Testnet
> only.

---

## The idea in one paragraph

x402 lets an agent pay for an HTTP request. It proves that **money moved**. It
does not prove *who was allowed to spend it*, *what was bought*, *whether the
thing was actually delivered*, or *that the delivered thing is the thing the
payment was for*. This project adds the missing half: a policy decision before
the payment, a cryptographic binding between the payment and the specific
request, a hash of what was actually delivered, and a signed receipt tying all
of it together — optionally anchored to the Hedera Consensus Service so a third
party can timestamp its existence without holding the receipt.

Proof of payment is the receipt for a transfer. **Proof of action** is the
receipt for a transaction.

## What is actually novel here

Three things, in descending order of how much they matter:

1. **The payment is bound to the request, on-chain.** The quote id goes into the
   Hedera transaction memo. Without that, a verifier can establish only that
   *someone sent the right amount to the right account* — not that it paid for
   *this*. The memo is checked against the quote during settlement verification,
   and a payment with a missing or foreign memo buys nothing.

2. **Refusals are evidence too.** ALLOW, DENY and REVIEW all produce a signed
   receipt carrying the *same complete field set*. A denial whose binding is
   thinner than an approval is a denial nobody can audit.

3. **Delivery is gated on settlement, not on verification.** The Hedera x402
   reference project documents the opposite as a known limitation of its v1:
   *"a verify-pass / settle-fail means data was delivered without payment
   landing."* Here, work is released only after a FINAL, memo-bound settlement.

## Quick start

Requires **Node ≥ 22.6**. The offline core still needs nothing installed — it
runs on Node's standard library with native TypeScript type-stripping, so
`npm test` works on a fresh clone with no build step and no network. The real
Hedera path adds two packages (`@x402/hedera`, `@x402/core`); no test imports
them, which is why the suite keeps passing with `node_modules` deleted.

```bash
git clone <this repo> && cd nomos-governed-x402-hedera

npm test          # unit + integration + e2e, all offline
npm run scan      # secret scan — fails on key material or production leakage
npm run check     # both
```

To look at the CP-H8 demo page — a static, read-only presentation of the evidence
below, with no wallet, no payment path and no network call:

```bash
npm run demo:preview          # http://127.0.0.1:4408/
```

It also opens straight from disk: `apps/demo-ui/public/index.html`. Details in
[`apps/demo-ui/README.md`](apps/demo-ui/README.md).

To generate a throwaway receipt-signing key (never a production key):

```bash
npm run keygen    # writes .local/receipt-signer.key, mode 0600, git-ignored
```

To verify a receipt as a third party who does not trust us:

```bash
node tools/verify-receipt.ts receipt.json <kid>=<publicKeyHex>
```

That command recomputes every digest from the receipt's own contents and checks
the signature against **the key set you supply** — not the one the receipt
asserts about itself. Verifying against a key the document carries is not
verification; it is transcription.

## The flow

```
Discovery → NOMOS Policy Preflight → HTTP 402 → Hedera Testnet Payment
  → Settlement Verification → Service Execution → Delivery Hash
  → Signed Proof-of-Action Receipt → HCS Anchor (optional)
  → HashScan / Receipt Verification
```

Full detail, including the binding chain and every failure state, is in
[`docs/PROTOCOL_FLOW.md`](docs/PROTOCOL_FLOW.md).

## Layout

```
packages/shared-schemas/       canonicalization, 8 versioned schemas, id derivation
packages/nomos-policy/         ALLOW/DENY/REVIEW, allowlists, spend caps, replay guard
packages/hedera-x402-adapter/  402 challenge, quote issuance, adapter interfaces, HashScan links
packages/evidence-receipt/     Ed25519 signer, receipt builders, independent verifier
packages/hcs-anchor/           anchor interface + payload schema + topic denylist
services/resource-server/      the governed flow, and a deterministic evidence service
services/agent-client/         the buying agent (holds no key)
apps/demo-ui/                  CP-H8 evidence page: read-only model, static page, local preview
tools/                         secret scan, schema emit, keygen, standalone verifier
tests/{unit,integration,e2e}/  offline tests, no network and no SDK import
docs/                          protocol, boundaries, status, reference notes, evidence
```

## The receipt

```jsonc
{
  "schema": "nomos.gx402.proof_of_action_receipt.v1",
  "receipt_version": "v1",
  "receipt_id": "poa_…",
  "record": {
    "agent_identity":  { "did": "…", "public_key_hex": "…", "key_type": "Ed25519" },
    "authority_scope": { "scopes": ["evidence:read"], "granted_by": "…", "valid_until": "…" },
    "service_identity": { "service_id": "…", "resource_url": "…", "http_method": "POST" },
    "offer_id": "…",

    "policy_decision": "ALLOW",
    "policy_version": "…", "policy_hash": "sha256:…", "decision_id": "ppd_…",

    "request_hash": "sha256:…",
    "quote_id": "q_…", "quote_hash": "sha256:…",
    "idempotency_key": "idem_…", "nonce": "…",

    "network": "hedera:testnet", "asset": "HBAR",
    "atomic_amount": "5000000",          // decimal STRING — never a float
    "payer": "0.0.…", "payee": "0.0.…",

    "hedera_transaction_id": "0.0.…@…",
    "consensus_timestamp": "…",
    "settlement_source": "MIRROR_NODE",  // or MOCK_OFFLINE — always stated
    "settlement_finality": "FINAL",

    "execution_status": "SUCCEEDED",
    "delivery_status": "DELIVERED",
    "result_hash": "sha256:…",
    "refund_due": false,

    "receipt_timestamp": "…",
    "environment": "TESTNET_DEMO_ONLY",
    "disclaimer": "…"
  },
  "record_digest": "sha256:…",
  "signature": { "alg": "Ed25519", "kid": "…", "signature_domain": "NOMOS_GX402_PROOF_OF_ACTION_V1",
                 "canonicalization": "RFC8785-JCS/nomos-int-only-v1", "public_key_hex": "…", "signature": "…" },
  "anchor": { "topic_id": "0.0.…", "sequence_number": 42, "transaction_id": "0.0.…@…",
              "anchored_digest": "sha256:…", "hashscan_url": "…" },
  "verification": { "hashscan_transaction_url": "…", "mirror_transaction_url": "…" }
}
```

**No request or result content ever appears in a receipt or on-chain** — only
canonical hashes. The record type has no field capable of carrying content, and
a test asserts it.

### Canonicalization

RFC 8785 (JCS) with two deliberate restrictions that make it strictly narrower:

* **Non-integer numbers are rejected outright.** A monetary amount that survives
  a float round-trip is a bug waiting to be exploited. Amounts are decimal
  strings; `0.1 + 0.2` cannot be signed.
* **`undefined`, functions, symbols, NaN and Infinity are rejected** rather than
  silently dropped. A field that cannot be canonicalized must never be quietly
  excluded from a signature.

Signing input is `domain || 0x00 || canon(record)`. The NUL byte cannot occur in
a domain label, so a prepayment decision can never be replayed as a
proof-of-action receipt.

## Safety

Testnet only, enforced by schema `const` — a mainnet document is
unrepresentable. Fresh identities only: the pre-existing OracleNet topics are on
a hard denylist and the production signing paths are refused by the key loader.
The payer key lives in an isolated signer process and never enters the agent, an
LLM context, a log, a receipt or an HCS message.

Details and the reasoning behind each boundary:
[`docs/SECURITY_BOUNDARIES.md`](docs/SECURITY_BOUNDARIES.md).

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) — the latter records
the licence review of the two reference projects and states plainly that no code
was copied from either.
