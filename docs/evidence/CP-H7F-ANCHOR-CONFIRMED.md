# CP-H7F — the anchor is on the ledger

**Status: `CP_H7_HCS_ANCHOR_CONFIRMED_COMPLETE`**
Date: 2026-07-23 · Base: CP-H7E at `77b3f09`

**Exactly one `CONSENSUSSUBMITMESSAGE` was executed.** The digest of
`poa_60a1c2220acb7ef835dcdca8` reached consensus on topic `0.0.9703011` at
sequence 1. The signed CP-H2 receipt was not touched.

---

## 1. The anchor

```
topic id             0.0.9703011
sequence number      1
transaction id       0.0.9689846@1784818787.803110569
consensus timestamp  1784818806.041876104
result               SUCCESS
type                 CONSENSUSSUBMITMESSAGE
payer                0.0.9689846
charged fee          695 405 tinybar = 0.00695405 HBAR   (ceiling 2 000 000)
running hash         ttgOeLwXoC3mvKLM7UVHuADpEJ0eB0SuAn7Sd/hFbxg7bWZ/HTr7WSKUanKhPLMd
running hash version 3
chunk                1 of 1
```

HashScan: `https://hashscan.io/testnet/topic/0.0.9703011`
Mirror: `https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9703011/messages/1`

## 2. Phase 1 — preflight, all PASS

HEAD `77b3f09`, tree clean, 487/487 tests, scan CLEAN, receipt VALID with
`anchor: null`. Receipt file baseline SHA-256
`7eb1ec4432ddaf8c176d4e8c1ad62744f46d42fce5eabfa8998a4e46e5df1a79`.

Ledger, read-only: topic `0.0.9703011` — memo exact, `admin_key` absent,
submit key exact, auto-renew account and period exact, `deleted: false`,
**0 messages**. Balance 67 366 659 tinybar. `.local/HCS_ANCHOR_EXECUTED` absent.

## 3. Phase 2 — fresh envelope and Grant B

The CP-H7E emission (`created_at 14:42:55Z`) was **not reused**; it was stale by
more than a grant window. A fresh envelope was generated:

```
created_at   2026-07-23T14:59:11Z
bytes        585   (budget 640, protocol chunk limit 1024 — one chunk)
sha256       sha256:da01c3a29fa2838b935dc873a9149121891d25bf7a61b4d25e57a186204c43ce
```

```json
{"anchor_version":"v2","canonicalization":"RFC8785-JCS/nomos-int-only-v1","created_at":"2026-07-23T14:59:11Z","digest_algorithm":"sha256","env":"TESTNET_DEMO_ONLY","network":"hedera:testnet","purpose":"proof-of-action receipt digest anchor","receipt_id":"poa_60a1c2220acb7ef835dcdca8","receipt_schema_version":"nomos.gx402.proof_of_action_receipt.v1","record_digest":"sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9","schema":"nomos.gx402.anchor.v2","source_consensus_timestamp":"1784746993.237232768","source_transaction_id":"0.0.7162784@1784746988.798231156"}
```

Grant B written atomically at `0600`, then **re-read from disk** and validated —
17 of 17 PASS, including a rebuild of the envelope from the pinned `created_at`
and an independent recomputation of the SHA-256, the anchor key, the byte count
and the single-chunk bound. Window 25 minutes, inside the 30-minute ceiling.
Explicitly asserted: not the stale CP-H7E values.

Dry run afterwards: `verdict: ALLOWED`, nothing signed or sent.

## 4. Phase 4 — independent consensus verification

The submit tool performed its own check. It was then repeated **outside** the
tool, with the envelope rebuilt from the receipt alone, because a tool
confirming its own work is not a second opinion.

25 checks, all PASS:

```
result SUCCESS · type CONSENSUSSUBMITMESSAGE · entity 0.0.9703011
transaction id 0.0.9689846-1784818787-803110569 · nonce 0
payer debited 0.0.9689846 · max_fee 2000000 honoured
messages on topic 1 · sequence 1 · chunk 1 of 1
message consensus timestamp == transaction consensus timestamp
observed length 585 · BYTE-EXACT MATCH · sha256 identical
decoded schema / receipt_id / record_digest / network / created_at / env
decoded source_transaction_id and source_consensus_timestamp match the receipt
anchor_key rederived from the decoded message: anc_cd5991bdb525e4662dc6f050
all 13 envelope fields identical
```

`tools/verify-anchor.ts … --mirror` independently returns **VALID**.

## 5. Two schema defects the real ledger exposed

Neither was found by any test before a real message existed. Both are now fixed
and covered.

**`running_hash` was declared as hex.** A mirror node returns it base64. The
verifier rejected our own confirmed anchor with
`.running_hash:does not match ^[0-9a-f]+$` — a schema assumption that had never
met the ledger, exactly like the `transactions[0]` assumption in CP-H2. Pattern
corrected against the observed value, with a regression test built on the real
running hash.

