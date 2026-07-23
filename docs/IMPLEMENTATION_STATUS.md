# Implementation Status

**As of CP-H2 (2026-07-22) — one real Hedera testnet x402 payment settled and receipted.** This file is the honest ledger. If something is a
mock, it says so here and it says so in the artifact itself.

## Headline

| | |
|---|---|
| Real Hedera transactions executed | **2** — 1 preparatory funding, 1 x402 payment |
| HCS messages submitted | **0** |
| Testnet accounts created | **2** — payer `0.0.9689846`, payee `0.0.9689904` (auto-created) |
| Keys generated | **3** local demo keys (payer, payee, receipt signer), all mode 0600 and git-ignored; **0** used to sign anything submitted |
| Git remotes configured | **none** |
| Commits pushed anywhere | **0** |
| Offline tests passing | **250** |
| Third-party dependencies | **2** (`@x402/hedera`, `@x402/core`) — real path only; the offline suite imports neither |

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
| HCS anchor interface + payload | `packages/hcs-anchor/src/interfaces.ts` | ✅ defined | interface only |
| HCS submission | `.../mock-anchor.ts` | 🟡 sequencing simulated | **MOCK** |
| Governed flow orchestration | `services/resource-server/src/flow.ts` | ✅ complete | **real** |
| Evidence service | `.../evidence-service.ts` | ✅ complete | **real**, synthetic corpus |
| Agent client | `services/agent-client/src/agent.ts` | ✅ complete | **real** |
| HTTP transport | `services/resource-server/src/http-server.ts` | ✅ complete | **real** 402 over the wire |
| Isolated payment signer process | `services/agent-client/src/signer-process.ts` | ✅ complete | **real** |
| Pre-transaction safety gate | `tools/preflight-check.ts` | ✅ complete | **real**, 17 checks |
| One-shot payment runner | `tools/run-payment.ts` | ✅ complete | **real**, dry-run default + one-payment lock |
| Demo UI | `apps/demo-ui/` | ✅ CP-H8 | **real**, local only — presents CP-H2 evidence and the confirmed CP-H7 anchor |
| Demo anchor resolution | `apps/demo-ui/src/anchor-model.ts` | ✅ CP-H8 | **real**, 14 fail-closed checks; four distinct states |
| HCS anchor envelope v2 | `packages/hcs-anchor/src/anchor-envelope.ts` | ✅ CP-H7 prep | **real** bytes, nothing submitted |
| HCS anchor verifier | `.../anchor-verifier.ts` | ✅ CP-H7 prep | **real**, offline; CONFIRMED needs an observation |
| HCS anchor guard (Grant B) | `.../anchor-guard.ts` | ✅ CP-H7D | **real**, BLOCKED — no confirmed topic, no Grant B |
| Topic configuration (frozen) | `.../topic-config.ts` | ✅ CP-H7D | **real**, digest `sha256:42ee4d26…650f6b` |
| Topic guard (Grant A) + read-back | `.../topic-guard.ts` | ✅ CP-H7D | **real**, exercised — read-back CONFIRMED |
| Topic creation runner | `tools/create-anchor-topic.ts` | ✅ CP-H7E | **real**, executed once; now blocked by three duplicate guards |
| HCS topic | `0.0.9703011` | ✅ CP-H7E | **real**, immutable configuration |
| HCS anchor | sequence 1 | ✅ CP-H7F | **real**, CONFIRMED byte-exact against a mirror node |
| HCS anchor runner | `tools/anchor-receipt.ts` | 🟡 dry run only | `--execute` refuses; no SDK loaded on the dry path |
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
tests/unit/alias-payee.test.ts   16   auto-account creation: where an alias is allowed and where not
tests/unit/child-records.test.ts  9   REGRESSION: child records must not be read as the payment
tests/unit/secret-scan.test.ts    5   no committed secrets, waivers stay out of runtime code
tests/integration/flow.test.ts   22   the delivery gate, replay, idempotency, caps, anchor independence
tests/e2e/mock-flow.test.ts       6   full chain, mock labelling, denial path, determinism
                                 ───
                                 250
```

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

**Next:** the bounty video and the public repository. The public push is still
blocked on the git-identity decision and on `tools/secret-scan.allow.json` being
untracked (see `docs/evidence/CP-H7-PREPARATION.md` §10).

**Anchored, and the receipt is unchanged.** The digest of
`poa_60a1c2220acb7ef835dcdca8` reached consensus on topic `0.0.9703011` at
sequence 1, consensus `1784818806.041876104`. The receipt itself still carries
`anchor: null` and is byte-identical to CP-H2: it is signed over its canonical
bytes, so the anchor lives in `docs/evidence/cp-h7/anchor-evidence.json`, linked
by `receipt_id` and `record_digest`. Anchoring is additive — the receipt was
fully valid before and is exactly as valid now.
