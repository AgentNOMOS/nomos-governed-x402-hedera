# CP-H7D — topic decision lock

**Status: `CP_H7_TOPIC_DECISION_LOCKED_AWAITING_GRANT_A`**
Date: 2026-07-23 · No Hedera transaction was built, frozen, signed or sent.

Base: CP-H7 at `53c0699`. The operator's decision is now expressed as code,
tests and two separate grant documents rather than as a proposal.

---

## 1. Final `TopicCreate` configuration

Frozen in `packages/hcs-anchor/src/topic-config.ts`. Not read from the
environment, not derived, not defaulted.

```json
{
  "schema": "nomos.gx402.hcs_topic_config.v1",
  "network": "hedera:testnet",
  "payer_account_id": "0.0.9689846",
  "memo": "NOMOS CP-H7 PoA anchor v2 | TESTNET_DEMO_ONLY | poa_60a1c2220acb7ef835dcdca8",
  "memo_bytes": 76,
  "admin_key": null,
  "submit_key": {
    "type": "ECDSA_SECP256K1",
    "public_key": "025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17"
  },
  "auto_renew_account_id": "0.0.9689846",
  "auto_renew_period_seconds": 8000001,
  "max_transaction_fee_tinybar": "50000000"
}
```

Memo verified at **exactly 76 UTF-8 bytes** (76 characters, ASCII-only, protocol
limit 100). The byte count is declared in the configuration and re-derived on
every validation, so a memo edit that keeps the declared count fails closed. A
test covers the multi-byte case specifically: 76 characters of `ü` is 152 bytes,
and declaring 76 for it is refused.

`admin_key` is `null` **and the field must be present**. A missing field and an
explicit null are different states, and only one of them proves the author
considered the question.

## 2. Submit public key — verified from both sides

```
mirror node, account 0.0.9689846 key : 025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17
derived from .local/hedera-payer.key : 025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17
EXACT MATCH                          : true
DER form                             : 302d300706052b8104000a032200025da46e…4c17
EVM address                          : 0xafe63adc38f1a28c57f7c2b9ebc03d1472e6003f
```

No new key was generated. The private key was read only far enough to take its
public half, and nothing derived from the secret appears here or in any tool
output. The guard blocks with `SUBMIT_KEY_MISMATCH` if these ever diverge — a
topic whose submit key we cannot sign for would be permanently unwritable, and
without an admin key that could not be repaired.

## 3. Canonical configuration digest

```
canonical bytes : 460
digest          : sha256:42ee4d26dd74a13d1f58c9d72978580db16ecc55a8da6f1bd530aed85e650f6b
```

This is the value Grant A binds to. Changing the memo by one character, the
auto-renew period by one second, or the submit key at all moves the digest and
the grant stops applying. Hashing the configuration is stronger than restating
its fields in the grant, because it cannot be partially restated.

## 4. Grant A and Grant B

Two documents, two magic strings, two tools. A Grant B document does not parse as
a Grant A and vice versa — asserted by test, because a separation that only
exists in prose is decorative.

### GRANT A — `.local/HCS_TOPIC_CREATE_AUTHORIZED`

```
grant                       NOMOS_GX402_CP_H7_TOPIC_CREATE_GRANT_V1
network                     hedera:testnet
payer_account_id            0.0.9689846
topic_config                the full configuration, embedded
topic_config_digest         sha256:…  (must reproduce from topic_config
                                       AND equal the digest of the source config)
max_transaction_fee_tinybar 50000000            (0.50 HBAR)
expires_at                  UTC, at most 30 minutes ahead
```

Both digest checks exist for different attacks: reproducing the digest from the
embedded config catches a hand-edited grant; comparing it to the source config
catches a grant that approved something else entirely.

### GRANT B — `.local/HCS_ANCHOR_AUTHORIZED`

Writable **only after** a confirmed read-back. `topic_id: "CREATE"` was removed
from the grant language entirely — creating a topic is Grant A's business.

```
grant                       NOMOS_GX402_CP_H7_ANCHOR_SUBMIT_GRANT_V2
network                     hedera:testnet
topic_id                    the real 0.0.x, never a placeholder
receipt_id                  poa_60a1c2220acb7ef835dcdca8
record_digest               sha256:2bf595c1…f71ecdb9
anchor_key                  anc_cd5991bdb525e4662dc6f050
envelope_created_at         pinned — see below
envelope_sha256             SHA-256 of the exact 585 canonical bytes
envelope_bytes              585
max_transaction_fee_tinybar 2000000             (0.02 HBAR)
expires_at                  UTC, at most 30 minutes ahead
```

