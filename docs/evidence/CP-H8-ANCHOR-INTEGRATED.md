# CP-H8 — the confirmed anchor, in the demo

**Status: `CP_H8_CONFIRMED_ANCHOR_DEMO_COMPLETE`**
Date: 2026-07-23 · Base: CP-H7F at `e3e3993`

Local integration only. No Hedera transaction, no deployment, no push, and the
CP-H2 receipt is byte-identical.

---

## 1. The logic that was wrong

Two places decided whether an anchor existed by looking at a field inside the
signed receipt:

```js
// apps/demo-ui/public/app.js:100 — before
if (data.receipt.anchor !== null || data.receipt.anchor_status !== "NOT_YET_ANCHORED") {
  return "The receipt carries an HCS anchor. This page is only able to present " +
    "anchoring as pending, so it will not render.";
}
```

```ts
// apps/demo-ui/src/evidence-model.ts:427 — before
must(pick(receipt, "anchor", S.receipt) === null, "ANCHOR_PRESENT",
     "receipt.anchor is not null — CP-H8 may only present HCS as pending");
```

`receipt.anchor` is null and always will be. The receipt is signed over its
canonical bytes, so an anchor written into it would break the signature it
exists to carry. Reading that absence as *nothing is anchored* turned the
correct end state into a false one — and after CP-H7F it was worse than false:
the page would have refused to render at all if anyone had ever "fixed" the
receipt, and it displayed `NOT YET ANCHORED` for a digest that had reached
consensus 40 minutes earlier.

## 2. Where the anchor comes from now

`docs/evidence/cp-h7/anchor-evidence.json`, added to `EVIDENCE_SOURCES` as an
**optional** artifact — absent resolves to `NOT_YET_ANCHORED`, which is not an
error but the honest state before CP-H7F.

Resolution lives in the new `apps/demo-ui/src/anchor-model.ts`. It reads
nothing and fetches nothing: it takes two documents and returns a verdict, so
every branch is reachable from a test without a network, a ledger or a browser.

`receipt.anchor === null` is still asserted — with the code renamed to
`RECEIPT_MODIFIED`. The check is unchanged in force and inverted in meaning: an
inline anchor is refused because it would have broken the signature, not because
the page is unable to present one.

## 3. The status model

| State | Shown as | Meaning |
|---|---|---|
| `CONFIRMED_ON_TESTNET` | CONFIRMED ON HEDERA TESTNET | all checks passed |
| `NOT_YET_ANCHORED` | NOT YET ANCHORED | no anchor evidence exists |
| `ANCHOR_EVIDENCE_INVALID` | ANCHOR EVIDENCE INVALID | evidence exists and does not hold up |
| `LIVE_VERIFICATION_UNAVAILABLE` | LIVE VERIFICATION UNAVAILABLE | a live re-check could not run |

The fourth is a statement about the network and never about the anchor. A failed
fetch must not read as "not anchored" (false) or as "invalid" (an accusation),
and `classifyLiveCheck` enforces that in both the tested implementation and its
browser twin.

## 4. What the page displays when confirmed

Network `Hedera Testnet` · Topic `0.0.9703011` · Sequence `1` · Consensus
`1784818806.041876104 · 2026-07-23T15:00:06Z` · Submit transaction
`0.0.9689846@17…03110569` · `record_digest` `sha256:2bf595c…f71ecdb9` ·
Envelope SHA-256 `sha256:da01c3a…204c43ce` · Message size `585 bytes, one chunk`
· a link to `https://hashscan.io/testnet/topic/0.0.9703011` · and the standing
notice **“Testnet demonstration — not a mainnet production attestation”**.

The prose states four things plainly: the signed receipt was not changed; the
anchor is separate evidence bound by digest; Hedera contributes a consensus
timestamp and an ordering; and the anchor does not replace checking the evidence
chain. Banned phrasings are asserted absent by test — *permanently stored
forever*, *proves the action is true*, *immutable production proof*, *mainnet
verified*.

## 5. Fail-closed checks

Fourteen, all of which must hold, and each is collected rather than
short-circuited so a broken anchor yields the whole list:

```
status_confirmed              receipt_id_matches           record_digest_matches
receipt_digest_reproducible   topic_id_matches             sequence_number_matches
transaction_id_matches        consensus_timestamp_present  envelope_sha256_matches
envelope_bytes_match          anchor_key_reproducible      network_is_testnet
independent_mirror_verified   receipt_left_unmodified
```

Three of them re-derive rather than compare stored strings: the receipt digest is
recomputed from `receipt.record`, the 585 envelope bytes are rebuilt from the
receipt at the pinned `created_at`, and the anchor key is recomputed from the
envelope. The topic and sequence are **pinned constants** — a model that accepted
whatever it was handed could be pointed at a different anchor and would still
render a green tick.

## 6. Tests and scan

