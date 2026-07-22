# CP-H2 — Checkpoint Report

**Project:** NOMOS Governed x402 on Hedera — *From Proof of Payment to Proof of Action*
**Checkpoint:** CP-H2 — real Hedera testnet x402 payment
**Date:** 2026-07-22
**Repository:** `/root/nomos-governed-x402-hedera` (local git only, no remote, nothing pushed)

---

## 0. Executive verdict

**A real, governed x402 payment settled on Hedera testnet, and a signed
proof-of-action receipt binds it end to end.** The receipt verifies as `VALID`
under a standalone verifier with no mock warning.

Exactly **two** testnet transactions were made, both authorised: the
preparatory 1 HBAR funding transfer, and one x402 demo payment. No third.

One thing did not go to plan and it is the most instructive part of this report.
The payment succeeded on chain — correct amount, correct payee, correct memo —
and **my verifier rejected it**. `GET /transactions/{id}` returns every record
sharing that id, and Hedera auto-account creation adds two children; the code
read `transactions[0]`, which was a `CRYPTOUPDATEACCOUNT` with no memo and no
transfers. The gate failed in the safe direction — it refused to deliver rather
than deliver on unverified evidence — but it refused a *good* payment. Fixed,
regression-tested, and the receipt was then completed against the transaction
that actually settled, without re-paying.

---

## 1. The two authorised transactions

### 1.1 Preparatory funding (not an x402 payment)

| | |
|---|---|
| Transaction ID | `0.0.8509917@1784746678.979694179` |
| Result | **SUCCESS** |
| Type | `CRYPTOTRANSFER` |
| Consensus | `1784746682.606163597` |
| Memo | `CP-H2 demo payer funding` |
| Transfers | `0.0.8509917` **−100 135 164** tinybar · `0.0.9689846` **+100 000 000** tinybar |
| Fee | 135 164 tinybar, paid by the source |
| HashScan | `https://hashscan.io/testnet/transaction/0.0.8509917-1784746678-979694179` |
| Lock | `/root/ops/.cp_h2_funding_executed` (9 lines, unchanged) |

Executed by the operator via `cp_h2_fund_demo_payer_once.sh`. The memo proves
provenance: that string is hardwired in the script and appears nowhere else.

### 1.2 The x402 demo payment

| | |
|---|---|
| Transaction ID | **`0.0.7162784@1784746988.798231156`** |
| Result | **SUCCESS** |
| Type | `CRYPTOTRANSFER` (nonce 0) |
| Consensus timestamp | **`1784746993.237232768`** |
| **Memo** | **`q_6eb0be075ceaee4b92d86575`** — the quote id |
| Amount | **5 000 000 tinybar = 0.05 HBAR** |
| Payer | `0.0.9689846` |
| Payee | `0.0.9689904` (auto-created from the alias) |
| Fee | 276 517 tinybar, paid by the facilitator `0.0.7162784` |
| HashScan | `https://hashscan.io/testnet/transaction/0.0.7162784-1784746988-798231156` |
| Mirror | `https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1784746988-798231156` |

The transaction id belongs to the **fee payer**, because the facilitator submits
and pays the network fee. `payer` is the account actually debited, derived from
the ledger rather than taken from the facilitator's report.

**The memo is the point of the whole project.** Without it this transaction
would prove that 0.05 HBAR moved from one account to another. With it, it proves
that 0.05 HBAR paid for quote `q_6eb0be075ceaee4b92d86575`, which is bound to a
specific request hash, which is bound to a specific policy decision.

---

## 2. Accounts

| Role | Account | EVM alias | Balance after | Key |
|---|---|---|---|---|
| Funding source | `0.0.8509917` | `0x18672255…9875` | 999.62 HBAR | ECDSA (quarantined; **not touched again**) |
| Demo payer | **`0.0.9689846`** | `0xafe63adc38f1a28c57f7c2b9ebc03d1472e6003f` | **0.95 HBAR** | ECDSA `025da46e…4c17` |
| Demo payee | **`0.0.9689904`** | `0x98eca0a3f742ddc7791fc64b9cb2e226340607d5` | **0.05 HBAR** | hollow — never signed |
| Facilitator fee payer | `0.0.7162784` | — | — | third party (blocky402) |

