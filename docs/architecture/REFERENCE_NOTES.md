# Reference Notes — Hedera x402 protocol facts

Facts gathered on **2026-07-22** from public sources, used to design the adapter
interface. **No code was copied.** See `NOTICE` for the licence position.

## Licence review (done before reading any source)

| Repository | Licence at review | What we may do |
|---|---|---|
| `matevszm/x402-hedera-example` | **none** (no LICENSE file) | Read for protocol facts only. Copying any source would be a licence violation — all rights reserved by default. |
| `hedera-dev/scaffold-hbar` | **MIT** | Compatible with Apache-2.0. No code taken so far; if any is, the MIT notice goes into `NOTICE`. |

Protocol facts — package names, header names, network identifiers, message
ordering, error semantics — are not copyrightable expression. Implementations
of them written from scratch are ours.

## Facts

**Package.** The Hedera `exact` payment scheme ships as `@x402/hedera`. npm
registry at time of review: version **2.19.0**, depending on `@x402/core ~2.19.0`,
`@hiero-ledger/sdk 2.85.0` and `@hiero-ledger/proto 2.31.0`. Hedera's own
announcement states the scheme was accepted into x402 with a TypeScript
reference implementation, backing "pay-per-request HTTP authorization, backed by
HBAR or HTS tokens".

**Network identifier.** `hedera:testnet`. Note this is *not* a CAIP-2
`eip155:*` value. Hedera does expose an EVM-compatible JSON-RPC relay
(`eip155:296` for testnet), but that is a different lane; the x402 Hedera scheme
is native. Getting this wrong is the single largest design risk in the project,
which is why `network` is pinned by schema `const` rather than by configuration.

**Headers.**

| Direction | Header | Content |
|---|---|---|
| 402 response | `payment-required` | the challenge |
| retry request | `payment-signature` | the signed payload |
| 200 response | `payment-response` | base64 JSON; its `transaction` field carries the Hedera transaction id |

**Fee payer.** A facilitator co-signs and pays the fee, so the resource server
holds no Hedera key at all. `https://api.testnet.blocky402.com` is the
facilitator used by the reference project; Hedera's blog names BlockyDevs' open
source facilitator as supporting Hedera testnet alongside several EVM chains.

**Timeout.** `maxTimeoutSeconds` of 180 in the reference. Signatures are meant
to be produced immediately before the retry, not cached. Our quote TTL is set to
the same 180 s so the two windows cannot disagree.

**Key types.** Testnet accounts may be `ECDSA_SECP256K1` or `ED25519`, and the
signer must pick `fromStringECDSA` vs `fromStringED25519` accordingly. Our
`.env.example` therefore carries an explicit `PAYER_KEY_TYPE` rather than
guessing from the key string.

**Node version.** The reference requires Node ≥ 20. This project requires
≥ 22.6 because it relies on native TypeScript type-stripping to stay buildless.

## Deliberate differences from the reference

These are the places where this project does something else on purpose. They are
also, not coincidentally, the places where it adds something.

| Reference behaviour | Ours | Why |
|---|---|---|
| `settle` runs *after* the handler returns; documented as "verify-pass / settle-fail means data was delivered without payment landing" | delivery is gated on a FINAL, memo-bound settlement | verify is not paid |
| no spend guardrail | per-payment, cumulative and per-UTC-day caps, counted before payment | an agent with a key and no ceiling is an incident waiting for a schedule |
| no HCS attestation | optional, additive HCS anchor of the receipt digest | third-party timestamped existence proof |
| no policy layer | ALLOW / DENY / REVIEW with identical binding in all three | a refusal nobody can audit is not governance |
| payment proves a transfer | `quote_id` in the transaction memo | proves a transfer *for a specific request* |
| server returns data | server returns data **plus a signed receipt binding it to the payment** | the actual thesis of the project |

## Open questions for CP-H2

1. Exact `@x402/hedera` API surface — class names, scheme registration, and
   whether the memo is settable through the standard `accepts` entry or needs a
   facilitator-specific field. To be answered by reading the published package,
   not by guessing.
2. Whether the facilitator echoes the memo back in `payment-response`, or
   whether the memo must be read from the mirror node. Our verifier reads the
   mirror node either way, since a facilitator's word is not independent evidence.
3. Mirror-node propagation delay after consensus, and therefore the right
   bounded-retry budget before reporting `PENDING`.
4. USDC on Hedera testnet: HTS token id, association requirement, and whether a
   faucet exists. HBAR is the default for the demo precisely because this is
   unresolved.
