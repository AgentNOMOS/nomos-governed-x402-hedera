# CP-H7E — the topic exists

**Status: `CP_H7_TOPIC_CREATED_CONFIRMED_AWAITING_SEPARATE_GRANT_B_APPROVAL`**
Date: 2026-07-23 · Base: CP-H7D at `bf26bbe`

**Exactly one Hedera testnet transaction was executed. No message was submitted.**

---

## The topic

```
topic id             0.0.9703011
transaction id       0.0.9689846@1784817764.643511348
consensus timestamp  1784817768.283020104
result               SUCCESS
network              hedera:testnet
charged fee          27 633 341 tinybar = 0.27633341 HBAR
```

HashScan: `https://hashscan.io/testnet/topic/0.0.9703011`
Mirror: `https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9703011`

**The topic is empty. Nothing is anchored.** `poa_60a1c2220acb7ef835dcdca8` still
carries `anchor: null` and is fully valid without one.

## Pre-flight state

| | |
|---|---|
| HEAD | `bf26bbe`, working tree clean |
| Tests | 487/487 |
| Receipt | `poa_60a1c2220acb7ef835dcdca8` — VALID |
| Balance | 95 000 000 tinybar (0.95 HBAR) |
| Transactions on payer | 2, both CRYPTOTRANSFER |
| `CONSENSUSCREATETOPIC` | 0 |
| `.local/HCS_TOPIC_CREATED` | absent |
| Any grant document | absent |

## Grant A — reconstructed, not copied

The JSON block printed in the previous report was line-wrapped. A wrapped memo is
a different memo and would have produced a different configuration digest, so it
was not used as a source. Grant A was rebuilt programmatically from
`packages/hcs-anchor/src/topic-config.ts`, written atomically (`tmp` + `rename`)
with mode `0600`, then **re-read from disk and validated field by field**:

```
PASS grant magic              NOMOS_GX402_CP_H7_TOPIC_CREATE_GRANT_V1
PASS network                  hedera:testnet
PASS payer_account_id         0.0.9689846
PASS config.network           hedera:testnet
PASS config.admin_key         null
PASS admin_key field present  yes
PASS config.memo              NOMOS CP-H7 PoA anchor v2 | TESTNET_DEMO_ONLY | poa_…
PASS memo bytes (actual)      76
PASS config.memo_bytes        76
PASS submit_key.type          ECDSA_SECP256K1
PASS submit_key.public_key    025da46e…4c17
PASS auto_renew_account_id    0.0.9689846
PASS auto_renew_period        8000001
PASS config fee cap           50000000
PASS grant fee cap            50000000
PASS digest (stated)          sha256:42ee4d26…650f6b
PASS digest (recomputed)      sha256:42ee4d26…650f6b
PASS digest vs source         sha256:42ee4d26…650f6b
PASS expiry window            1473s remaining (max 1800)
```

Issued `2026-07-23T14:41:53Z`, expiring `2026-07-23T15:06:53Z` — a 25-minute
window inside the 30-minute ceiling. The digest matches the value the operator
independently specified.

## Dry run before execution

Run with the guard enabled and Grant A in place:

```
verdict : ALLOWED
note    : submit key verified against the payer's own key — the topic will be writable by us
```

Still built no transaction: `built: false, frozen: false, signed: false, sent: false`.

## The read-back

Performed by the tool immediately after creation, all six fields:

```
ok   topic_id            0.0.9703011
ok   memo                NOMOS CP-H7 PoA anchor v2 | TESTNET_DEMO_ONLY | poa_60a1c2220acb7ef835dcdca8
ok   admin_key           <absent>
ok   submit_key          025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17
ok   auto_renew_account  0.0.9689846
ok   auto_renew_period   8000001
verdict: CONFIRMED
```

Then repeated **independently**, outside the create tool, with direct mirror-node
requests — because a tool confirming its own work is not a second opinion:

```
GET /topics/0.0.9703011                              → all 8 checks PASS (incl. deleted: false)
GET /transactions/0.0.9689846-1784817764-643511348   → 1 record, CONSENSUSCREATETOPIC,
                                                       result SUCCESS, entity_id 0.0.9703011
INDEPENDENT VERIFICATION: ALL PASS
```

Both results are recorded in `docs/evidence/cp-h7/topic-evidence.json`
(status `CONFIRMED`), written atomically.

## The one-shot marker