### 2.1 Hollow-account completion — explicitly verified

The payer was created by the funding transfer as a **hollow account**: an
account id and an EVM alias, but **no key on the ledger**. Before the payment:

```
key._type : <NULL — hollow account>
```

After the payment:

```
key._type : ECDSA_SECP256K1
key.key   : 025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17
```

That value is byte-identical to the public key derived from
`.local/hedera-payer.key`. So the first correctly signed outgoing transaction
did use the matching local ECDSA key, and the network completed the account —
the `CRYPTOUPDATEACCOUNT` child record (nonce 1) in the transaction group *is*
that completion, observable on the public mirror node.

Balance moved 100 000 000 → 95 000 000 tinybar: exactly the 0.05 HBAR payment,
no fee, because the facilitator absorbed every fee including the payee's
69 129 520 tinybar account-creation cost.

The payee remains hollow, which is correct — it has never signed anything. Its
alias matches `.local/hedera-payee.key`, so it can be completed whenever needed.

---

## 3. Gates — all green before the submit

`node tools/preflight-check.ts` → **CLEAR**, 19 hard checks, 0 failures.

```
PASS  network_is_testnet                     hedera:testnet
PASS  mirror_is_testnet                      https://testnet.mirrornode.hedera.com/api/v1
PASS  hashscan_is_testnet                    https://hashscan.io/testnet
PASS  payee_not_production                   forbidden=0.0.10420279,0.0.8509917,0.0.10420310
PASS  payer_not_production                   payer=0.0.9689846
PASS  payer_and_payee_distinct
PASS  no_forbidden_topic_configured          CP-H2 sends no HCS message at all
PASS  amount_within_test_limit               5000000 tinybar (0.05 HBAR), cap 10000000
PASS  amount_is_small                        ≤ 1 HBAR of valueless testnet token
PASS  payer_key_present / mode_0600 / is_local
PASS  receipt_key_present / mode_0600
PASS  facilitator_supports_hedera_testnet    feePayer=0.0.7162784
PASS  payer_account_exists                   0.0.9689846 deleted=false
PASS  payer_funded                           100000000 tinybar ≥ 5000000
PASS  payee_reachable                        alias not yet created — auto-account creation
PASS  payee_alias_derivable                  derives from .local/hedera-payee.key
PASS  payee_key_mode_0600
```

### 3.1 The free `/verify` dry run — three unknowns settled at zero cost

```
POST https://api.testnet.blocky402.com/verify
HTTP 200
{"isValid":true,"payer":"0.0.9689846"}
```

with

```json
{ "scheme": "exact", "network": "hedera:testnet", "asset": "0.0.0",
  "amount": "5000000", "payTo": "0x98eca0a3f742ddc7791fc64b9cb2e226340607d5",
  "maxTimeoutSeconds": 180, "extra": { "feePayer": "0.0.7162784" } }
```

This resolved, empirically and for free, three things that had been inferences:

1. **The memo survives facilitator verification.** I had argued from the
   package's compiled `inspectHederaTransaction` that `hasNonTransferOperations`
   is `!(tx instanceof TransferTransaction)` and a memo is metadata, not an
   operation. `isValid: true` confirms it.
2. **A hollow payer is accepted.** `0.0.9689846` had no on-chain key, yet the
   facilitator's `verifyPayerSignature` resolved the payer correctly — it can
   derive the key from the alias.
3. **An alias payee is accepted.** The facilitator's `aliasPolicy` is not
   `reject`, and it absorbed the auto-creation fee.

Had any of these failed, no payment would have been submitted.

---

## 4. The failure, and why it matters

### 4.1 What happened

`--execute` submitted the payment. The chain accepted it. My verifier then
reported:

```
SETTLEMENT_UNVERIFIED:amount_mismatch
  atomic_amount "0"   payer "0.0.0"   memo null   finality FAILED
```

Delivery was refused, no service was executed, no receipt was written.

