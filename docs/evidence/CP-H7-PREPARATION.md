# CP-H7 — HCS anchor preparation

**Status: `CP_H7_ANCHOR_READY_AWAITING_OPERATOR_TRANSACTION_APPROVAL`**
Date: 2026-07-23 · No Hedera transaction was created, signed or submitted.

Companion documents: `docs/CP-H7-TRANSACTION-PLAN.md` (what would run, what it
costs, what is irreversible) and `docs/CP-H8-ANCHOR-INTEGRATION-PLAN.md` (how
the demo changes, afterwards).

---

## 1. Starting state, verified

| | |
|---|---|
| Working tree at start | clean, 7 commits, branch `main`, **no remote** |
| Head at start | `5686fc5` (CP-H8 graphics) |
| Test baseline | **375/375 pass** |
| Secret scan baseline | CLEAN, 91 files, 41 waived WARNs |
| Receipt | `poa_60a1c2220acb7ef835dcdca8` re-verified **VALID** against the caller-supplied key set |
| `receipt.anchor` | **`null`** — no anchor claimed anywhere |
| Payer `0.0.9689846` | 0.95 HBAR, key `ECDSA_SECP256K1` |
| Payer transaction history | **exactly 2**, both `CRYPTOTRANSFER` — no topic was ever created |
| `.local/PAYMENT_EXECUTED` | present, untouched |
| `/root/ops/.cp_h2_funding_executed` | present, untouched |
| Quarantine `sec_hedera_a1_quarantine_20260612` | untouched, never opened |
| `NOMOS_GX402_HCS_TOPIC_ID` | empty |
| `NOMOS_GX402_ANCHOR_ENABLED` | `false` |

## 2. Values derived from the artifacts, not assumed

Everything the envelope carries was read out of `docs/evidence/cp-h2/receipt.json`
and cross-checked against `settlement.json` and `result.json`.

| Property | Value |
|---|---|
| `receipt_id` | `poa_60a1c2220acb7ef835dcdca8` |
| `record_digest` | `sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9` |
| Canonical serialization | **RFC 8785 (JCS)** with two restrictions — non-integer numbers rejected, `undefined`/NaN/Infinity rejected. Profile id `RFC8785-JCS/nomos-int-only-v1` |
| Digest algorithm | SHA-256 |
| Digest encoding | `sha256:` + 64 lowercase hex characters |
| Settlement reference | `MIRROR_NODE`, `FINAL`, verified true, 5 000 000 tinybar HBAR, memo = the quote id |
| Hedera transaction id | `0.0.7162784@1784746988.798231156` |
| Consensus timestamp | `1784746993.237232768` |
| Network | `hedera:testnet` |
| Receipt schema | `nomos.gx402.proof_of_action_receipt.v1`, `receipt_version: v1` |
| Signature | Ed25519, kid `nomos-gx402-demo-ed25519-1`, domain `NOMOS_GX402_PROOF_OF_ACTION_V1` |

The digest was independently recomputed from `receipt.record` and matched. Every
later check re-derives it rather than trusting the stored value.

## 3. Existing topic: none, and none may be borrowed

The mirror node shows zero `CONSENSUSCREATETOPIC` on either project account. The
four OracleNet topics that do exist are refused by name in
`FORBIDDEN_TOPIC_IDS` — two are mainnet production, one had key material exposed,
and none is purpose-bound to this project. Full reasoning in the transaction plan.

## 4. The envelope

585 canonical bytes, one HCS chunk, own budget 640, protocol limit 1024:

```json
{"anchor_version":"v2","canonicalization":"RFC8785-JCS/nomos-int-only-v1","created_at":"<UTC at build time>","digest_algorithm":"sha256","env":"TESTNET_DEMO_ONLY","network":"hedera:testnet","purpose":"proof-of-action receipt digest anchor","receipt_id":"poa_60a1c2220acb7ef835dcdca8","receipt_schema_version":"nomos.gx402.proof_of_action_receipt.v1","record_digest":"sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9","schema":"nomos.gx402.anchor.v2","source_consensus_timestamp":"1784746993.237232768","source_transaction_id":"0.0.7162784@1784746988.798231156"}
```

Byte representation: canonical UTF-8, keys sorted by UTF-16 code unit, no
insignificant whitespace. Determinism is total except for `created_at`, which is
our claim about build time and is deliberately distinct from the consensus
timestamp the network assigns.

### Why v2 rather than editing v1

The CP-H1 payload (`t`/`d`/`r`/`ts`/`env`) carries the digest and nothing else.
That serves a reader who already holds the receipt and is useless to one who does
not: they cannot tell which hash function produced the digest, under which
canonicalization, for which receipt schema, or which payment the receipt
describes. v2 adds exactly those bindings and no content.