`.local/HCS_TOPIC_CREATED` was written at `2026-07-23T14:42:48.164Z`, **before**
the topic id was known — it records `topic=pending`. That is the intended
behaviour and not a defect: the marker fires on the transaction id, because the
budget is spent the moment a transaction exists, regardless of what happens
downstream. CP-H2 lost that distinction once, when a payment settled and the run
threw before the marker was written. The topic id lives in the evidence file,
which is written after the read-back; the marker's job is only to say "a
transaction happened here".

## All three duplicate guards now fire

Re-running `--execute` after completion:

```
blocker : ALREADY_CREATED:.local/HCS_TOPIC_CREATED exists — a topic was already created
blocker : TOPIC_EXISTS_ON_LEDGER:1 CONSENSUSCREATETOPIC already on the payer
blocker : NO_GRANT_A:.local/HCS_TOPIC_CREATE_AUTHORIZED is absent or not a valid grant document
exit 1
```

Three independent reasons, each of which would have been sufficient alone.

## Grant A archived, not deleted

Moved to `.local/HCS_TOPIC_CREATE_AUTHORIZED.consumed_20260723T144255Z`, mode
`0600`, with `consumed_at`, `consumed_by_transaction_id` and `created_topic_id`
added and the magic string suffixed `__CONSUMED`. Verified that the archived
document **no longer parses as a grant**. The record of what was authorized is
kept; the authority is gone.

## Ledger, before and after

| | Before | After |
|---|---|---|
| Balance | 95 000 000 tinybar | **67 366 659 tinybar** (0.67366659 HBAR) |
| Delta | — | **27 633 341 tinybar = 0.27633341 HBAR** |
| Transactions | 2 CRYPTOTRANSFER | 2 CRYPTOTRANSFER + **1 CONSENSUSCREATETOPIC** |
| `CONSENSUSCREATETOPIC` | 0 | **1** |
| Messages on the topic | — | **0** |

The balance delta equals the charged fee exactly. The fee landed within one
percent of the predicted median (0.27479 HBAR) and at 55 % of the 0.50 HBAR
ceiling.

Untouched: `.local/PAYMENT_EXECUTED`, `/root/ops/.cp_h2_funding_executed`, the
quarantine directory, `.env`, every systemd unit and every production service.

## What "the topic exists" does and does not mean

- ✅ Its configuration and submit key **cannot be changed** — there is no admin
  key, so no `TopicUpdateTransaction` path exists for anyone, including us.
- ✅ It **cannot be removed by a regular `TopicDeleteTransaction`**.
- ⚠️ This is **not** perpetual existence. Expiration and auto-renew remain
  independent ledger properties; the auto-renew account is `0.0.9689846` and its
  balance is finite.
- ⚠️ Consensus is **not** a promise that mirror-node history stays retrievable.
  Retention is a third-party operator policy.

## Grant B — data only

The following was emitted after the confirmed read-back. **It is not a grant, no
grant file was written, and no message was sent.**

```json
{
  "grant": "NOMOS_GX402_CP_H7_ANCHOR_SUBMIT_GRANT_V2",
  "network": "hedera:testnet",
  "topic_id": "0.0.9703011",
  "receipt_id": "poa_60a1c2220acb7ef835dcdca8",
  "record_digest": "sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9",
  "anchor_key": "anc_cd5991bdb525e4662dc6f050",
  "envelope_created_at": "2026-07-23T14:42:55Z",
  "envelope_sha256": "sha256:86a2867a595cc39cb1ff4ed05922913fb1faac54a146a8941eb109aa30070f6c",
  "envelope_bytes": 585,
  "max_transaction_fee_tinybar": "2000000",
  "expires_at": "<UTC, at most 30 minutes ahead>"
}
```

⚠️ **This emission is already stale and must not be used.** `envelope_created_at`
is pinned into the digest, and a grant window is at most 30 minutes; by the time
Grant B is approved, these bytes will be older than that. Re-run
`npm run topic:grant-b` at approval time for a fresh emission, and write the
grant from *that* output. The topic id, receipt id, record digest and anchor key
will be identical; `envelope_created_at` and `envelope_sha256` will not.

`NOMOS_GX402_HCS_TOPIC_ID` was deliberately **left unset** in `.env`. Adopting the
topic into configuration is part of preparing a submit, and no submit is
authorized. The submit guard consequently blocks on both `NO_CONFIRMED_TOPIC` and
`NO_GRANT_B`.

## Still forbidden until separately approved

Submitting the anchor message · writing Grant B · creating a second topic ·
setting `anchor_status: "ANCHORED"` anywhere in the demo · any mainnet
transaction · any push or deployment.
