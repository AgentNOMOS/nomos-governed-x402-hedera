# CP-H2 — Checkpoint Report

**Project:** NOMOS Governed x402 on Hedera
**Checkpoint:** CP-H2 — real Hedera testnet x402 payment
**Date:** 2026-07-22
**Repository:** `/root/nomos-governed-x402-hedera` (local git only, no remote, nothing pushed)

---

## 0. Executive summary — read this first

**The CP-H2 implementation is complete. No payment was made, and none was attempted.**

Everything the checkpoint required has been built and tested: the memo-binding
Hedera signer, the real facilitator client, the independent mirror-node
settlement verifier, the HTTP resource server serving a genuine 402, the
isolated signer process, the pre-transaction safety gate, and the one-shot
payment runner with a dry-run default and a one-payment lock. 225 offline tests
pass and the secret scan is clean.

The run is blocked at exactly one point: **funding the demo account.**
`https://portal.hedera.com/faucet` is protected by reCAPTCHA. That control
exists to keep automation out, so I did not attempt to work around it, look for
an unguarded endpoint behind it, or use any third-party service to obtain
testnet HBAR by another route.

Two fresh keypairs were generated locally (mode 0600, git-ignored) and their
public EVM addresses are below. **A human pasting those two addresses into the
faucet is the only outstanding step.** After that, the remaining sequence is
three commands and needs no further decisions.

Because no transaction reached the network, this report ends with the blocked
status. That is a statement about the faucet, not about the implementation.

---

## 1. What was authorised, and what was done with it

| Authorised | Status |
|---|---|
| A new demo-only Hedera testnet account | ⏸ **keypairs generated locally; accounts not yet created** — the faucet creates them |
| Newly generated local demo keys | ✅ done — payer, payee, receipt signer; all `.local/*.key`, mode 0600, git-ignored |
| Funding solely with valueless faucet testnet tokens | ⏸ **blocked — reCAPTCHA** |
| HBAR as the payment asset | ✅ implemented and pinned (`asset: "0.0.0"`, amounts in tinybars) |
| Implementation of the Hedera-native x402 exact flow | ✅ done, against `@x402/hedera` 2.19.0 |
| Exactly one successful real testnet payment | ⏸ **zero attempted**, enforced by a one-payment lock |
| Public read-only verification via mirror node and HashScan | ✅ implemented; mirror node exercised read-only during preflight |
| Storage of non-secret evidence only | ✅ — evidence files hold account ids, amounts, hashes, links; no key material |
| Offline negative tests for mismatch and replay | ✅ 26 new offline tests, 225 total |

| Prohibited | Observed |
|---|---|
| Mainnet or previewnet | never contacted; `hedera:mainnet` is unrepresentable in the schema |
| Real-value money or tokens | none; nothing was funded at all |
| USDC in this checkpoint | not implemented, not configured |
| Existing accounts, topics, old or quarantined keys | none read, none referenced except in denylists |
| Reading or using `/srv/nomos/signing` | never opened; refused in code by two independent loaders |
| Topic `0.0.10420280` or related production topics | never used; on the hard denylist |
| Changing production files, services, units, timers, cron | none — see §8 |
| Sending an HCS message | none; anchoring is hard-disabled in the CP-H2 HTTP path (`anchor: false`) |
| Creating a GitHub remote or pushing | no remote configured, nothing pushed |
| More than one successful payment | zero payments; a lock file blocks a second `--execute` |
| Secrets in logs, reports, receipts or git | none — see §7 |

---

## 2. Public testnet identifiers

### 2.1 Generated for this demo (public material only)

| Role | EVM address (public) | Public key (hex) | Account id |
|---|---|---|---|
| **payer** | `0xafe63adc38f1a28c57f7c2b9ebc03d1472e6003f` | `025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17` | **not yet created — awaiting faucet** |
| **payee** | `0x98eca0a3f742ddc7791fc64b9cb2e226340607d5` | `03c823e879272077478ccb0098b01bd4b96401938d5cf7de23382b89b2f244f6b2` | **not yet created — awaiting faucet** |