### 4.2 Why

`GET /transactions/{id}` returned **three** records, not one:

| # | name | nonce | memo | transfers |
|---|---|---|---|---|
| 0 | `CRYPTOUPDATEACCOUNT` | 1 | — | none |
| 1 | `CRYPTOCREATEACCOUNT` | 2 | — | fee only |
| **2** | **`CRYPTOTRANSFER`** | **0** | **`q_6eb0be075ceaee4b92d86575`** | **the payment** |

Auto-account creation emits children under the same transaction id — one
creating the payee, one completing the hollow payer — and on the live network
they sorted *ahead* of the transfer. `fetchTransaction` took `transactions[0]`.

Every downstream check then compared against a record with no memo and no user
transfers, so it reported a mismatch against a payment that was in fact perfect.

### 4.3 What this says about the design

The gate failed **closed**. Faced with evidence it could not verify, it refused
to release work rather than releasing it on the facilitator's word — which is
exactly the ordering rule this project exists to enforce, and the opposite of
the reference implementation's documented v1 behaviour.

That is the right failure direction, and it is worth more than a clean first
run would have been: the ordering rule was tested by an actual disagreement
between two sources of truth, not by a unit test.

It also produced, briefly, the exact state the project is built to make
impossible — a paid request with no receipt. Which is why the fix has two parts.

### 4.4 The fix

**`selectUserTransaction`** (`packages/hedera-x402-adapter/src/mirror.ts`) picks
the `CRYPTOTRANSFER` with nonce 0, then any nonce-0 record, then any
`CRYPTOTRANSFER`, and returns `null` rather than guessing.

**`tests/unit/child-records.test.ts`** — 9 regression tests built on the actual
three-record response from this transaction, including one that asserts the old
behaviour would have produced exactly the observed failure, and one that checks
the facilitator's fee row is not mistaken for the payer.

**`tools/complete-settlement.ts`** — replays the deterministic tail of the flow
(verify → execute → hash → sign) against a settlement that already happened. It
makes no payment, contacts no facilitator for settlement, and is hardwired to
`dryRun: true` so it cannot reach `/settle`. Re-paying to produce evidence would
have been both wasteful and dishonest: the second payment would not be the one
the receipt describes.

---

## 5. Proof-of-action receipt

```
receipt_id     : poa_60a1c2220acb7ef835dcdca8
record_digest  : sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9
signature kid  : nomos-gx402-demo-ed25519-1
verdict        : VALID
mock settlement: no
```

Redacted record (complete; nothing is omitted except that hashes stand in for
content, which is the design):