v1 is untouched. CP-H1 and CP-H2 evidence asserts its shape, and rewriting a
published artifact to fit a later checkpoint is how evidence quietly stops being
evidence.

### What cannot be in it

There is no field capable of carrying request content, result content, a key, a
path, an environment value or a personal identifier — enforced by
`additionalProperties: false` plus `const` literals on six of the thirteen
fields, and asserted by a test that walks every value and requires exactly one
to be a digest.

## 5. Security and idempotency rules

**Fail-closed, before any transaction could exist:**

| Refusal | Code |
|---|---|
| Digest does not reproduce from the record | `RECORD_DIGEST_NOT_REPRODUCIBLE` |
| Envelope names a different receipt | `RECEIPT_ID_MISMATCH` |
| Envelope anchors a different digest | `RECORD_DIGEST_MISMATCH` |
| Not testnet | `NETWORK_MISMATCH` |
| Foreign canonicalization profile | `CANONICALIZATION_MISMATCH` |
| Wrong receipt schema | `RECEIPT_SCHEMA_MISMATCH` |
| Source payment or consensus time disagrees | `SOURCE_TX_MISMATCH`, `SOURCE_CONSENSUS_TS_MISMATCH` |
| Receipt already carries an anchor | `RECEIPT_ALREADY_ANCHORED` |
| Envelope over the byte budget | `ENVELOPE_OVERSIZED` |
| Any schema violation | `ENVELOPE_SCHEMA_INVALID` |

**Idempotency, two independent guards, because they fail in different situations:**

- `anchor_key` = `anc_` + SHA-256 over `(network, receipt_id, record_digest)`,
  truncated to 24 hex. Time-invariant, so the same receipt yields the same key on
  any machine and any rerun.
- `.local/HCS_ANCHOR_EXECUTED`, written **the moment a transaction id exists** —
  not when the result is good. This is the CP-H2 lesson wired in: there, the
  payment succeeded and the run aborted before the budget marker was written,
  leaving the money spent and the lock open.
- A pre-submit **mirror-node scan of the topic** catches a duplicate created by
  another machine, which a local marker cannot. Refusing to proceed on an
  unscanned topic (`TOPIC_NOT_SCANNED`) is the difference between idempotent and
  lucky.

**Authorization is a parsed document, not a file that exists.** The grant names
the topic, the receipt, the digest, a transaction budget and an expiry, and every
one is checked against what is about to happen. This is a direct lesson from a
sibling system that gated a paid endpoint on `os.path.exists()`: an unrelated
rollback deleted the file, and because existence was the entire authorization
language, there was no way to reissue it with a scope or an expiry. Recovery
failed closed twice.

**`CONFIRMED` is a statement about the ledger.** A submit writes `SUBMITTED`.
Only a mirror-node read-back whose bytes equal the envelope byte for byte
promotes it. `verifyAnchorEvidence` reports `confirmed_without_observation` if
anything tries to shortcut that.

## 6. Files

**New**

```
packages/hcs-anchor/src/anchor-envelope.ts    envelope, canonical bytes, binding checks
packages/hcs-anchor/src/anchor-verifier.ts    independent verifier + duplicate scan
packages/hcs-anchor/src/anchor-guard.ts       grant parsing + preflight verdict
tools/anchor-receipt.ts                       dry run (default) / execute (gated, refuses)
tools/verify-anchor.ts                        standalone verifier CLI
tests/unit/anchor-envelope.test.ts            52 tests
docs/CP-H7-TRANSACTION-PLAN.md
docs/CP-H8-ANCHOR-INTEGRATION-PLAN.md
docs/evidence/CP-H7-PREPARATION.md            this file
docs/evidence/cp-h7/anchor-dry-run.json       the dry-run artifact
packages/shared-schemas/schemas/hcs_anchor_envelope.v2.json
packages/shared-schemas/schemas/hcs_anchor_evidence.v1.json
```

**Modified**

```
packages/shared-schemas/src/schemas.ts   + 2 schemas, + anchor literals
packages/hcs-anchor/src/index.ts         + 3 exports
tools/emit-schemas.ts                    filename now follows $id (see below)
tests/unit/schemas.test.ts               8 → 10 schemas
package.json                             + 3 scripts, + 1 direct dependency
docs/IMPLEMENTATION_STATUS.md            CP-H7 rows; stale CP-H8 row corrected
```

Two changes worth calling out because they were not in the brief:

- **`tools/emit-schemas.ts` named every emitted file `<name>.v1.json`** regardless
  of the `$id` inside it. With a v2 schema in the registry that produced
  `hcs_anchor_envelope.v1.json` containing `"$id": ".../hcs_anchor_envelope.v2.json"`
  — a trap for exactly the third-party verifier those files exist to serve. The
  filename now derives from the `$id` and the emitter throws if it cannot.