**Why `envelope_created_at` is pinned.** The grant approves a digest of exact
bytes, and `created_at` is the only envelope field that would otherwise move
between approval and submission — which would make the approved digest
unmatchable by construction. So the emission pins it, and the submit tool rebuilds
the envelope at that instant rather than at "now". That is what turns "these bytes
and no others" into something a guard can check. One emission, one grant window.

## 5. Dry-run results

Neither tool built a transaction. Neither loaded the Hedera SDK.

```
topic:dryrun
  memo bytes       : 76 (declared 76)
  config digest    : sha256:42ee4d26…650f6b
  submit key check : MATCHES the configured submit key
  existing topics  : 0
  verdict          : BLOCKED
    blocker : ANCHOR_DISABLED:NOMOS_GX402_ANCHOR_ENABLED is not true
    blocker : NO_GRANT_A:.local/HCS_TOPIC_CREATE_AUTHORIZED is absent or not a valid grant document
  would_submit: { built: false, frozen: false, signed: false, sent: false, transaction_id: null }

anchor:dryrun
  envelope sha256  : sha256:625b8c8e…f6f091   (moves with created_at, by design)
  topic read-back  : absent — Grant A not completed
  planned txs      : 1
  verdict          : BLOCKED
    blocker : ANCHOR_DISABLED
    blocker : NO_CONFIRMED_TOPIC:no verified topic read-back — run Grant A first
    blocker : NO_GRANT_B
```

`--execute` on both tools reaches the same verdict and exits 1.
`--emit-grant-b` exits 1: no confirmed topic evidence exists.

## 6. Tests and scans

```
npm test    487/487 pass  (431 before this checkpoint, +56 new)
npm run scan  CLEAN, 108 files, 43 waived WARNs
receipt     poa_60a1c2220acb7ef835dcdca8 — VALID
```

The 56 new tests cover every case the brief listed: missing and divergent admin
key state, wrong submit key, wrong memo text and wrong byte count, wrong
auto-renew account, wrong auto-renew period, fee-cap excess, expired grant,
repetition after an existing transaction id, an existing topic on the mirror
node, Grant A/B separation, and a dry run that constructs no SDK transaction.

Four are worth singling out:

- **`an unanswered ledger question is not a no`** — if the mirror-node lookup for
  existing topics fails, the run is blocked rather than allowed. The local marker
  catches a repeat on this machine; only the ledger lookup catches one made
  anywhere else, so losing it must fail closed.
- **`byte length is counted in UTF-8, not characters`** — 76 characters of `ü` is
  152 bytes. Declaring the count in characters would pass a naive check and be
  rejected by the network.
- **`the transaction class is reachable only behind the guard`** — reads the
  tool's own source and asserts the SDK import appears *after* the refusal
  branch. It is the only way to assert that a dry run *cannot* build a
  transaction rather than merely observing that it did not.
- **`no admin key is ever set`** — strips comments before matching, because the
  tool explains the omission in prose and an assertion about code should not
  force the explanation out of the file.

## 7. Ledger and balance — unchanged

Read-only, after all work:

```
balance                        95 000 000 tinybar (0.95 HBAR)   unchanged
transactions on 0.0.9689846    2, both CRYPTOTRANSFER            unchanged
CONSENSUSCREATETOPIC           0                                 unchanged
topics owned                   none
```

`.local/PAYMENT_EXECUTED`, `/root/ops/.cp_h2_funding_executed` and the quarantine
directory were not touched. No service was started, stopped or restarted; nothing
outside the repository was modified.

## 8. Correction carried into the documentation

The earlier CP-H7 transaction plan described a topic without an admin key as one
that "exists permanently". That is too broad and has been corrected in
`docs/CP-H7-TRANSACTION-PLAN.md` §2 and in the header of `topic-config.ts`:

- configuration and submit key are **not changeable** without an admin key;
- the topic **cannot be removed by a regular `TopicDeleteTransaction`**;
- **but** expiration and auto-renew remain independent ledger properties, so
  perpetual existence does not follow;
- and reaching consensus is **not** a guarantee that mirror-node history stays
  retrievable — retention is a third-party policy, not a property of the topic.

## 9. Awaiting

**Grant A only.** The configuration is locked, the command is in
`docs/CP-H7-TRANSACTION-PLAN.md` §7, and the file is the operator's to write.
Grant B cannot exist yet: it needs a topic id that will not exist until Grant A
has run and been read back.
