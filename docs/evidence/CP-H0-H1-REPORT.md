# CP-H0 / CP-H1 — Checkpoint Report

**Project:** NOMOS Governed x402 on Hedera — *From Proof of Payment to Proof of Action*
**Repository:** `/root/nomos-governed-x402-hedera` (local git only, **no remote, nothing pushed**)
**Date:** 2026-07-22
**Preceding assessment:** `/root/ops/HEDERA_NOMOS_X402_REUSE_ASSESSMENT.md` + `…_ADDENDUM_01_BOUNTY.md`

---

## 0. Executive summary

CP-H0 and CP-H1 are complete. The repository exists, is isolated, and contains a
**working, fully tested offline governance core**: canonicalization, eight
versioned schemas, the policy engine with spend caps and replay protection, the
402 challenge builder, the Ed25519 receipt signer and an independent verifier,
plus mock adapters that let the whole chain run end to end.

**199 tests pass. The secret scan is clean. No Hedera transaction was attempted,
no key was created for real use, no remote was configured, and nothing was
pushed.**

The bounty finding from the assessment has been corrected in a standalone
addendum: the bounty **is** open, closing **31 July 2026, 23:59 ET**. That makes
CP-H2 — the real testnet payment — not merely the next step but the minimum bar
for a valid submission, since "real on-chain payments through x402" is an
explicit judging criterion.

---

## 1. CP-H0 — Inventory and truth

### 1.1 Bounty correction (the only forensic finding changed)

| | Before | After |
|---|---|---|
| Status | `BLOCKED_NO_OPEN_BOUNTY` | **`BOUNTY_OPEN_DEADLINE_2026-07-31T23:59_ET`** |
| Source | `ai-bounties.hedera.com` (the AI Studio campaign — a *different* programme) | **`hedera.com/x402-bounty/`** |

Confirmed requirements: Hedera **testnet**; **HBAR or USDC**; x402 **end-to-end**;
**real on-chain transactions**; **public open-source GitHub repo**; **HashScan
links**; **demo video under five minutes**; submission by form; deadline
**31 July 2026, 23:59 ET**; **five prizes of $1,000**.

Judging: a working end-to-end flow · real on-chain payments through x402 · how
well the build uses Hedera rails.

**HCS is not listed as a requirement** → bonus and differentiator, not a
precondition. **No x402 package or Agent Kit is mandated.** **No licence is
specified.**

Full correction, including exactly which sections of the assessment it
supersedes and which it leaves untouched:
[`BOUNTY_ADDENDUM.md`](BOUNTY_ADDENDUM.md).

### 1.2 Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| **A1** | **Hedera-native x402, not the EVM relay** | `@x402/hedera` implements Hedera's own `exact` scheme with network id `hedera:testnet`. Routing through `eip155:296` would technically work and would almost certainly read as "an EVM demo pointed at Hedera". This was the assessment's flagged top risk; it is now decided and pinned by schema `const`. |
| **A2** | **HBAR, not USDC** | Both are allowed. HBAR is faucet-available on testnet; USDC on Hedera testnet is an HTS token with association requirements and unresolved sourcing (open question 4 in the reference notes). The asset field is a schema-level allowlist, so switching later is a policy change, not a rewrite. |
| **A3** | **Zero dependencies for the offline core** | Node ≥ 22.6 gives Ed25519, SHA-256, a test runner and native TypeScript type-stripping. A reviewer can clone and run `npm test` with no install and no network. CP-H2 adds exactly one dependency family. |
| **A4** | **TypeScript with no build step** | Native type-stripping. `tsconfig.json` sets `erasableSyntaxOnly`, so a type-check failure is exactly a runtime failure — no enums, namespaces, parameter properties or decorators can creep in. |
| **A5** | **`quote_id` in the transaction memo** | The single design choice that turns "money moved" into "money moved *for this request*". Without it the on-chain artifact proves a transfer and nothing more. |
| **A6** | **Delivery gated on FINAL, memo-bound settlement** | The Hedera x402 reference documents the opposite as a known v1 limitation. The Base gateway in this project's lineage shipped the mirror-image bug. Four integration tests keep the gate where it is. |
| **A7** | **Anchoring is additive** | A receipt is complete and verifiable without an anchor; a failed anchor degrades to `PENDING`/`FAILED` and never invalidates work that already happened. This also de-risks the schedule, since HCS is not a bounty requirement. |
| **A8** | **Synthetic evidence service** | Binding a public demo to the live production evidence stack buys nothing a reviewer can check and costs a coupling that could leak data. Determinism is worth more than realism here: anyone can re-run and get a byte-identical `result_hash`. |
| **A9** | **Apache-2.0** | Explicit patent grant and a `NOTICE` file, which is the right shape for a protocol/governance project. Compatible with the MIT-licensed reference repo. The bounty specifies no licence. |
| **A10** | **Canonicalization rejects non-integer numbers** | Strictly narrower than RFC 8785. A monetary amount that survives a float round-trip is a bug waiting to happen; making it *unrepresentable* is cheaper than testing for it. |
| **A11** | **Separate idempotency key and replay key** | Different jobs. The idempotency key exists before any payment and deliberately excludes the transaction id, so a retry after a network blip cannot look like a second purchase. |
| **A12** | **Fresh identities only** | Both the bounty's isolation requirement and the SEC-HEDERA-A1 finding point the same way. See §5. |

