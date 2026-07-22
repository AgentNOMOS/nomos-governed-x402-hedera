# Implementation Status

**As of CP-H1 (2026-07-22).** This file is the honest ledger. If something is a
mock, it says so here and it says so in the artifact itself.

## Headline

| | |
|---|---|
| Real Hedera transactions executed | **0** |
| HCS messages submitted | **0** |
| Testnet accounts created | **0** |
| Keys generated and used in anger | **0** (test fixtures use a fixed seed) |
| Git remotes configured | **none** |
| Commits pushed anywhere | **0** |
| Offline tests passing | **199** |
| Third-party dependencies | **0** |

**Nothing in this repository currently evidences a real payment.** Every
settlement and every anchor carries `source: "MOCK_OFFLINE"` inside the signed
record, and an e2e test fails if that ever silently changes.

## Per-component

| Component | Path | Status | Real or mock |
|---|---|---|---|
| Canonicalization + hashing | `packages/shared-schemas/src/canonical.ts` | ✅ complete | **real** |
| Schema set (8, versioned) | `packages/shared-schemas/src/schemas.ts` + `schemas/*.json` | ✅ complete | **real** |
| Schema validator | `packages/shared-schemas/src/validator.ts` | ✅ complete | **real** |
| Deterministic id derivation | `packages/shared-schemas/src/ids.ts` | ✅ complete | **real** |
| Policy engine (ALLOW/DENY/REVIEW) | `packages/nomos-policy/src/policy.ts` | ✅ complete | **real** |
| Spend caps (per-payment / cumulative / per-UTC-day) | same | ✅ complete | **real**, in-memory |
| Replay guard (fail-closed) | same | ✅ complete | **real**, in-memory |
| Quote issuance + 402 challenge | `packages/hedera-x402-adapter/src/challenge.ts` | ✅ complete | **real** |
| HashScan / mirror link building | `.../hashscan.ts` | ✅ complete | **real** |
| Adapter interfaces | `.../interfaces.ts` | ✅ defined | interface only |
| Hedera payment client | — | ⬜ CP-H2 | **not built** |
| Mirror-node settlement verification | `.../mock-adapter.ts` | 🟡 comparisons real, data source mocked | **MOCK** |
| Receipt signer (Ed25519) | `packages/evidence-receipt/src/signer.ts` | ✅ complete | **real** |
| Receipt builders + verifier | `.../receipt.ts` | ✅ complete | **real** |
| HCS anchor interface + payload | `packages/hcs-anchor/src/interfaces.ts` | ✅ defined | interface only |
| HCS submission | `.../mock-anchor.ts` | 🟡 sequencing simulated | **MOCK** |
| Governed flow orchestration | `services/resource-server/src/flow.ts` | ✅ complete | **real** |
| Evidence service | `.../evidence-service.ts` | ✅ complete | **real**, synthetic corpus |
| Agent client | `services/agent-client/src/agent.ts` | ✅ complete | **real** |
| HTTP transport | — | ⬜ CP-H2 | **not built** |
| Demo UI | `apps/demo-ui/` | ⬜ CP-H8 | **not built** |
| Secret scanner | `tools/secret-scan.ts` | ✅ complete | **real** |
| Standalone verifier CLI | `tools/verify-receipt.ts` | ✅ complete | **real** |

Legend: ✅ done · 🟡 partial/mocked · ⬜ not started

## What "mocked" means precisely

`MockHederaX402Adapter` performs the **same comparisons** the real verifier will
perform — amount, asset, network, payee, memo, finality — against a simulated
observation instead of a mirror-node response. So the negative tests written
today keep their meaning when the data source is swapped in CP-H2. What is
missing is the chain, not the logic.

`MockHcsAnchor` produces real anchor *payload bytes* (CP-H7 submits exactly
those) and simulates sequencing and read-back. No SDK is imported, no client is
constructed, no message is sent.

## Test inventory

```
tests/unit/canonical.test.ts     22   determinism, manipulation, money safety, domains
tests/unit/schemas.test.ts       24   registry, validator, network/asset pinning, receipt bindings
tests/unit/policy.test.ts        32   allowlists, caps, authority, REVIEW, symmetric binding, replay
tests/unit/receipt.test.ts       44   key boundary, signatures, 13 mutation cases, impossible states
tests/unit/adapter.test.ts       28   quotes, challenge, expiry, HashScan slugs, settlement mismatches
tests/unit/anchor.test.ts        16   topic denylist, payload minimisation, degrade-not-throw
tests/unit/secret-scan.test.ts    5   no committed secrets, waivers stay out of runtime code
tests/integration/flow.test.ts   22   the delivery gate, replay, idempotency, caps, anchor independence
tests/e2e/mock-flow.test.ts       6   full chain, mock labelling, denial path, determinism
                                 ───
                                 199
```

## Next: CP-H2

**Goal:** one real Hedera testnet payment, verified against the mirror node,
with a HashScan link.

Concretely: add `@x402/hedera`, create a **fresh** faucet account, implement
`HederaX402Adapter` for real behind the unchanged interface, put `quote_id` in
the transaction memo, read the transfer back from the mirror node with a bounded
retry, and replace `MOCK_OFFLINE` with `MIRROR_NODE` in the settlement evidence.

**Exit criterion:** a signed proof-of-action receipt whose
`settlement_source` is `MIRROR_NODE`, whose `hedera_transaction_id` resolves on
HashScan, and which `tools/verify-receipt.ts` accepts.

Until that exists, nothing here may be described as a working Hedera
integration or submitted to the bounty.
