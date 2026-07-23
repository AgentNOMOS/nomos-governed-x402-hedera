# CP-H7 — transaction plan

**Status: NOTHING SUBMITTED. Two transactions are proposed and neither is authorized.**

This document exists to be read before an approval, not after one. Every number
in it was measured rather than estimated from documentation.

---

## 1. Is a new topic required?

**Yes.** No consensus topic exists for this project, and no existing topic may be
reused.

Evidence, read-only from the public mirror node on 2026-07-23:

```
GET /api/v1/transactions?account.id=0.0.9689846&limit=25&order=desc
→ 2 transactions, both CRYPTOTRANSFER:
    0.0.8509917-1784746678-979694179   (the authorized funding transfer)
    0.0.7162784-1784746988-798231156   (the CP-H2 x402 payment)
→ zero CONSENSUSCREATETOPIC
```

The four OracleNet topics that do exist belong to a different, pre-existing
deployment and are refused by name in `FORBIDDEN_TOPIC_IDS`
(`packages/hcs-anchor/src/interfaces.ts`). Two of them are mainnet production;
one had key material exposed. None of them is purpose-bound to this project, and
"a topic that happens to be writable" is not the same thing as "a topic intended
for this".

---

## 2. Proposed topic configuration

| Property | Proposed | Why |
|---|---|---|
| Network | Hedera **testnet** | Pinned by `const` in every schema. A mainnet document is unrepresentable. |
| Memo | `nomos-gx402 anchor topic — TESTNET DEMO ONLY` | Readable on HashScan without opening a message. |
| **Admin key** | **none (immutable topic)** | See below. |
| **Submit key** | **none (public topic)** | See below. |
| Auto-renew account | payer `0.0.9689846` | Default; testnet renewal is not currently enforced. |

### Admin key: deliberately absent

A topic created without an admin key **cannot be updated or deleted, by anyone,
ever** — including us. That is the property worth having. An anchor topic whose
owner can delete it proves less than one that cannot: a reviewer would have to
trust that we did not, rather than observe that we could not.

The cost is real and should be stated: if the memo is wrong, or the topic is
created against the wrong account, the only remedy is to abandon it and create
another. There is no `TopicUpdateTransaction` path afterwards.

### Submit key: deliberately absent

A public topic means anyone may write to it. That is acceptable here and worth
being explicit about, because it changes what the topic proves:

- It proves **our** message existed at a consensus time — the message is signed
  content in the sense that it names a receipt id and a digest that only we can
  produce a matching receipt for.
- It does **not** prove that every message on the topic is ours.

The verifier is built for exactly this: `findDuplicateAnchor` ignores messages it
cannot parse as our envelope, and `verifyAnchorEvidence` compares the observed
bytes against bytes it derived from the receipt. A stranger's message on the
topic changes nothing about a verification. Adding a submit key would buy tidiness
at the price of another key to hold, and key custody is the thing this project
has already had one incident about.

**If the operator prefers a submit-key-restricted topic, say so — it is a
one-line change to the create transaction and a second key to store, and the
verification logic is unaffected.**

---

## 3. The two transactions

### A. `TopicCreateTransaction`

Creates the topic. Required only because none exists.

### B. `TopicMessageSubmitTransaction`

Publishes exactly these 585 bytes to the topic from (A):

```json
{"anchor_version":"v2","canonicalization":"RFC8785-JCS/nomos-int-only-v1","created_at":"<UTC at submit time>","digest_algorithm":"sha256","env":"TESTNET_DEMO_ONLY","network":"hedera:testnet","purpose":"proof-of-action receipt digest anchor","receipt_id":"poa_60a1c2220acb7ef835dcdca8","receipt_schema_version":"nomos.gx402.proof_of_action_receipt.v1","record_digest":"sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9","schema":"nomos.gx402.anchor.v2","source_consensus_timestamp":"1784746993.237232768","source_transaction_id":"0.0.7162784@1784746988.798231156"}
```

`created_at` is the only field that moves between runs, and it moves by design —
it is our claim about when we built the message, distinct from the consensus
timestamp, which the network assigns and we cannot influence.

**Byte length: 585** (own budget 640, protocol single-chunk limit 1024). One
chunk, so read-back never depends on the SDK's chunking behaviour.

**Total: exactly 2 transactions.** If a topic already existed, it would be 1.

---

## 4. Cost

Measured from the last 25 successful transactions of each type on testnet
(mirror node, 2026-07-23), not from the fee schedule:

| Transaction | min | median | max |
|---|---|---|---|
| `CONSENSUSCREATETOPIC` | 0.13739 HBAR | **0.27479 HBAR** | 0.41356 HBAR |
| `CONSENSUSSUBMITMESSAGE` | 0.00235 HBAR | **0.00340 HBAR** | 0.00415 HBAR |

**Expected total ≈ 0.278 HBAR. Worst observed case ≈ 0.418 HBAR.**

Payer `0.0.9689846` holds **0.95 HBAR** (95 000 000 tinybar, confirmed
2026-07-23). Worst case leaves ≈ 0.53 HBAR.

