# Security Policy

## Scope

This is a **testnet demonstration**. It moves test-value HBAR on Hedera testnet
and nothing else. It is not audited, not certified, and not intended to custody
anything of value.

## Reporting

Open a GitHub issue for anything that is not itself a secret. If a report would
require disclosing a key, a token or a live endpoint, say so in the issue
without including the value and a private channel will be arranged.

## What we consider a vulnerability here

The threat model this project actually claims to address:

| Claim | A break would be |
|---|---|
| A receipt cannot be altered without detection | any mutation of `record` that still verifies |
| A payment cannot be re-used | a settled transaction releasing work twice |
| A payment is bound to one request | delivery for a request other than the one quoted |
| Delivery requires FINAL settlement | work released on an unverified or non-final payment |
| Caps are enforced before payment | a payment exceeding a cap reaching the chain |
| Quotes expire | an expired quote being honoured |
| A mock cannot pass as real | an artifact with `MOCK_OFFLINE` that reads as on-chain evidence |
| No content goes on-chain | request or result data appearing in an HCS message |

## What is out of scope

* Denial of service against a demo endpoint.
* The synthetic evidence corpus being fictional — it is fiction on purpose.
* Anything in the production estate this repository was isolated from. It is not
  part of this project, is not reachable from this code, and reports about it do
  not belong here.

## Key handling

See [`docs/SECURITY_BOUNDARIES.md`](docs/SECURITY_BOUNDARIES.md). In short: the
payer key lives only in an isolated signer process, the receipt signing key is a
throwaway, and neither ever reaches an agent, an LLM context, a log, a receipt
or an HCS message. `npm run scan` fails the build on committed key material.
