# CP-H7 — transaction plan

**Status: DECISION LOCKED (CP-H7D). NOTHING SUBMITTED.**
Two transactions are specified below under two separate authorizations, and
neither authorization exists.

Superseded by this revision: the earlier version of this file, which presented
the admin-key and submit-key choices as open questions and described a topic
without an admin key as one that "exists permanently". Both are corrected here.

---

## 1. Is a new topic required?

**Yes.** No consensus topic exists for this project, and no existing topic may be
reused.

Evidence, read-only from the public mirror node:

```
GET /api/v1/transactions?account.id=0.0.9689846&transactiontype=CONSENSUSCREATETOPIC
→ 0 transactions
```

The four OracleNet topics that do exist belong to a pre-existing deployment and
are refused by name in `FORBIDDEN_TOPIC_IDS`. Two are mainnet production; one had
key material exposed.

---

## 2. The locked configuration

Frozen in source at `packages/hcs-anchor/src/topic-config.ts`, not read from the
environment and not left to an SDK default. On a topic that cannot be
reconfigured, a value that arrived by default would be a value nobody chose,
permanently.

| Property | Value |
|---|---|
| Network | `hedera:testnet` |
| Payer | `0.0.9689846` |
| Memo | `NOMOS CP-H7 PoA anchor v2 \| TESTNET_DEMO_ONLY \| poa_60a1c2220acb7ef835dcdca8` |
| Memo length | **exactly 76 UTF-8 bytes** (limit 100) |
| **Admin key** | **none** |
| **Submit key** | `025da46e31ecfa0ded857ec843508fee25efcf73780f5725c1da8ba49be8ce4c17` (ECDSA secp256k1) |
| Auto-renew account | `0.0.9689846` |
| Auto-renew period | `8000001` seconds (network maximum) |
| Max transaction fee | `50000000` tinybar (0.50 HBAR) |

**Canonical configuration digest:**
`sha256:42ee4d26dd74a13d1f58c9d72978580db16ecc55a8da6f1bd530aed85e650f6b`
(460 canonical bytes)

The submit key is the payer account's **existing** key. No new key was generated
— one fewer secret to hold is one fewer secret to lose. It was verified from both
directions: the mirror node reports it as the account key, and the local key file
derives to the identical value. A topic whose submit key we could not sign for
would be permanently unwritable.

### What "no admin key" actually means

Correcting the earlier wording in this file, which was too broad:

- ✅ The **configuration and submit key cannot be changed** — by anyone,
  including us. There is no `TopicUpdateTransaction` path without an admin key.
- ✅ The topic **cannot be removed by a regular `TopicDeleteTransaction`**.
- ⚠️ This is **not** a guarantee of perpetual existence. **Expiration and
  auto-renew remain independent ledger properties.** A topic whose auto-renew
  account cannot pay is subject to the network's own expiry and lifecycle rules,
  and those rules are not fixed by the absence of an admin key.
- ⚠️ **Consensus history is not the same as guaranteed retrievability.** Reaching
  consensus is a fact about a moment. Mirror nodes are operated by third parties
  under their own retention policies; their availability is not a property this
  configuration can confer.

The honest claim is narrower and still worth having: at a consensus timestamp,
these bytes were accepted by the network, and the configuration under which they
were accepted cannot later be rewritten to say something else.

### Public topic

No submit key restriction beyond the account's own key means the topic is
readable by anyone; writes require the submit key. A message from a stranger — if
one were ever possible — changes nothing about a verification:
`findDuplicateAnchor` ignores anything it cannot parse as our envelope, and
`verifyAnchorEvidence` compares observed bytes against bytes it derived from the
receipt itself.

---

## 3. The two transactions, under two separate grants

### GRANT A → `TopicCreateTransaction`

Fee ceiling **0.50 HBAR**, explicitly set. Every field above is set explicitly;
`setAdminKey` is not called anywhere in `tools/create-anchor-topic.ts`, and a
test asserts that.

### GRANT B → `TopicMessageSubmitTransaction`

Fee ceiling **0.02 HBAR**, explicitly set. Publishes exactly 585 bytes.

**The two are deliberately not one grant.** Grant B names a real topic id, and a
real topic id cannot be known before Grant A has executed *and* been read back
field by field. A combined grant would therefore have to authorize a submit to a
topic nobody had inspected — which is exactly the step at which a wrong memo or
wrong submit key would become permanent and unnoticed.

**Grant B may only be written after the read-back is `CONFIRMED`.** The tooling
enforces this in both directions: `--emit-grant-b` refuses without confirmed
topic evidence, and the submit guard blocks on `NO_CONFIRMED_TOPIC`.

---

## 4. The mandatory read-back

After creation, before Grant B data is produced, the topic is fetched from a
mirror node and compared field by field:

| Checked | Against |
|---|---|
| `topic_id` | the id in the create receipt |
| `memo` | the 76-byte literal |
| `admin_key` | must be **absent** (null or empty; any key material fails) |
| `submit_key` | exact hex match |
| `auto_renew_account` | `0.0.9689846` |
| `auto_renew_period` | `8000001` |
| create transaction status | `SUCCESS` |

If any check fails, the run exits non-zero, writes evidence with status
`UNCONFIRMED`, and **withholds the Grant B data**. Without an admin key the
configuration cannot be corrected — a new topic under a new Grant A is the only
path forward, and the mismatched topic is simply abandoned.

---

## 5. Cost

Measured from the last 25 successful transactions of each type on testnet, not
from the fee schedule:

| Transaction | min | median | max | ceiling set |
|---|---|---|---|---|
| `CONSENSUSCREATETOPIC` | 0.13739 | **0.27479 HBAR** | 0.41356 | 0.50 HBAR |
| `CONSENSUSSUBMITMESSAGE` | 0.00235 | **0.00340 HBAR** | 0.00415 | 0.02 HBAR |

**Expected ≈ 0.278 HBAR, worst observed ≈ 0.418 HBAR.** Payer holds **0.95 HBAR**.
Both ceilings sit above the worst observed cost, and well below the balance.

**EUR cost: zero.** Testnet HBAR has no monetary value and is not purchasable.
For reference only, the same two transactions on mainnet would cost roughly
$0.0101 ≈ €0.01.

⚠️ The funding source `0.0.8509917` stays **quarantined**; its key must not be
read. If the balance were ever insufficient the answer is the faucet or a new
operator decision — never that key.

---

## 6. Duplicate protection

Three independent checks, because they fail in different situations:

| Guard | Catches |
|---|---|
| `.local/HCS_TOPIC_CREATED` (atomic, written the moment a transaction id exists) | a repeat on this machine |
| `NOMOS_GX402_HCS_TOPIC_ID` non-empty | a topic already adopted into configuration |
| mirror-node `CONSENSUSCREATETOPIC` count for the payer | a topic created anywhere else |

If the mirror-node lookup does not answer, the run is **blocked**
(`LEDGER_STATE_UNKNOWN`). An unanswered question about the ledger is not a "no".

---

## 7. Grant A — the exact operator command

**Not executed.** Claude does not write this file.

```bash
cd /root/nomos-governed-x402-hedera

# expires_at must be at most 30 minutes ahead — the guard refuses a longer window.
cat > .local/HCS_TOPIC_CREATE_AUTHORIZED <<'JSON'
{
  "grant": "NOMOS_GX402_CP_H7_TOPIC_CREATE_GRANT_V1",
  "network": "hedera:testnet",
  "payer_account_id": "0.0.9689846",
  "topic_config": {
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
  },
  "topic_config_digest": "sha256:42ee4d26dd74a13d1f58c9d72978580db16ecc55a8da6f1bd530aed85e650f6b",
  "max_transaction_fee_tinybar": "50000000",
  "expires_at": "REPLACE_WITH_UTC_AT_MOST_30_MINUTES_AHEAD"
}
JSON
chmod 600 .local/HCS_TOPIC_CREATE_AUTHORIZED

# Enable anchoring in .env:  NOMOS_GX402_ANCHOR_ENABLED=true

npm run topic:dryrun     # read the guard verdict; still builds no transaction
npm run topic:execute    # creates ONE topic, then reads it back
```

Then, only if the read-back printed `CONFIRMED`:

```bash
# 1. adopt the topic id
#    .env:  NOMOS_GX402_HCS_TOPIC_ID=0.0.<new>

# 2. get the Grant B material (this is data, not a grant)
npm run topic:grant-b

# 3. operator writes .local/HCS_ANCHOR_AUTHORIZED from that output,
#    setting expires_at at most 30 minutes ahead

npm run anchor:dryrun
npm run anchor:execute
npm run anchor:verify docs/evidence/cp-h7/anchor-evidence.json \
  docs/evidence/cp-h2/receipt.json -- --mirror
```

`envelope_created_at` in Grant B is **pinned**. Re-running `topic:grant-b`
produces a different `created_at` and therefore a different `envelope_sha256`;
use one emission and submit inside its window.

---

## 8. Rollback boundary

| Stage | Reversible? |
|---|---|
| Everything in CP-H7 and CP-H7D | Yes — `git revert`, delete `docs/evidence/cp-h7/` |
| Writing either grant document | Yes — delete the file |
| **Topic created** | **No.** Configuration and submit key are fixed; no regular delete exists. Roughly 0.27 HBAR spent. A wrong topic can only be abandoned, not corrected. |
| **Message reached consensus** | **No.** The 585 bytes are public and permanent. |

The mitigation is not a rollback plan. It is that the envelope contains no field
capable of holding anything anyone would later want back, and that the read-back
runs before the message is ever authorized.

---

## 9. What still needs approval

**Grant A.** The configuration is locked and the command is above; the file is
the operator's to write.

Grant B does not exist yet and cannot: it needs a topic id that will not exist
until Grant A has run.