```
npm test    536/536 pass  (493 before, +43)
npm run scan  CLEAN, 42 waived WARNs
npm run demo:check  evidence-data.js is current
receipt     poa_60a1c2220acb7ef835dcdca8 — VALID
anchor      verify-anchor.ts --mirror → CONFIRMED, VALID
```

New file `tests/unit/demo-ui-anchor.test.ts` (38 tests) covers every case the
brief listed. Each starts from the real CP-H7 evidence and breaks one thing.

Four existing tests encoded the old, now-wrong behaviour and were updated rather
than deleted, each with the reason written down:

- *“HCS is presented as pending, and only as pending”* → the anchor now comes
  from linked evidence; the receipt still carries `anchor: null` and that is the
  point.
- *“no network call of any kind is issued”* → replaced by a narrower and still
  meaningful pair: nothing fires on load, and there is **exactly one** `fetch` in
  `app.js`, inside a click handler, targeting `a.mirror_url` from the evidence
  rather than a composed string. A live verification that cannot fail is not a
  verification.
- *“liveness is claimed nowhere”* → the blanket ban on uppercase `LIVE` narrowed
  to permit exactly one use: the state whose job is to say the check could not
  run.
- *“the browser-side gate re-checks the claims”* → now asserts the new gate and
  explicitly asserts the old condition is **gone**.

## 7. Visual render check

Rendered headless with `Emulation.setDeviceMetricsOverride` (not `--window-size`,
which clamps the layout viewport to ~500px and makes every responsive rule report
the mobile branch). Screenshots in `docs/evidence/cp-h8/`.

| | Desktop 1440 | Mobile 390 |
|---|---|---|
| Anchor section | 1132 × 961 | 350 × 1632 |
| Horizontal overflow | none | none |
| `#anchor[data-state]` | `CONFIRMED_ON_TESTNET` | same |
| Summary card | `card is-verified`, “CONFIRMED ON HEDERA TESTNET” | same |
| Receipt row | “CONFIRMED ON HEDERA TESTNET” | same |
| “NOT YET ANCHORED” anywhere on the page | absent | absent |
| Integrity alert | hidden — the page renders | hidden |

**Live check, exercised in a real browser:**

```
network available → CONFIRMED ON HEDERA TESTNET — the message on the topic
                    matches the recorded envelope exactly (585 bytes).
network offline   → LIVE VERIFICATION UNAVAILABLE — the mirror node could not be
                    reached. This says nothing about the anchor…
```

### Two defects the render found, both fixed

- **An empty bordered box.** `.anchor-reasons { display: grid }` beat the user
  agent's `[hidden] { display: none }`, so a page with nothing wrong with it drew
  an empty red-outlined error box. Added `.anchor-reasons[hidden] { display: none }`.
- **A false claim in the copy.** The text said opening the page from `file://`
  would make the live check unavailable. It does not: the mirror node sends
  permissive CORS headers and the fetch succeeds from `file://` — verified
  headless. The sentence now names the real causes (offline, blocked host,
  mirror node down), which is what the emulated-offline run actually produced.

## 8. The CP-H2 receipt

```
sha256 before : 7eb1ec4432ddaf8c176d4e8c1ad62744f46d42fce5eabfa8998a4e46e5df1a79
sha256 after  : 7eb1ec4432ddaf8c176d4e8c1ad62744f46d42fce5eabfa8998a4e46e5df1a79
anchor field  : null
verdict       : VALID
```

Byte-identical. Not re-signed, not rewritten, not touched.

## 9. Files

**New**

```
apps/demo-ui/src/anchor-model.ts          resolution + live classification
tests/unit/demo-ui-anchor.test.ts         38 tests
docs/evidence/CP-H8-ANCHOR-INTEGRATED.md  this file
docs/evidence/cp-h8/anchor-{desktop,mobile}.png
```

**Modified**

```
apps/demo-ui/src/evidence-model.ts   anchor source, resolution, card, flow, limitations
apps/demo-ui/public/app.js           gate fixed, anchor renderer, live check
apps/demo-ui/public/index.html       the anchor section
apps/demo-ui/public/styles.css       anchor styles
apps/demo-ui/public/evidence-data.js regenerated
tests/unit/demo-ui-evidence.test.ts  four assertions updated to the new truth
tests/unit/demo-ui-page.test.ts      network and liveness invariants narrowed
docs/IMPLEMENTATION_STATUS.md
```

## 10. Still open

- **The bounty video.** Nothing recorded.
- **The public repository.** Still no remote, nothing pushed. Two blockers
  remain from earlier checkpoints: the git identity decision
  (`NOMOS Governed x402 <contact@tooloracle.io>`), and
  `tools/secret-scan.allow.json` being untracked because `.gitignore:17` matches
  `*secret*` — a fresh clone gets a failing scan and a failing test suite, and
  the 43 written waiver reasons, which are the part a reviewer most wants to
  read, are invisible.
- The demo is served locally only. No deployment was made or requested.