- **`docs/IMPLEMENTATION_STATUS.md` still listed the demo UI as "not built"**
  although CP-H8 shipped it in commits `a0c4167` and `5686fc5`. That file calls
  itself the honest ledger; adding CP-H7 rows while leaving a false CP-H8 row
  would have been knowingly publishing an untrue line. Corrected.

**Dependency:** `@hiero-ledger/sdk` promoted from transitive to direct, pinned to
`2.85.0` — the exact version `@x402/hedera` already resolves, so no new code
enters the tree. Needed because `@x402/hedera` re-exports the transfer classes
but not `TopicCreateTransaction` / `TopicMessageSubmitTransaction`. It is imported
**dynamically, inside the guard's allowed branch only**, and a test asserts no
SDK appears in any module-scope import of `anchor-receipt.ts`.

## 7. Tests and scans

```
npm test    427/427 pass  (375 before, +52 new)
npm run scan  CLEAN, 103 files, 43 waived WARNs
```

The 52 new tests cover every case the brief listed: valid envelope, tampered
digest, wrong receipt id, wrong network, wrong transaction id, wrong consensus
timestamp, double submit, missing evidence, corrupted evidence, replay, wrong
topic, oversized message, missing credentials, and dry-run-without-ledger-write.

Three of them are worth singling out:

- The suite runs against the **real CP-H2 receipt**, not a fixture. A builder that
  works on a synthetic receipt and not on the one we shipped would pass a test
  suite and fail the only case that matters.
- `a coherently-rehashed mainnet receipt is still refused, by network` exists
  because the obvious mainnet test only proves ordering: the digest check fires
  first. A receipt genuinely issued for mainnet would have a reproducible digest,
  so the network check has to stand on its own.
- `the anchor tool source imports no Hedera SDK at module scope` reads the tool's
  own source. It is the only way to assert that a dry run *cannot* construct a
  transaction, rather than merely observing that it did not.

The OracleNet topic ids are referenced through `FORBIDDEN_TOPIC_IDS` rather than
spelled out, because the secret scanner flags them as production identifiers —
and it is right to.

## 8. Dry-run result

```
receipt          : poa_60a1c2220acb7ef835dcdca8
receipt verdict  : VALID
anchor key       : anc_cd5991bdb525e4662dc6f050
byte length      : 585  (budget 640, protocol chunk limit 1024)
envelope digest  : sha256:<over the canonical bytes, printed per run>

── preflight guard ───────────────────────────────────────────
network          : hedera:testnet
anchor enabled   : false
configured topic : <unset>
grant document   : absent or invalid
executed marker  : absent
payer key file   : present (contents never read here)
topic scanned    : no
duplicate anchor : none found
planned txs      : 2
verdict          : BLOCKED
  blocker       : ANCHOR_DISABLED:NOMOS_GX402_ANCHOR_ENABLED is not true
  blocker       : NO_GRANT:.local/HCS_ANCHOR_AUTHORIZED is absent or not a valid grant document
```

`--execute` reaches the same verdict and exits 1 without preparing, signing or
sending anything.

## 9. Ledger unchanged

Confirmed after all work, read-only against the public mirror node:

```
payer 0.0.9689846   balance 95 000 000 tinybar (0.95 HBAR)  — unchanged
payer transactions  2, both CRYPTOTRANSFER                  — unchanged
topics created      0                                       — unchanged
```

No production service was touched. Nothing outside
`/root/nomos-governed-x402-hedera` was modified.

## 10. Found in passing — blocks the public repository, not this checkpoint

**`tools/secret-scan.allow.json` is not in the repository.** `.gitignore:17`
matches `*secret*`, which catches the scanner's own allowlist. It is therefore
untracked, and `git ls-files` returns nothing for it.

Measured, by temporarily moving the file aside and restoring it:

```
without the allowlist:  npm run scan → FAIL, 43 unwaived warnings
                        npm test     → 426/427, secret-scan suite fails
```

So the repository as it would be pushed does not build its own security posture:
anyone who clones it gets a failing test suite and a failing scan, and the 43
waivers — each with a written, defensible reason — are invisible to review. The
waivers are the part a reviewer most wants to read.

This is pre-existing (41 of the 43 predate CP-H7) and out of scope here, because
the fix touches `.gitignore` and a security file rather than anchor preparation.
**It must be resolved before the bounty's public-repository step**, together with
the git-identity question already open in the CP-H2 handoff.

## 11. Awaiting approval

1. The two transactions (topic create + message submit).
2. Admin key — **immutable** proposed, irreversible either way.
3. Submit key — **public** proposed.
4. The topic memo text, permanent if immutable.
5. The grant expiry window.

Nothing proceeds until those are answered. The topic-creation tool is
deliberately unwritten so that the first person to run it does not decide, by
default, whether the topic is immutable forever.