**The evidence schema had no room for what the operator required.** Running
hash version, actual fee, chunk position, the independent verification block,
the duplicate-protection record and the receipt-immutability proof were all
undeclared, and `additionalProperties: false` correctly refused them. They are
now declared as typed fields rather than the constraint being loosened — a
verifier that tolerates undeclared fields cannot tell an enriched record from a
forged one.

## 6. Evidence files

| File | Contents |
|---|---|
| `docs/evidence/cp-h7/anchor-evidence.json` | status **CONFIRMED**, topic, sequence, transaction id, consensus timestamp, full envelope, envelope SHA-256, anchor key, record digest, running hash + version, chunk, actual and maximum fee, independent verification, duplicate protection, receipt-immutability proof |
| `docs/evidence/cp-h7/topic-evidence.json` | CP-H7E topic creation, unchanged |
| `docs/evidence/cp-h7/anchor-dry-run.json` | the pre-execution dry run |

Written atomically (`tmp` + `rename`). Status went `SUBMITTED` → `CONFIRMED`
only after the independent read-back, never before.

## 7. The CP-H2 receipt was not modified

```
sha256 before : 7eb1ec4432ddaf8c176d4e8c1ad62744f46d42fce5eabfa8998a4e46e5df1a79
sha256 after  : 7eb1ec4432ddaf8c176d4e8c1ad62744f46d42fce5eabfa8998a4e46e5df1a79
anchor field  : null
verdict       : VALID
```

Byte-identical. This is deliberate and not an omission: the receipt is signed
over its canonical bytes, so writing an anchor into it would change those bytes
and break the signature binding. The anchor is stored as separate, linked
evidence, bound by `receipt_id` and `record_digest` — which is what makes it
verifiable against the receipt rather than a claim inside it.

**Anchoring remains additive.** The receipt was fully valid before this
transaction and is exactly as valid now. The anchor adds an independent,
timestamped third-party observation that the digest existed; it confers nothing.

## 8. Grants consumed, duplicate protection proven

Grant B archived to
`.local/HCS_ANCHOR_AUTHORIZED.consumed_20260723T145926Z` (`0600`) with
`consumed_at`, `consumed_by_transaction_id`, topic id, sequence number and
consensus timestamp; magic string suffixed `__CONSUMED`. Verified: **it no longer
parses as a grant.**

Re-running `--execute` is now refused for three independent reasons:

```
blocker : ALREADY_EXECUTED:.local/HCS_ANCHOR_EXECUTED exists
blocker : NO_GRANT_B:.local/HCS_ANCHOR_AUTHORIZED is absent or not a valid grant document
blocker : DUPLICATE_ON_TOPIC:this receipt is already anchored there
```

The third is the interesting one: the pre-submit topic scan now finds our own
message and recognises it. That guard would stop a duplicate made from a
different machine, where the local marker could not.

`topic:execute` remains refused for four reasons, including
`TOPIC_ALREADY_CONFIGURED:0.0.9703011 — creating a second one is not the fix`.

## 9. Ledger

| | Before submit | After |
|---|---|---|
| Balance | 67 366 659 tinybar | **66 671 254 tinybar** (0.66671254 HBAR) |
| Delta | — | **695 405 tinybar = 0.00695405 HBAR** |
| Messages on topic | 0 | **1**, sequence 1 |
| Payer transactions | 3 | **4** — 2 CRYPTOTRANSFER, 1 CONSENSUSCREATETOPIC, 1 CONSENSUSSUBMITMESSAGE |

The delta equals the reported charged fee exactly, and lands at 35 % of the
0.02 HBAR ceiling.

Untouched: `.local/PAYMENT_EXECUTED`, `/root/ops/.cp_h2_funding_executed`, the
quarantine directory, every systemd unit, every production service. `.env`
changed in exactly one field — `NOMOS_GX402_HCS_TOPIC_ID=0.0.9703011`, required
for the submit — and is git-ignored.

## 10. What this does and does not prove

- ✅ At consensus timestamp `1784818806.041876104`, the Hedera testnet accepted a
  585-byte message stating that receipt `poa_60a1c2220acb7ef835dcdca8` has record
  digest `sha256:2bf595c1…f71ecdb9`, computed under RFC 8785 JCS with the
  project's integer-only restriction, for the payment
  `0.0.7162784@1784746988.798231156`.
- ✅ That message cannot be withdrawn or altered, and the topic's configuration
  cannot be rewritten to reinterpret it.
- ⚠️ It does **not** prove the underlying work was done well, only that this
  digest existed at that moment.
- ⚠️ It is **not** a guarantee that mirror-node history stays retrievable —
  retention is a third-party operator policy — nor that the topic exists forever;
  expiration and auto-renew remain independent ledger properties.

## 11. Still not done

The CP-H8 demo **still refuses to render an anchor** (`app.js:100`,
`evidence-model.ts:427`). It was left untouched here, so it currently shows
`NOT_YET_ANCHORED` for a receipt whose digest is anchored. The patch plan is
`docs/CP-H8-ANCHOR-INTEGRATION-PLAN.md`; it is now unblocked and needs its own
approval. Also outstanding: the bounty video, the public repository, and the
untracked `tools/secret-scan.allow.json` recorded in CP-H7 §10.
