# Implementation Status

**As of the public release (2026-07-23) — the payment, receipt, HCS anchor, demo and public evidence are complete.** This file is the honest ledger. If something is a
mock, it says so here and it says so in the artifact itself.

## Headline

| | |
|---|---|
| Real Hedera transactions executed | **4** — preparatory funding, x402 payment, HCS topic creation and one HCS message submission |
| HCS messages submitted | **1** — topic `0.0.9703011`, sequence 1, consensus `1784818806.041876104` |
| Testnet accounts created | **2** — payer `0.0.9689846`, payee `0.0.9689904` (auto-created) |
| Keys generated | **3** local testnet/demo keys (payer, payee, receipt signer), all mode 0600 and git-ignored; used only for the explicitly authorized testnet flow |
| Public repository | [`AgentNOMOS/nomos-governed-x402-hedera`](https://github.com/AgentNOMOS/nomos-governed-x402-hedera), default branch `main` |
| Release baseline | `0ab3e89433287e27b69cfaf2a03792f523313e15` |
| Validation | **539/539** tests passing; secret scan CLEAN across 119 files; demo evidence current |
| Third-party dependencies | **3** (`@x402/hedera`, `@x402/core`, `@hiero-ledger/sdk`) — real Hedera/HCS paths only; the offline suite imports none |

**A real payment is evidenced**: `docs/evidence/cp-h2/receipt.json` carries
`settlement_source: "MIRROR_NODE"`, `settlement_finality: "FINAL"` and Hedera
transaction `0.0.7162784@1784746988.798231156`, and verifies as VALID with no
mock warning. Mock artifacts still exist for the offline suite and still carry
`MOCK_OFFLINE` inside the signed record, so the two can never be confused.

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
| Hedera payment client | `packages/hedera-x402-adapter/src/hedera-signer.ts` | ✅ complete | **real** — memo-binding, confirmed on chain |
| Facilitator verify/settle client | `.../real-adapter.ts` | ✅ complete | **real** — `/supported`, `/verify` and `/settle` all exercised |
| Mirror-node settlement verification | `.../mirror.ts` + `.../real-adapter.ts` | ✅ complete | **real** — verified a live settlement |
| Settlement completion tool | `tools/complete-settlement.ts` | ✅ complete | **real**, cannot pay (`dryRun` hardwired) |
| Mirror-node verification (offline stand-in) | `.../mock-adapter.ts` | 🟡 retained for the offline suite | **MOCK** |
| Receipt signer (Ed25519) | `packages/evidence-receipt/src/signer.ts` | ✅ complete | **real** |
| Receipt builders + verifier | `.../receipt.ts` | ✅ complete | **real** |
| HCS anchor interface + payload | `packages/hcs-anchor/src/interfaces.ts` | ✅ complete | **real** |
| Mock HCS submission | `.../mock-anchor.ts` | 🟡 retained for the offline suite | **MOCK** |
| Governed flow orchestration | `services/resource-server/src/flow.ts` | ✅ complete | **real** |
| Evidence service | `.../evidence-service.ts` | ✅ complete | **real**, synthetic corpus |
| Agent client | `services/agent-client/src/agent.ts` | ✅ complete | **real** |
| HTTP transport | `services/resource-server/src/http-server.ts` | ✅ complete | **real** 402 over the wire |
| Isolated payment signer process | `services/agent-client/src/signer-process.ts` | ✅ complete | **real** |
| Pre-transaction safety gate | `tools/preflight-check.ts` | ✅ complete | **real**, 17 checks |
| One-shot payment runner | `tools/run-payment.ts` | ✅ complete | **real**, dry-run default + one-payment lock |
| Demo UI | `apps/demo-ui/` | ✅ CP-H8 | **real**, local only — presents CP-H2 evidence and the confirmed CP-H7 anchor |
| Demo anchor resolution | `apps/demo-ui/src/anchor-model.ts` | ✅ CP-H8 | **real**, 14 fail-closed checks; four distinct states |
| HCS anchor envelope v2 | `packages/hcs-anchor/src/anchor-envelope.ts` | ✅ CP-H7F | **real**, submitted once and confirmed byte-exact |
| HCS anchor verifier | `.../anchor-verifier.ts` | ✅ CP-H7F | **real**, confirmed against an independent Mirror Node observation |
| HCS anchor guard (Grant B) | `.../anchor-guard.ts` | ✅ CP-H7F | **real**, executed once; consumed grant and duplicate guards now refuse re-execution |
| Topic configuration (frozen) | `.../topic-config.ts` | ✅ CP-H7D | **real**, digest `sha256:42ee4d26…650f6b` |
| Topic guard (Grant A) + read-back | `.../topic-guard.ts` | ✅ CP-H7D | **real**, exercised — read-back CONFIRMED |
| Topic creation runner | `tools/create-anchor-topic.ts` | ✅ CP-H7E | **real**, executed once; now blocked by three duplicate guards |
| HCS topic | `0.0.9703011` | ✅ CP-H7E | **real**, `admin_key: null`; configuration and submit key cannot be changed without an admin key; expiry/auto-renew remain separate ledger properties |
| HCS anchor | sequence 1 | ✅ CP-H7F | **real**, CONFIRMED byte-exact against a mirror node |
| HCS anchor runner | `tools/anchor-receipt.ts` | ✅ CP-H7F | executed once under Grant B; re-execution refuses; dry-run still loads no SDK |
| Standalone anchor verifier CLI | `tools/verify-anchor.ts` | ✅ CP-H7 prep | **real** |
| Secret scanner | `tools/secret-scan.ts` | ✅ complete | **real** |
| Standalone verifier CLI | `tools/verify-receipt.ts` | ✅ complete | **real** |

Legend: ✅ done · 🟡 partial/mocked · ⬜ not started

## What "mocked" means precisely

`MockHederaX402Adapter` performs the **same comparisons** the real verifier will
perform — amount, asset, network, payee, memo, finality — against a simulated
observation instead of a mirror-node response. So the negative tests written
today keep their meaning when the data source is swapped in CP-H2. What is
missing is the chain, not the logic.

`MockHcsAnchor` produces real anchor *payload bytes* for the v1 payload and
simulates sequencing and read-back. No SDK is imported, no client is
constructed, no message is sent.

CP-H7 preparation superseded that payload for submission purposes: the bytes an
operator would actually publish come from `buildAnchorEnvelope` (v2), which adds
the algorithm, canonicalization profile, receipt schema and source payment that
a topic reader needs in order to verify without holding the receipt. v1 is left
untouched because CP-H1 and CP-H2 evidence asserts its shape.

## Validation baseline

The public release baseline `0ab3e89` was verified with:

- **539/539 tests passing** across unit, integration and end-to-end suites
- secret scan **CLEAN** across 119 tracked files
- committed demo evidence confirmed current
- fresh-clone verification completed before publication

The earlier CP-H2 test inventory contained 250 tests. Historical checkpoint
reports retain that number because they describe the repository at that time;
the current public-release total is 539.
## CP-H2 complete

One real x402 payment settled on Hedera testnet and is bound by a signed
proof-of-action receipt:

```
transaction  0.0.7162784@1784746988.798231156   SUCCESS
memo         q_6eb0be075ceaee4b92d86575         (= quote_id)
amount       5000000 tinybar = 0.05 HBAR
payer        0.0.9689846  →  payee 0.0.9689904
receipt      poa_60a1c2220acb7ef835dcdca8       VALID, settlement_source MIRROR_NODE
```

Verify it yourself:

```bash
node tools/verify-receipt.ts docs/evidence/cp-h2/receipt.json \
  nomos-gx402-demo-ed25519-1=593ad93fa6ebbdabada18f9be12f391b32c5d2c487080d8d79f156c943ea21e9
```

One thing went wrong and is worth reading: the payment succeeded on chain and
the verifier rejected it, because `GET /transactions/{id}` returns child records
from auto-account creation and the code read `transactions[0]`. Fixed in
`selectUserTransaction`, regression-tested in `tests/unit/child-records.test.ts`.
Full account in `docs/evidence/CP-H2-REPORT.md` §4.

**Submission status:** the public repository and the [3:36 video demo](https://youtu.be/OOKwp3XrVsU)
are live, and the Hedera x402 bounty submission was sent on 2026-07-23. Historical
checkpoint reports remain unchanged and must be read as snapshots of their stated
checkpoint.

**Anchored, and the receipt is unchanged.** The digest of
`poa_60a1c2220acb7ef835dcdca8` reached consensus on topic `0.0.9703011` at
sequence 1, consensus `1784818806.041876104`. The receipt itself still carries
`anchor: null` and is byte-identical to CP-H2: it is signed over its canonical
bytes, so the anchor lives in `docs/evidence/cp-h7/anchor-evidence.json`, linked
by `receipt_id` and `record_digest`. Anchoring is additive — the receipt was
fully valid before and is exactly as valid now.