Both are ECDSA secp256k1, chosen because the faucet's auto-account-creation
flow keys off an EVM address, which only an ECDSA key has. Private keys are in
`.local/hedera-{payer,payee}.key`, mode 0600, git-ignored, and were never
printed by any tool.

Receipt-signing key (a different key with no on-chain authority):

| | |
|---|---|
| kid | `nomos-gx402-demo-ed25519-1` |
| public key | `593ad93fa6ebbdabada18f9be12f391b32c5d2c487080d8d79f156c943ea21e9` |
| private key | `.local/receipt-signer.key`, mode 0600, git-ignored |

### 2.2 Third-party, verified live and read-only

| | |
|---|---|
| Facilitator | `https://api.testnet.blocky402.com` — `GET /health` → `200 {"status":"ok","version":"1.0.0"}` |
| Advertised kind | `{"x402Version":2,"scheme":"exact","network":"hedera:testnet","extra":{"feePayer":"0.0.7162784"}}` |
| Fee payer | **`0.0.7162784`** — the facilitator pays the network fee; our payer only funds the transfer |
| Mirror node | `https://testnet.mirrornode.hedera.com/api/v1` — `GET /network/nodes` → 200 |

### 2.3 Payment parameters, pre-configured

| | |
|---|---|
| Network | `hedera:testnet` |
| Asset | HBAR (`0.0.0` in x402 terms) |
| Atomic amount | **5 000 000 tinybar = 0.05 HBAR** (valueless testnet token) |
| Per-payment cap | 10 000 000 tinybar (0.1 HBAR) |
| Cumulative cap | 200 000 000 tinybar (2 HBAR) |
| Quote TTL | 180 s, matching the scheme's `maxTimeoutSeconds` |
| Memo | the `quote_id` verbatim (26 ASCII chars, limit 100 bytes) |

### 2.4 Fields that a completed run will fill

Empty on purpose. Inventing plausible values would defeat the point of the report.

| Field | Value |
|---|---|
| Hedera transaction id | *(pending)* |
| Consensus timestamp | *(pending)* |
| HashScan link | *(pending)* |
| Mirror-node verification | *(pending)* |
| Receipt id / record digest | *(pending)* |
| Request / quote / result hashes | *(pending)* |
| Redacted proof-of-action receipt | *(pending)* |

---

## 3. What was built

| File | Purpose | Lines |
|---|---|---:|
| `packages/hedera-x402-adapter/src/hedera-signer.ts` | Memo-binding client signer — the only file that touches a payer key | 173 |
| `packages/hedera-x402-adapter/src/mirror.ts` | Mirror-node client: bounded-retry lookup, memo decode, net-transfer maths | 176 |
| `packages/hedera-x402-adapter/src/real-adapter.ts` | Facilitator verify/settle + independent settlement verification | 341 |
| `services/agent-client/src/signer-process.ts` | Isolated signer: stdin = challenge, stdout = signature | 121 |
| `services/resource-server/src/http-server.ts` | Real HTTP 402 with `payment-required` / `payment-signature` / `payment-response` | 217 |
| `tools/hedera-keygen.ts` | Local ECDSA keypair generation; prints public material only | 63 |
| `tools/resolve-account.ts` | EVM address → account id via mirror node, read-only | 62 |
| `tools/setup-env.ts` | Writes `.env` once both accounts exist; refuses a half-configured state | 96 |
| `tools/preflight-check.ts` | 17-point pre-transaction gate, read-only | 187 |
| `tools/run-payment.ts` | The run. Dry run by default, `--execute` for the single real payment | 293 |
| `tools/load-config.ts` | `.env` loader with a redacted `describe()` for reports | 129 |
| `tests/unit/real-adapter.test.ts` | 26 offline tests, `fetch` stubbed | 336 |

### 3.1 The design decision that mattered

