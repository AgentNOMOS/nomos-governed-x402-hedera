# Implementation Status

**As of CP-H2 (2026-07-22) — implementation complete, payment blocked on faucet.** This file is the honest ledger. If something is a
mock, it says so here and it says so in the artifact itself.

## Headline

| | |
|---|---|
| Real Hedera transactions executed | **0** |
| HCS messages submitted | **0** |
| Testnet accounts created | **0** — two keypairs generated locally, awaiting faucet funding |
| Keys generated | **3** local demo keys (payer, payee, receipt signer), all mode 0600 and git-ignored; **0** used to sign anything submitted |
| Git remotes configured | **none** |
| Commits pushed anywhere | **0** |
| Offline tests passing | **225** |
| Third-party dependencies | **2** (`@x402/hedera`, `@x402/core`) — real path only; the offline suite imports neither |

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
| Hedera payment client | `packages/hedera-x402-adapter/src/hedera-signer.ts` | ✅ complete | **real** — memo-binding, not yet exercised on chain |
| Facilitator verify/settle client | `.../real-adapter.ts` | ✅ complete | **real** — `/supported` exercised, `/verify` and `/settle` not yet called |
| Mirror-node settlement verification | `.../mirror.ts` + `.../real-adapter.ts` | ✅ complete | **real** — GETs exercised read-only |
| Mirror-node verification (offline stand-in) | `.../mock-adapter.ts` | 🟡 retained for the offline suite | **MOCK** |
| Receipt signer (Ed25519) | `packages/evidence-receipt/src/signer.ts` | ✅ complete | **real** |
| Receipt builders + verifier | `.../receipt.ts` | ✅ complete | **real** |
| HCS anchor interface + payload | `packages/hcs-anchor/src/interfaces.ts` | ✅ defined | interface only |
| HCS submission | `.../mock-anchor.ts` | 🟡 sequencing simulated | **MOCK** |
| Governed flow orchestration | `services/resource-server/src/flow.ts` | ✅ complete | **real** |
| Evidence service | `.../evidence-service.ts` | ✅ complete | **real**, synthetic corpus |
| Agent client | `services/agent-client/src/agent.ts` | ✅ complete | **real** |
| HTTP transport | `services/resource-server/src/http-server.ts` | ✅ complete | **real** 402 over the wire |
| Isolated payment signer process | `services/agent-client/src/signer-process.ts` | ✅ complete | **real** |
| Pre-transaction safety gate | `tools/preflight-check.ts` | ✅ complete | **real**, 17 checks |
| One-shot payment runner | `tools/run-payment.ts` | ✅ complete | **real**, dry-run default + one-payment lock |
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
tests/unit/real-adapter.test.ts  26   requirement mapping, facilitator discovery, mirror maths,
                                      propagation retry, six settlement negatives, dry-run stop
tests/unit/secret-scan.test.ts    5   no committed secrets, waivers stay out of runtime code
tests/integration/flow.test.ts   22   the delivery gate, replay, idempotency, caps, anchor independence
tests/e2e/mock-flow.test.ts       6   full chain, mock labelling, denial path, determinism
                                 ───
                                 225
```

## Blocked on one human action

Everything CP-H2 required is built. The run is blocked at funding: the Hedera
testnet faucet at `https://portal.hedera.com/faucet` is reCAPTCHA-protected,
and that control was respected rather than worked around.

Two EVM addresses need one paste each at that faucet:

```
payer  0xafe63adc38f1a28c57f7c2b9ebc03d1472e6003f
payee  0x98eca0a3f742ddc7791fc64b9cb2e226340607d5
```

Then, with no further decisions:

```bash
node tools/setup-env.ts        # resolve account ids → .env
node tools/preflight-check.ts  # 17 read-only checks
node tools/run-payment.ts      # dry run: signs for real, stops before /settle
node tools/run-payment.ts --execute   # the single authorised payment
```

**Exit criterion, unchanged:** a signed proof-of-action receipt whose
`settlement_source` is `MIRROR_NODE`, whose `hedera_transaction_id` resolves on
HashScan, and which `tools/verify-receipt.ts` accepts with no mock warning.

Until that exists, nothing here may be described as a working Hedera
integration or submitted to the bounty. See `docs/evidence/CP-H2-REPORT.md`.