### 1.3 Production boundaries recorded

Recorded in [`../SECURITY_BOUNDARIES.md`](../SECURITY_BOUNDARIES.md) and
enforced in code (§5.2 below).

---

## 2. CP-H1 — What was built

### 2.1 Files created

**57 files, 5,815 lines of TypeScript.** Nothing outside the repository was
created or modified except the two `/root/ops/` report files.

```
  Root                LICENSE  NOTICE  README.md  SECURITY.md
                      package.json  tsconfig.json  .gitignore  .env.example

  packages/shared-schemas/src/     canonical.ts  validator.ts  schemas.ts
                                   ids.ts  time.ts  index.ts
  packages/shared-schemas/schemas/ 8 generated .v1.json files
  packages/nomos-policy/src/       policy.ts  index.ts
  packages/hedera-x402-adapter/src interfaces.ts  types.ts  challenge.ts
                                   hashscan.ts  mock-adapter.ts  index.ts
  packages/evidence-receipt/src/   signer.ts  receipt.ts  index.ts
  packages/hcs-anchor/src/         interfaces.ts  mock-anchor.ts  index.ts

  services/resource-server/src/    flow.ts  evidence-service.ts
  services/agent-client/src/       agent.ts
  apps/demo-ui/                    README.md (CP-H8 placeholder)

  tools/                           secret-scan.ts  secret-scan.allow.json
                                   emit-schemas.ts  keygen.ts  verify-receipt.ts

  tests/helpers/                   fixtures.ts
  tests/unit/                      canonical  schemas  policy  receipt
                                   adapter  anchor  secret-scan  (7 files)
  tests/integration/               flow.test.ts
  tests/e2e/                       mock-flow.test.ts

  docs/                            PROTOCOL_FLOW.md  SECURITY_BOUNDARIES.md
                                   IMPLEMENTATION_STATUS.md
  docs/architecture/               REFERENCE_NOTES.md
  docs/evidence/                   BOUNTY_ADDENDUM.md  CP-H0-H1-REPORT.md
```

### 2.2 The eight canonical schemas

`service_offer` · `policy_preflight_request` · `prepayment_decision_receipt` ·
`payment_challenge` · `settlement_evidence` · `delivery_evidence` ·
`hcs_anchor_reference` · `proof_of_action_receipt`

All are `additionalProperties: false` (an unbound field is an unsigned field),
all pin `network` to `hedera:testnet` by `const`, and all express atomic amounts
as decimal strings.

The proof-of-action record binds every field the brief required —
`receipt_version`, `receipt_id`, `agent_identity`, `authority_scope`,
`service_identity`, `offer_id`, `policy_decision`, `policy_hash`,
`request_hash`, `quote_hash`, `idempotency_key`, `network`, `asset`,
`atomic_amount`, `payer`, `payee`, `hedera_transaction_id`,
`consensus_timestamp` (optional), `delivery_status`, `result_hash`,
`receipt_timestamp`, the signature block, the optional HCS topic/sequence/
transaction reference, and the verification links — and a test asserts each one
is `required`, plus a further test asserting that **no field capable of carrying
request or result content exists at all**.

### 2.3 Adapter and anchor interfaces (no implementation yet, by design)

`createPaymentChallenge` · `signPaymentPayload` · `verifyPayment` ·
`settlePayment` · `verifySettlementViaMirrorNode` · `buildHashScanLinks`
`anchorReceiptHash` · `verifyAnchor` → topicId, sequenceNumber, transactionId,
consensusTimestamp, HashScan link

`PaymentSigner` is the only key-bearing interface in the project. It takes bytes
and returns bytes; no other type in the graph has a field a key could travel
through. Swapping it for an HSM, a KMS or the Hiero CLI is a one-line change.

---

## 3. Tests — exact results