**EUR cost: zero.** Testnet HBAR has no monetary value and is not purchasable;
this balance came from a faucet. For reference only, the same two transactions on
mainnet would cost roughly **$0.0101** (topic create $0.01, message submit
$0.0001) ≈ **€0.01**. Nobody should read the testnet HBAR figures as money.

**Paying account:** `0.0.9689846` (the CP-H2 demo payer, ECDSA secp256k1, key at
`.local/hedera-payer.key`, 0600, git-ignored, contents never read by any
reporting path).

⚠️ The funding source `0.0.8509917` stays **quarantined**. Its key must not be
read. If the payer balance were ever insufficient, the answer is the faucet or a
new operator decision — never that key.

---

## 5. What the guard requires before either transaction runs

`node tools/anchor-receipt.ts --execute` refuses today. Current output:

```
verdict          : BLOCKED
  blocker       : ANCHOR_DISABLED:NOMOS_GX402_ANCHOR_ENABLED is not true
  blocker       : NO_GRANT:.local/HCS_ANCHOR_AUTHORIZED is absent or not a valid grant document
```

A grant is a **parsed document**, not a file that exists. This is a direct lesson
from a sibling system in this codebase's lineage, where a paid endpoint was gated
on `os.path.exists("preflight.allow")`; an unrelated rollback deleted the file,
and because existence was the whole authorization language there was no way to
reissue it with a scope or an expiry. Recovery failed closed twice.

So the grant names what it authorizes, and each field is checked against what is
about to happen:

```json
{
  "grant": "NOMOS_GX402_CP_H7_ANCHOR_GRANT_V1",
  "topic_id": "CREATE",
  "receipt_id": "poa_60a1c2220acb7ef835dcdca8",
  "record_digest": "sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9",
  "max_transactions": 2,
  "expires_at": "<UTC, second precision>",
  "network": "hedera:testnet"
}
```

A grant for another topic, another receipt, a smaller transaction budget or a
past expiry authorizes nothing. `topic_id: "CREATE"` authorizes creating one, and
is contradicted by an already-configured topic.

---

## 6. Exact commands — only after approval

None of these has been run.

```bash
cd /root/nomos-governed-x402-hedera

# 1. Operator writes the grant. Claude does not create this file.
#    Set expires_at to a few hours out, not a few months.
cat > .local/HCS_ANCHOR_AUTHORIZED <<'JSON'
{
  "grant": "NOMOS_GX402_CP_H7_ANCHOR_GRANT_V1",
  "topic_id": "CREATE",
  "receipt_id": "poa_60a1c2220acb7ef835dcdca8",
  "record_digest": "sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9",
  "max_transactions": 2,
  "expires_at": "2026-07-24T12:00:00Z",
  "network": "hedera:testnet"
}
JSON
chmod 600 .local/HCS_ANCHOR_AUTHORIZED

# 2. Enable anchoring in .env
#    NOMOS_GX402_ANCHOR_ENABLED=true

# 3. Dry run once more and read the guard verdict.
npm run anchor:dryrun

# 4. Create the topic (transaction A) — a separate, reviewable step.
#    NOT YET WRITTEN: tools/create-anchor-topic.ts is deliberately absent until
#    the topic configuration in §2 is approved, because an immutable topic
#    created with the wrong memo cannot be corrected.

# 5. Put the new topic id in .env as NOMOS_GX402_HCS_TOPIC_ID, then submit
#    the message (transaction B).
npm run anchor:execute

# 6. Confirm against a mirror node. Until this passes, status stays SUBMITTED.
npm run anchor:verify docs/evidence/cp-h7/anchor-evidence.json \
  docs/evidence/cp-h2/receipt.json -- --mirror
```

Step 4 has no script yet **on purpose**. Writing a topic-creation tool before the
admin-key decision in §2 is made would mean the first person to run it decides,
by default, whether the topic is immutable forever.

---

## 7. Rollback boundary

| Stage | Reversible? |
|---|---|
| Everything in this checkpoint | Yes — `git revert`, delete `docs/evidence/cp-h7/` |
| Writing the grant document | Yes — delete the file |
| **Topic created** | **No.** Without an admin key it can never be deleted or updated. It costs ~0.27 HBAR and is permanent. |
| **Message reached consensus** | **No.** The 585 bytes are public and permanent. |
| The evidence file and demo claims | Yes — but the on-chain facts they describe are not |

**After consensus, the irreversible facts are:** a topic exists on testnet with
our memo; it carries a message naming receipt `poa_60a1c2220acb7ef835dcdca8`, its
record digest, and the payment transaction `0.0.7162784@1784746988.798231156`.
None of that is sensitive — it is all already in a receipt we intend to publish —
but none of it can be withdrawn.

The mitigation is not a rollback plan. It is that the envelope contains no field
capable of holding anything we would later want back.

---

## 8. What needs an explicit decision

1. **Approve or reject the two transactions** (topic create + message submit).
2. **Admin key: immutable (proposed) or updatable?** Irreversible either way.
3. **Submit key: public (proposed) or restricted?** Restricted means another key.
4. **Topic memo text** — permanent if the topic is immutable.
5. **Grant expiry window.**