`@x402/hedera` has no concept of a transaction memo — I confirmed this by
grepping the published package for `setTransactionMemo`, `TransactionMemo` and
`memo`: **zero matches**. Its default `createClientHederaSigner` builds the
transfer, sets the transaction id to the fee payer, freezes and signs.

Without a memo the resulting on-chain artifact proves only that *some* account
sent *some* amount to *our* account. It does not prove which request that
payment was for. That is precisely the gap between proof of payment and proof of
action, so this project cannot use the default signer.

`createMemoBindingHederaSigner` reproduces the default construction exactly —
same transfer pair, same fee-payer-owned transaction id, same freeze-then-sign
order — and adds `tx.setTransactionMemo(quoteId)`.

That this survives facilitator verification is not an assumption. Reading the
package's compiled `inspectHederaTransaction`, `hasNonTransferOperations` is
computed as `!(tx instanceof TransferTransaction)`. A memo is transaction
metadata, not an operation, so a memo-carrying TransferTransaction remains a
TransferTransaction. The facilitator's other checks — transfer amounts, the
payer's signature over the frozen body, the pre-settlement balance preflight —
are all indifferent to a memo. **This remains an inference from source until a
real `/verify` call confirms it; the dry run exists to confirm exactly that, at
zero cost, before any settlement.**

### 3.2 Delivery ordering, restated in real terms

`settlePayment` returning `{settled: true}` is the facilitator's assertion about
its own work. `verifySettlementViaMirrorNode` is the only thing here that
constitutes evidence, and it is what gates delivery. It checks six things
against the *quote*, not against the facilitator's report:

1. the transaction is indexed and its consensus result is `SUCCESS`
2. the payee was credited **exactly** the quoted amount
3. a payer was debited at least that amount — the payer is derived from the
   ledger, not taken from the facilitator's `payer` field
4. the asset matches
5. the network is testnet
6. **the memo equals the quote id**

An unindexed transaction yields `PENDING`, never `FAILED` and never verified —
and `PENDING` never delivers.

---

## 4. Test results

```
$ npm test
# tests 225
# suites 53
# pass 225
# fail 0
# duration_ms 268
```

New in CP-H2 — `tests/unit/real-adapter.test.ts`, 26 tests, all offline with a
stubbed `fetch`:

| Group | Tests | What it pins |
|---|---:|---|
| Payment requirements mapping | 3 | HBAR → `0.0.0`; HTS passthrough; a non-testnet quote cannot produce requirements at all |
| Payment header encoding | 2 | base64-JSON round-trip; garbage fails loudly rather than yielding `{}` |
| Facilitator discovery | 3 | picks the hedera:testnet fee payer; refuses when absent; refuses a malformed one rather than handing it to a signer |
| Mirror helpers | 6 | id conversion; malformed id throws instead of building a wrong URL; memo decode incl. empty → `null`; **net movement sums all rows for an account**; token filtering |
| Propagation | 3 | retries while the index lags then succeeds; budget exhaustion returns `null` not an error; a non-404 surfaces immediately instead of burning 11 retries |
| Settlement verification | 8 | correct transfer → FINAL + `MIRROR_NODE`; short payment; transfer to the wrong account; **no memo**; someone else's quote id in the memo; consensus failure; unindexed → PENDING; mainnet refused *without any lookup* |
| Dry run | 1 | `/settle` is never contacted |

Secret scan:

```
$ npm run scan
secret-scan: 71 files scanned
  (35 WARN finding(s) waived by tools/secret-scan.allow.json)
secret-scan: CLEAN
```

0 errors, 0 unwaived warnings. Five new waivers were added, each for a file that
contains a production identifier **in order to block it**: the isolated signer's
`FORBIDDEN_KEY_PREFIXES` and the preflight gate's `FORBIDDEN_ACCOUNTS`. A test
asserts waivers cannot spread beyond denylists, tests of denylists, and docs.

### 4.1 Live read-only checks performed