Command: `npm test` → `node --test tests/unit/*.test.ts tests/integration/*.test.ts tests/e2e/*.test.ts`

```
# tests 199
# suites 46
# pass 199
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 238.05
```

| File | Tests | Covers |
|---|---:|---|
| `tests/unit/canonical.test.ts` | 22 | key-order determinism, unicode round-trip, single-field mutation detection, float/NaN/Infinity/undefined rejection, `MAX_SAFE_INTEGER` rejection, exact large decimal strings, domain separation, NUL-injection refusal |
| `tests/unit/schemas.test.ts` | 24 | registry completeness and unique `$id`s, fail-closed validator (missing / undefined / extra / unknown-keyword), mainnet unrepresentable, anchored asset pattern, amounts as strings only, MOCK vs real source enum, all required receipt bindings, no content field |
| `tests/unit/policy.test.ts` | 32 | ALLOW path, network/asset/payee allowlists, empty allowlist denies, per-payment cap, cumulative cap (incl. exact-boundary allow), per-UTC-day count cap and day rollover, BigInt exactness, scope coverage and wildcards, expired delegation, nonce reuse, REVIEW vs DENY precedence, **symmetric binding across all three decisions**, malformed input still yielding a bound DENY, fail-closed replay guard |
| `tests/unit/receipt.test.ts` | 44 | deterministic key from seed, production key-path refusal (5 paths + a `..` traversal), signature validity/tamper/domain/kid/untrusted-key, prepayment ALLOW and DENY receipts, **13 field-mutation cases**, digest-repair still caught by signature, foreign re-signing caught by key set, request/result/amount/payee substitution, impossible state combinations, anchor attach/mismatch |
| `tests/unit/adapter.test.ts` | 28 | quote determinism, payer-dependent idempotency key, recomputable quote hash, challenge schema validity, memo binding, testnet-only, no key material and no unexplained hex, expiry boundaries, HashScan slug conversion and malformed-id refusal, MOCK labelling, amount/payee/memo/finality mismatch detection |
| `tests/unit/anchor.test.ts` | 16 | topic denylist (all four OracleNet topics), malformed topic id, payload has exactly 5 fields, single-chunk budget, malformed digest refusal, sequencing, read-back, digest mismatch, **degrade-not-throw** on chain failure, retry safety |
| `tests/unit/secret-scan.test.ts` | 5 | zero ERROR findings, zero unwaived WARN findings, waivers confined to denylists/tests/docs, rule table sanity |
| `tests/integration/flow.test.ts` | 22 | 402 issuance, denial without a challenge, wrong network/asset, invalid body codes, happy path, quote expiry both sides of the boundary, request≠quote mismatch, unknown quote, **four settlement-gate negatives**, idempotent replay charging once, transaction replay across quotes, cumulative and daily caps across purchases, anchor success and anchor failure not gating delivery, no payload content in the receipt |
| `tests/e2e/mock-flow.test.ts` | 6 | full chain with every link asserted, MOCK labelling guard, denial short-circuit, foreign-key rejection, cross-run result determinism, request normalisation invariance |

Secret scan: `npm run scan` → **58 files scanned, 0 errors, 0 unwaived warnings,
29 waived — CLEAN.** Every waiver names a file, a rule and a defended reason;
waivers are confined to denylists, tests of denylists, and documentation.

### 3.1 Standalone verifier — observed output

The claim that a third party can check a receipt without trusting us is only
worth anything if the tool actually runs. It does. A receipt produced by the
mock flow, written outside the repository and verified with the CLI:

```
$ node tools/verify-receipt.ts receipt.json nomos-gx402-test-ed25519-1=ea4a6c63…d22c
receipt   : poa_ab76e3c550edfdf73b6ce76c
digest    : sha256:824d55804a746c03c9c01e2dba8824d48b34e3808947d2a7a00a8fc631898a88
verdict   : VALID
warning   : settlement_source is MOCK_OFFLINE — this receipt does NOT evidence
            a real on-chain payment.
```

The same receipt after changing `atomic_amount` from `5000000` to `1`:

```
verdict   : INVALID
  reason  : record_digest_mismatch
  reason  : signature_invalid
$ echo $?
1
```

Note that the mock warning fires on the *valid* receipt too. That is the point:
a well-formed, correctly signed receipt from an offline run still says out loud
that no payment happened.

---

## 4. Dependency versions and licence review

### 4.1 Runtime

| | |
|---|---|
| Node.js | **v22.23.0** (project requires ≥ 22.6 for native type-stripping) |
| npm | 10.9.8 |
| Third-party runtime dependencies | **0** |
| Third-party dev dependencies | **0** |