```jsonc
{
  "schema": "nomos.gx402.proof_of_action_receipt.v1",
  "receipt_version": "v1",
  "receipt_id": "poa_60a1c2220acb7ef835dcdca8",
  "record": {
    "agent_identity":  { "did": "did:nomos:gx402-demo-agent", "key_type": "Ed25519",
                         "public_key_hex": "bbbb…bbbb", "label": "cp-h2-buyer" },
    "authority_scope": { "scopes": ["evidence:read"],
                         "granted_by": "did:nomos:gx402-demo-operator",
                         "valid_until": "2026-07-23T19:03:11Z" },
    "service_identity": { "service_id": "nomos-gx402-evidence",
                          "resource_url": "http://127.0.0.1:4402/v1/evidence",
                          "http_method": "POST" },
    "offer_id": "evidence.basic.v1",

    "policy_decision": "ALLOW",
    "policy_version": "nomos-gx402-demo-1.0.0",
    "policy_hash": "sha256:aea1ba25f1ef3f8aa35e5badab77c869f5205571371f73328fe35da3e1fc9efd",
    "decision_id": "ppd_0ede8b56a28eaa786ec4796a",

    "request_hash": "sha256:c7dc3cdf13eeff7c42274882bb3245c073ca0adad736a49d83ddb80f78b9bbac",
    "quote_id": "q_6eb0be075ceaee4b92d86575",
    "quote_hash": "sha256:5155f479779d6c59956c709ea548f6e0efb6b5dde24ea6a0c897d8914b981aa2",
    "idempotency_key": "idem_528bc5d663e7d4dbf8a55699f0746492",
    "nonce": "n_mrwga0d4mklhhizt",

    "network": "hedera:testnet",
    "asset": "HBAR",
    "atomic_amount": "5000000",
    "payer": "0.0.9689846",
    "payee": "0.0.9689904",

    "hedera_transaction_id": "0.0.7162784@1784746988.798231156",
    "consensus_timestamp": "1784746993.237232768",
    "settlement_source": "MIRROR_NODE",
    "settlement_finality": "FINAL",

    "execution_status": "SUCCEEDED",
    "delivery_status": "DELIVERED",
    "result_hash": "sha256:3b7962cf05770f754f3966144ce99b3dc68c302977be6c3886fe51bb45210c8f",
    "refund_due": false,

    "receipt_timestamp": "2026-07-22T19:08:11Z",
    "environment": "TESTNET_DEMO_ONLY",
    "disclaimer": "Demo artifact on Hedera testnet. Not a certification…"
  },
  "record_digest": "sha256:2bf595c1…ecdb9",
  "signature": { "alg": "Ed25519", "kid": "nomos-gx402-demo-ed25519-1",
                 "signature_domain": "NOMOS_GX402_PROOF_OF_ACTION_V1",
                 "canonicalization": "RFC8785-JCS/nomos-int-only-v1",
                 "public_key_hex": "593ad93f…21e9", "signature": "<base64>" },
  "anchor": null,
  "verification": { "hashscan_transaction_url": "https://hashscan.io/testnet/transaction/0.0.7162784-1784746988-798231156",
                    "mirror_transaction_url": "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1784746988-798231156" }
}
```

`anchor: null` — CP-H2 sends no HCS message. That is a requirement, not an
omission, and the receipt is fully valid without one.

Files: `docs/evidence/cp-h2/{receipt,result,settlement,execute-run,dry-run}.json`

---

## 6. Verification results

| # | Check | Result |
|---|---|---|
| 1 | **Mirror node** — transaction indexed, `result=SUCCESS` | ✅ |
| 2 | **Memo** — equals `quote_id` | ✅ `q_6eb0be075ceaee4b92d86575` |
| 3 | **Amount** — payee credited exactly the quoted amount | ✅ 5 000 000 tinybar |
| 4 | **Payee** — alias resolved, `evm_address` matches the alias | ✅ `0x98eca0…07d5` → `0.0.9689904` |
| 5 | **Payer** — derived from the ledger, not the facilitator's report | ✅ `0.0.9689846`, not the fee payer |
| 6 | **Request replay** — recomputed hash matches the quote | ✅ |
| 7 | **Policy replay** — recomputed policy hash matches the decision | ✅ |
| 8 | **Result hash** — recomputed from a fresh execution | ✅ `sha256:3b7962cf…0c8f` |
| 9 | **Receipt** — standalone verifier, caller-supplied key set | ✅ `VALID`, no mock warning |
| 10 | **Tamper probe** — `atomic_amount` 5000000 → 1 | ✅ `INVALID`: `record_digest_mismatch`, `signature_invalid` |
| 11 | **Replay** — same `(network, transaction_id)` presented twice | ✅ key `54c8b754…383e`: 1st `fresh`, 2nd `consumed`, reclaim throws `REPLAY_DETECTED` |
| 12 | **Hollow-account completion** | ✅ `key: null` → `ECDSA_SECP256K1 025da46e…4c17` = local key |
| 13 | **HashScan** | ⚠️ see below |

### 6.1 HashScan — an honest note

`curl` returns **404 for every hashscan.io URL**, including the site root and
`/testnet/dashboard`. HashScan is a client-rendered application that serves 404
to non-browser clients; this is not evidence that the links are broken, and it
is not evidence that they work either. I cannot mechanically confirm them and
will not claim otherwise.

What *is* mechanically confirmed is the underlying data, from the public mirror
node that HashScan itself reads — the transaction, both accounts, the transfers,
the memo and the consensus timestamp are all verified above. The HashScan links
should be checked in a browser before any submission relies on them.