| Check | Result |
|---|---|
| `GET /health` (facilitator) | 200, `{"status":"ok"}` |
| `GET /supported` (facilitator) | 200, advertises `exact` on `hedera:testnet`, feePayer `0.0.7162784` |
| `GET /network/nodes` (mirror) | 200 |
| `GET /accounts/0xafe6…003f` | 404 — payer not yet created |
| `GET /accounts/0x98ec…07d5` | 404 — payee not yet created |

No POST was sent to the facilitator. No transaction was signed for submission.

### 4.2 The gates fired correctly

Both fail-closed paths were exercised and behaved as designed:

```
$ node tools/setup-env.ts
setup-env: payer account not found for 0xafe63adc38f1a28c57f7c2b9ebc03d1472e6003f
  → fund it at https://portal.hedera.com/faucet (testnet, valueless tokens)

$ node tools/preflight-check.ts
preflight: cannot load configuration — missing configuration: NOMOS_GX402_PAY_TO
copy .env.example to .env and fill in the demo account ids.
```

No `.env` exists, so `run-payment.ts` cannot start in either mode. The system
refuses to attempt a payment it is not configured for, rather than attempting
one and failing on-chain — which would have consumed the single-payment budget.

---

## 5. The blocker

**Hedera testnet HBAR cannot be obtained without a human.**

| Route | Status |
|---|---|
| `https://portal.hedera.com/faucet` | reachable (200), but the page loads **reCAPTCHA** |
| `https://faucet.testnet.hedera.com/api/account` (used by a 2026-04 script in the legacy estate) | **DNS no longer resolves** — the endpoint is gone |
| Portal API keys / Personal Access Tokens | require a portal account, i.e. an interactive sign-up |
| Auto-account creation by transferring to an alias | needs an already-funded sender — circular |

reCAPTCHA is an anti-automation control. Circumventing it, or hunting for an
unguarded endpoint behind it, is not something I will do for a convenience —
and a solved captcha is not evidence of anything a reviewer would value. The
correct move is to ask.

### What is needed — two paste actions

1. Open **https://portal.hedera.com/faucet**
2. Paste **`0xafe63adc38f1a28c57f7c2b9ebc03d1472e6003f`** (payer) → claim
3. Paste **`0x98eca0a3f742ddc7791fc64b9cb2e226340607d5`** (payee) → claim

The faucet auto-creates a Hedera account for each address. The default claim is
ample: the demo needs 0.05 HBAR of the ~100 available, and the facilitator pays
the network fee. Both tokens are testnet tokens with no economic value.

### What happens after, without further decisions

```bash
node tools/setup-env.ts        # resolves both account ids, writes .env (0600)
node tools/preflight-check.ts  # 17 checks, read-only, must print CLEAR
node tools/run-payment.ts      # DRY RUN — signs for real, facilitator verifies,
                               #   stops before /settle. Nothing moves.
node tools/run-payment.ts --execute   # the single authorised payment
```

`--execute` refuses if `.local/PAYMENT_EXECUTED` exists, so the one-payment
authorisation is enforced by the code and not only by intent.

---

## 6. Safety architecture actually in place

| Control | Mechanism | Where |
|---|---|---|
| Dry run is the default | `--execute` must be typed; a dry run still builds, signs and has the facilitator verify — it just never calls `/settle` | `run-payment.ts` |
| Exactly one payment | `.local/PAYMENT_EXECUTED` written on success, checked before any execute | `run-payment.ts` |
| Testnet, asserted three times | config, adapter, signer — independently | `load-config.ts`, `real-adapter.ts`, `hedera-signer.ts` |
| Mainnet unrepresentable | JSON-Schema `const` on `network` | `schemas.ts` |
| Key isolation | signing happens in a child process; stdin = challenge, stdout = signature | `signer-process.ts` |
| Production key paths refused | `FORBIDDEN_KEY_PREFIXES` in two independent loaders, incl. after `..` resolution | `signer.ts`, `signer-process.ts` |
| Production accounts refused | `FORBIDDEN_ACCOUNTS` = `0.0.10420279`, `0.0.8509917`, `0.0.10420310` | `preflight-check.ts` |
| Production topics refused | `FORBIDDEN_TOPIC_IDS`, incl. `0.0.10420280` | `hcs-anchor/interfaces.ts` |
| No HCS message in CP-H2 | `anchor: false` hard-coded in the HTTP path | `http-server.ts` |
| Amount ceiling | preflight rejects above the per-payment cap *and* above 1 HBAR outright | `preflight-check.ts` |
| Payer ≠ payee | preflight check — a self-payment proves nothing about a transfer | `preflight-check.ts` |
| Key file hygiene | preflight asserts mode 0600 and a `.local/` path | `preflight-check.ts` |
| No secrets in output | `describe()` redacts; `parsePayerKey` never echoes its input; keygen prints public material only | throughout |