Everything runs on `node:crypto`, `node:test`, `node:fs`, `node:path`,
`node:child_process` and `node:url`.

### 4.2 Planned for CP-H2

`@x402/hedera` — npm **2.19.0** at review time, depending on `@x402/core ~2.19.0`,
`@hiero-ledger/sdk 2.85.0`, `@hiero-ledger/proto 2.31.0`.

### 4.3 Licence review of the reference projects

| Repository | Licence (checked 2026-07-22 via GitHub API) | Action taken |
|---|---|---|
| `matevszm/x402-hedera-example` | **`license: null`** — no LICENSE file | **No code copied.** Read for protocol facts only (package names, header names, network id, memo semantics, timeout, key types). All rights are reserved by default when no licence is present, so copying would have been a violation. |
| `hedera-dev/scaffold-hbar` | **MIT** | Compatible with Apache-2.0. No code copied. If any is adopted later, the MIT notice goes into `NOTICE`. |

Protocol facts are not copyrightable expression; implementations written from
scratch against them are ours. This position is recorded in `NOTICE` and in
`docs/architecture/REFERENCE_NOTES.md`.

Our licence: **Apache-2.0**, with the copyright placeholder filled in and a
`NOTICE` file stating the provenance position explicitly.

---

## 5. Production untouched — evidence

### 5.1 Observed state after the work

| Unit | State | Restarts |
|---|---|---|
| `nomos-preflight-c2r-observer.timer` (**T+72**) | active / enabled, last trigger 2026-07-22 19:07:52 CEST | — |
| `x402-v2.service` | active / enabled | **NRestarts=0** |
| `x402-gateway.service` | active / enabled | **NRestarts=0** |
| `nomos-preflight.service` | inactive / disabled (unchanged SAFEOFF) | 0 |
| `hederaoracle.service` | active / enabled, `ExecMainStart` still **2026-07-13 17:13:15 CEST** | 1 (pre-existing) |
| `receipts-api.service` | active / enabled | 0 |
| `nomos-a2a-receipt-binder.timer` | active / enabled | — |
| `nomos-revenue-reconciler.timer` | active / enabled | — |

The T+72 observation is running and undisturbed: `snapshots.jsonl` holds **673**
snapshots, the newest at `2026-07-22T17:12:53Z`, written by systemd on its own
5-minute schedule. That file's mtime advancing is the observer working, not this
work touching it.

### 5.2 What was created or modified outside the new repository

Exactly two files, both new, both reports:

* `/root/ops/HEDERA_NOMOS_X402_REUSE_ASSESSMENT_ADDENDUM_01_BOUNTY.md` (new)
* `/root/ops/HEDERA_NOMOS_X402_REUSE_ASSESSMENT.md` — one pointer banner added at
  the top so a reader of the original cannot miss the correction. No forensic
  content was altered.

A sweep of `/root/ops`, `/opt`, `/srv` and `/etc/systemd/system` for files
modified during the session found nothing else attributable to this work — only
the observer's own append and `uptime-kuma`'s own database, both systemd-driven.

**Not done:** no service started, stopped or restarted; no unit, timer or cron
changed; no production file edited; `/root/oraclenet/hedera_beacon.js` untouched;
`/srv/nomos/signing` never read; no wallet transaction; no testnet or mainnet
payment; no topic, token, account or contract created; no GitHub repo created;
no remote configured; nothing pushed.

### 5.3 Boundaries enforced in code, not just in prose

| Boundary | Enforcement | Test |
|---|---|---|
| Mainnet topic `0.0.10420280` and the three sibling OracleNet topics | `assertTopicAllowed()` throws `TopicBoundaryError` | `anchor.test.ts` |
| Production signing paths (`/srv/nomos/signing`, `/srv/nomos/verify`, `/opt/nomos-*`, `/root/.hedera-*`, the SEC-HEDERA-A1 quarantine) | `LocalEd25519Signer.fromFile()` refuses, including after `..` resolution | `receipt.test.ts` |
| Mainnet as a network value | JSON-Schema `const` — unrepresentable | `schemas.test.ts` |
| Payload content on-chain | anchor payload type has 5 fields, none content-bearing | `anchor.test.ts`, `flow.test.ts` |
| Committed secrets | `tools/secret-scan.ts`, ERROR class is never waivable | `secret-scan.test.ts` |

---

## 6. Open risks

