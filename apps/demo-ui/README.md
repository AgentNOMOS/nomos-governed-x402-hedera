# Demo UI — CP-H8

A single, self-contained page that presents the CP-H2 evidence: a policy-bound
x402 payment settled on Hedera testnet, verified against Mirror Node data, and
carried by a tamper-evident proof-of-action receipt.

It is **local and staged**. Nothing here is deployed, no service is started by
it, and it cannot make a payment.

## Preview it

```bash
node apps/demo-ui/serve.ts        # http://127.0.0.1:4408/   (npm run demo:preview)
```

Or open the file directly — the page is written so that this works:

```
apps/demo-ui/public/index.html
```

The evidence travels as a classic script assigning one frozen global rather than
as JSON fetched at runtime, precisely so `file://` behaves the same as `http://`.
The only thing a server buys you is the asynchronous clipboard API; the copy
buttons fall back to `execCommand` otherwise, and say so when both fail.

`serve.ts` binds `127.0.0.1`, answers `GET` and `HEAD` only, serves a fixed list
of presentation extensions from `public/`, and has no route that writes.

## How a value gets onto the page

```
docs/evidence/cp-h2/{receipt,settlement,result,execute-run}.json
docs/evidence/CP-H2-REPORT.md
        │
        ▼
apps/demo-ui/src/evidence-model.ts     derive + cross-check, or throw
        │
        ▼
apps/demo-ui/src/build.ts              npm run demo:build
        │
        ▼
apps/demo-ui/public/evidence-data.js   GENERATED, committed, deep-frozen
        │
        ▼
apps/demo-ui/public/app.js             render, or refuse to render
```

Nothing skips a step. `index.html` contains no evidence value at all — a test
asserts that the transaction id, the consensus timestamp, the receipt id, the
digest, both accounts and the alias appear nowhere in the markup — so there is
no second place for a number to drift.

```bash
npm run demo:build     # regenerate evidence-data.js
npm run demo:check     # fail if the committed copy is stale
npm test               # the model, the page audit, and everything else
```

## It fails closed, twice

**At build time.** `buildDemoEvidence()` throws rather than emit if the
artifacts disagree on any bound field: memo versus quote id, amount, payer,
payee, transaction id, consensus timestamp, result hash. It also throws if the
record digest does not recompute, if the receipt id does not re-derive, if the
settlement is unverified or marked mock, if the network is not
`hedera:testnet` — or if the receipt has acquired an HCS anchor, because CP-H8
is only able to present anchoring as pending.

**At render time.** `app.js` re-checks the claims the page makes before it shows
anything. If the module is missing, incomplete, or self-contradictory, the page
replaces itself with a stated failure. A demo that renders green ticks over
absent data is worse than one that renders nothing.

## What it deliberately does not do

No wallet connection. No payment function. No “pay now”. No write request, no
network request at all, no third-party asset, no analytics. No receipt creation,
re-creation or re-signing — the in-browser control recomputes SHA-256 over the
canonical form of the *existing* record and compares, which is a check, not a
signature.

## The two graphics

`public/assets/nomosdemo.png` is the primary architecture visual and the social
preview; `public/assets/AgentNOMOS-12-Layer-Architecture-v1.png` is the detail
view inside the collapsed twelve-layer disclosure. Both are committed, both are
declared at their intrinsic size, both are lazy-loaded because both sit far below
the fold. If either file goes missing the page falls back to a named slot rather
than a broken image or an invented diagram. See `public/assets/README.md`.

## Honest status, as the page states it

Testnet demonstration. HCS anchoring pending CP-H7 — the receipt carries
`anchor: null` and is valid without one. No mainnet deployment, no claim of
continuous production autonomy, no independent audit or certification. The
HashScan link is offered for human inspection only: HashScan serves 404 to
non-browser clients, so it could not be machine-checked. The authoritative
verification used Hedera Mirror Node data.
