# CP-H8 — demo integration plan for an anchor

**Status: PLAN ONLY. The demo currently claims no anchor, and this checkpoint
changed nothing about that.**

The CP-H8 demo does not merely omit an anchor — it **refuses to render one**:

```js
// apps/demo-ui/public/app.js:100
if (data.receipt.anchor !== null || data.receipt.anchor_status !== "NOT_YET_ANCHORED") {
  return "The receipt carries an HCS anchor. This page is only able to present " +
    "anchoring as pending, so it will not render.";
}
```

and the evidence model asserts the same thing on the build side
(`evidence-model.ts:427`, `ANCHOR_PRESENT`).

That is the right shape for today and it has a consequence worth knowing before
approval: **the moment a real anchor exists, the demo breaks.** Not degrades —
refuses to draw. Whoever approves CP-H7 should approve this patch in the same
breath, or the successful anchor will be followed by a broken demo page.

---

## What changes, and only after consensus

### 1. Invert the guard

The check becomes: an anchor may be present, but only in a form the page can
prove. `anchor_status` gains `ANCHORED` alongside `NOT_YET_ANCHORED`, and
`ANCHORED` is accepted **only** when accompanied by topic id, sequence number,
consensus timestamp and transaction id. A truthy-but-incomplete anchor must keep
failing closed — that path is the whole reason the current guard exists.

### 2. Fields to display

| Field | Source | Note |
|---|---|---|
| Topic ID | `anchor-evidence.json` → `topic_id` | links to HashScan `/topic/<id>` |
| Sequence number | `sequence_number` | the topic-local ordinal |
| HCS consensus timestamp | `consensus_timestamp` | **network-assigned**, not ours |
| HCS transaction ID | `transaction_id` | the submit, not the payment |
| Anchor envelope | `envelope` | shown verbatim, all 585 bytes |
| Envelope digest | `envelope_digest` | over the canonical bytes |
| Receipt ↔ anchor match | derived | `envelope.record_digest === receipt.record_digest`, recomputed in the browser |
| Mirror verification | `status` | `CONFIRMED` only after read-back |

### 3. The honesty separation that must not blur

The page already distinguishes the payment from the receipt. It now has to
distinguish a **third** thing, and these are three different timestamps on two
different transactions:

| | Payment | Anchor |
|---|---|---|
| What it proves | 0.05 HBAR moved, quote id in the memo | a digest existed at a consensus time |
| Transaction | `0.0.7162784@1784746988.798231156` | a new, separate submit |
| Consensus timestamp | `1784746993.237232768` | assigned later, by the network |
| Without the other | receipt is fully valid | anchor alone proves nothing about delivery |

The wording to keep: **anchoring is additive.** A receipt without an anchor is
complete. An anchor does not confer validity, it adds an independent observation
that the digest existed at a point in time. The page must not imply that the
anchor is what makes the receipt trustworthy — the signature and the reproducible
digest do that, offline, with no chain at all.

### 4. Verification the visitor can perform

Add a "verify anchor" action mirroring the existing "verify receipt" button, and
running the same logic as `tools/verify-anchor.ts`:

1. recompute `canonicalDigest(receipt.record)` in the browser
2. compare it to `envelope.record_digest`
3. recompute the canonical envelope bytes and their digest
4. compare to `envelope_digest`
5. offer the mirror-node URL for the visitor to fetch the message themselves

Step 5 is a link, not a fetch. The demo is a static page with no network
capability, and adding one to prove a point about verifiability would be a poor
trade.

### 5. Error paths to show

The existing demo shows failure paths, and the anchor section should keep that
standard: `PENDING` (submitted, not yet confirmed), `FAILED` with a failure code,
and the digest-mismatch case rendered as a loud negative rather than a hidden
one.

---

## What must NOT be done

- **No placeholder values.** No example topic id, no `0.0.XXXXXX`, no fabricated
  sequence number — not even in a comment. A plausible-looking fake in a demo
  about verifiable evidence is the worst possible failure.
- **Do not set `anchor_status: "ANCHORED"`** until a mirror-node read-back has
  matched the envelope byte for byte.
- **Do not write into `receipt.json`.** `poa_60a1c2220acb7ef835dcdca8` is
  canonical and signed; attaching an anchor after the fact would change a
  published artifact. `attachAnchor()` exists in `receipt.ts` and produces a new
  object — if it is ever used, the result is a *new* file beside the original,
  never a replacement.
- **Do not rebuild the CP-H2 evidence** to mention an anchor retroactively.

---

## Sequencing

```
CP-H7 approved  →  topic created  →  message submitted  →  mirror read-back CONFIRMED
                                                                     ↓
                                                        THEN this patch lands
```

Landing it earlier means shipping a page that describes an anchor which does not
exist. Landing it later means shipping a page that refuses to render.