| # | Risk | Severity | Handling |
|---|---|---|---|
| R1 | **~9 days to the deadline; CP-H2 is on the critical path** | 🔴 high | Real on-chain payment is a judging criterion, so CP-H2 cannot slip. Video + submission need a reserved day. |
| R2 | `@x402/hedera` API surface is unread | 🟡 medium | Interfaces were designed against documented protocol behaviour, not against the package. Some reshaping is likely; it is contained to one file because everything else talks to the interface. |
| R3 | Memo settability through the standard `accepts` entry is unconfirmed | 🟡 medium | If the scheme does not carry a memo, the binding moves to a different on-chain field or to a facilitator extension. The verifier reads the mirror node either way. |
| R4 | Mirror-node propagation delay after consensus | 🟡 medium | Bounded retry plus an explicit `PENDING` state; never deliver on `PENDING`. Budget to be measured, not guessed. |
| R5 | Testnet faucet limits / account resets | 🟢 low | Balance preflight at startup; per-call amount ~0.05 HBAR. |
| R6 | In-memory caps, replay guard and quote store | 🟢 low for a demo | A restart forgets state. Acceptable and documented; persistence is a CP-H8 nicety, not a correctness gap for a demo. |
| R7 | Mock artifacts being mistaken for real evidence | 🟢 low, actively guarded | `MOCK_OFFLINE` sits inside the *signed* record, the verifier surfaces it, the CLI prints a warning, and an e2e test fails if it silently changes. |
| R8 | USDC path unbuilt | 🟢 low | HBAR chosen (A2); the asset allowlist makes USDC a policy change if needed. |
| R9 | Commit identity | 🟢 low | Repo-local git identity is `NOMOS Governed x402 <contact@tooloracle.io>` — a published business address, not a personal one. Change it before the first push if a different attribution is wanted; rewriting history later is worse. |

---

## 7. Exit criteria

### CP-H0_COMPLETE ✅

* Bounty correction documented — `docs/evidence/BOUNTY_ADDENDUM.md`, and as a standalone addendum beside the original assessment
* Architecture decisions documented — §1.2 above, twelve decisions with rationale
* Production boundaries documented — `docs/SECURITY_BOUNDARIES.md`
* No production change — §5

### CP-H1_COMPLETE ✅

* Isolated git repository created — `/root/nomos-governed-x402-hedera`, `main`, local only
* Base structure present — 57 files across the agreed layout
* Schemas present — 8 versioned, TS source of truth + emitted JSON
* Hash and policy core implemented — canonicalization, caps, allowlists, replay, expiry
* Adapter interfaces present — payment adapter and HCS anchor
* Mock E2E flow succeeds — `tests/e2e/mock-flow.test.ts`
* All offline tests green — **199 / 199**
* Secret scan clean — 0 errors, 0 unwaived warnings
* No real transaction — 0 attempted
* No push — no remote configured

---

## 8. Scope for CP-H2 — exact

**Goal:** one real Hedera testnet x402 payment, independently verified, with a
HashScan link.

**In scope**

1. Add `@x402/hedera` (+ its `@hiero-ledger/sdk` peer). First and only runtime dependency.
2. Read the package's actual API and reconcile it with `HederaX402Adapter`; record any interface change in `REFERENCE_NOTES.md`.
3. Create a **fresh** testnet account via the Hedera portal faucet. Never `0.0.8509917`, never `0.0.10420279`.
4. Implement the real adapter: `verifyPayment`, `settlePayment`, `verifySettlementViaMirrorNode`.
5. Put `quote_id` in the transaction memo; confirm it is readable back from the mirror node.
6. Bounded-retry mirror-node polling with an explicit `PENDING` state.
7. Flip `settlement_evidence.source` from `MOCK_OFFLINE` to `MIRROR_NODE` on the real path only.
8. Minimal HTTP transport so the 402 handshake happens over the wire (`payment-required` → `payment-signature` → `payment-response`).
9. Isolated signer process: stdin = challenge, stdout = signature. The key never enters the agent.
10. Capture evidence into `docs/evidence/`: transaction id, HashScan URL, mirror-node JSON, and the resulting receipt.

**Out of scope for CP-H2:** HCS anchoring (CP-H7), the demo UI (CP-H8), USDC,
persistence, and the video.

**Exit criterion:** a signed proof-of-action receipt with
`settlement_source: "MIRROR_NODE"`, a `hedera_transaction_id` that resolves on
HashScan, and `node tools/verify-receipt.ts <receipt> <kid>=<pub>` printing
`VALID` with no mock warning.

**Production touch:** **none.** Same as CP-H0 and CP-H1.

**Before CP-H2 starts, one thing needs an operator decision:** creating a
testnet account and sending a real (test-value) transaction is the first action
in this project that leaves the machine. Everything up to here is inert.

---

# READY_FOR_CP_H2_HEDERA_TESTNET_PAYMENT