### 6.2 Receipt re-assembly is not idempotent — by design

Running `complete-settlement` twice produced two valid receipts with different
digests (`poa_09f572ad…` and `poa_60a1c222…`). The cause is `receipt_timestamp`,
which honestly records when the receipt was assembled. Both are valid receipts
for the same settlement; they differ in when they were written, not in what they
attest.

I found this by re-running the tool, which overwrote the first receipt. The
canonical artifact is therefore `poa_60a1c2220acb7ef835dcdca8`. A `RECEIPT_EXISTS`
guard now refuses to overwrite an existing receipt without `--force`, so a
published digest cannot be silently invalidated again.

---

## 7. Tests, scan, dependencies

```
$ npm test
# tests 250   # pass 250   # fail 0
```

New since the last report: `tests/unit/child-records.test.ts` (9, the
regression) and `tests/unit/alias-payee.test.ts` (16, the auto-account-creation
path).

```
$ npm run scan
secret-scan: 73 files scanned, 0 errors, 0 unwaived warnings — CLEAN
```

| | |
|---|---|
| Node | v22.23.0 |
| `@x402/hedera` | 2.19.0 |
| `@x402/core` | 2.19.0 |
| `@hiero-ledger/sdk` | 2.85.0 (transitive) |
| Offline core dependencies | still **0** — no test imports the SDK |

---

## 8. Boundaries observed

| Prohibited | Observed |
|---|---|
| Further funding transfers | none — lock file untouched, 9 lines |
| More than one x402 payment | **exactly one** |
| Mainnet / previewnet | never contacted; unrepresentable in the schema |
| Production changes, service restarts | none — `NRestarts=0` throughout |
| T+72 observer changes | untouched; 696 snapshots, own schedule |
| Access to the quarantined key | **none** — mtime still 2026-06-12 09:07:45 |
| Secret output | none; only public keys and account ids appear anywhere |
| GitHub push / remote | no remote configured |
| HCS message | none; `anchor: null` |

Production state after the work: `x402-v2` and `x402-gateway` active/enabled
with `NRestarts=0`, `nomos-preflight` inactive/disabled (unchanged SAFEOFF),
`hederaoracle` unchanged since 2026-07-13.

---

## 9. Evidence index

| Artifact | Location |
|---|---|
| Proof-of-action receipt | `docs/evidence/cp-h2/receipt.json` |
| Delivered result + hash | `docs/evidence/cp-h2/result.json` |
| Settlement + delivery + verification | `docs/evidence/cp-h2/settlement.json` |
| Execute run (incl. the failure) | `docs/evidence/cp-h2/execute-run.json` |
| Dry run | `docs/evidence/cp-h2/dry-run.json` |
| Funding lock | `/root/ops/.cp_h2_funding_executed` |
| Funding script + worker | `/root/ops/cp_h2_fund_demo_payer_once.{sh,mjs}` |

Independent verification, runnable by anyone:

```bash
node tools/verify-receipt.ts docs/evidence/cp-h2/receipt.json \
  nomos-gx402-demo-ed25519-1=593ad93fa6ebbdabada18f9be12f391b32c5d2c487080d8d79f156c943ea21e9
```

```bash
curl -s https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1784746988-798231156
```

---

## 10. Open scope

1. **HCS anchoring (CP-H7).** Not a bounty requirement, but "how well the build
   uses Hedera rails" is a judging criterion and HCS is exactly that. The
   interface, payload schema and topic denylist already exist.
2. **Demo UI (CP-H8)** and the **video**, which the bounty does require.
3. **Persistence.** Caps, replay keys and the quote store are in memory. Fine
   for a demo; state it rather than imply otherwise.
4. **The 402 loop end to end in one process.** The payment settled, but the
   receipt was assembled by a second tool. Worth closing so a single
   `run-payment --execute` produces the receipt directly — the bug that forced
   the split is fixed, so this is now just a re-run on a future payment.
5. **HashScan links** to be confirmed in a browser before submission.

---

# PASS_CP_H2_X402_DEMO_COMPLETE