---

## 7. Secrets

Three private keys exist on disk, all created today, all local:

```
.local/hedera-payer.key      -rw------- 101 bytes
.local/hedera-payee.key      -rw------- 101 bytes
.local/receipt-signer.key    -rw------- 119 bytes
```

`.gitignore` excludes `.local/` explicitly and `*.key` generically; `git
check-ignore` confirms both rules match, and `git status` shows zero `.local`
entries. No key value appears in this report, in any evidence file, in any log
line, in any test fixture, or in the repository. The only key-derived values
published anywhere are public keys and EVM addresses, which are public by
construction.

`npm run scan` reports **0 ERROR-class findings** across 71 files.

---

## 8. Production untouched

| Unit | State | Restarts |
|---|---|---|
| `nomos-preflight-c2r-observer.timer` (**T+72**) | active / enabled | — |
| `x402-v2.service` | active / enabled | 0 |
| `x402-gateway.service` | active / enabled | 0 |
| `nomos-preflight.service` | inactive / disabled (unchanged SAFEOFF) | 0 |
| `hederaoracle.service` | active / enabled, start time unchanged | 1 (pre-existing) |
| `receipts-api.service` | active / enabled | 0 |

Not done: no service started, stopped or restarted; no unit, timer or cron
touched; no production file edited; `/root/oraclenet/hedera_beacon.js` untouched;
`/srv/nomos/signing` never opened; no mainnet request of any kind; no HCS
message; no GitHub remote; nothing pushed.

Everything created by this checkpoint lives under
`/root/nomos-governed-x402-hedera`, plus `node_modules/` (git-ignored) from the
single `npm install` of `@x402/hedera` and `@x402/core`.

The T+72 observation continued undisturbed throughout — its snapshot file
advances on its own systemd schedule, which is the observer working rather than
this work touching it.

---

## 9. Open scope for CP-H3

CP-H3 in the original plan was the policy and spend gate. **That work is already
done** — it shipped in CP-H1 and is wired into the real path here, with caps
enforced before any payment and a fail-closed replay guard. So CP-H3 is
re-scoped to what actually remains:

1. **Complete this checkpoint.** Fund, dry-run, execute once, capture evidence,
   fill §2.4 of this report. Nothing else should start before that.
2. **Idempotency and replay against a real transaction.** The offline tests
   cover both; a live re-presentation of the same settled transaction should be
   demonstrated once, for the record.
3. **Persistence.** Caps, replay keys and the quote store are in memory. A
   restart forgets them. Acceptable for a demo, not for a claim.
4. **CP-H7 decision.** HCS anchoring is not a bounty requirement, but "how well
   the build uses Hedera rails" is a judging criterion and HCS is exactly that.
   Worth building if the schedule allows after the payment is verified.

**Production touch for CP-H3: none.** Unchanged from every checkpoint so far.

---

## 10. Verdict

The implementation satisfies every technical success criterion that can be
satisfied without funds. The criteria that require a real transaction —
transaction id, consensus timestamp, HashScan link, mirror-node verification, a
receipt whose verifier reports VALID with no mock warning — are **not met**,
because no payment was made.

No transaction was attempted. The single-payment budget is intact and the
one-payment lock has never been written.

---

# CP_H2_BLOCKED_NO_PAYMENT_OR_SINGLE_FAILED_ATTEMPT
