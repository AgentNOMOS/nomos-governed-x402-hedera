/**
 * GENERATED FILE — do not edit.
 *
 * Produced by `node apps/demo-ui/src/build.ts` from the canonical artifacts
 * listed in `sources` below. Every value on the demo page comes from here.
 *
 * Read-only by construction: the object is deep-frozen and the page never
 * writes to it. There is no payment path, no wallet and no network call.
 */
(function (root) {
  "use strict";

  var EVIDENCE = {
  "generated_by": "apps/demo-ui/src/build.ts — do not edit the generated file by hand",
  "checkpoint": "CP-H2",
  "data_mode": "RECORDED_EVIDENCE",
  "environment": "TESTNET_DEMO_ONLY",
  "disclaimer": "Demo artifact on Hedera testnet. Not a certification, not legal advice, not a guarantee of service quality.",
  "sources": [
    "docs/evidence/cp-h2/receipt.json",
    "docs/evidence/cp-h2/settlement.json",
    "docs/evidence/cp-h2/result.json",
    "docs/evidence/cp-h2/execute-run.json",
    "docs/evidence/CP-H2-REPORT.md",
    "docs/evidence/cp-h7/anchor-evidence.json"
  ],
  "chain": {
    "network": "hedera:testnet",
    "network_label": "Hedera Testnet",
    "asset": "HBAR",
    "atomic_amount": "5000000",
    "amount_display": "0.05 HBAR",
    "transaction_id": "0.0.7162784@1784746988.798231156",
    "transaction_status": "SUCCESS",
    "consensus_timestamp": "1784746993.237232768",
    "consensus_utc": "2026-07-22T19:03:13Z",
    "memo": "q_6eb0be075ceaee4b92d86575",
    "quote_id": "q_6eb0be075ceaee4b92d86575",
    "payer": "0.0.9689846",
    "payee": "0.0.9689904",
    "payee_evm_alias": "0x98eca0a3f742ddc7791fc64b9cb2e226340607d5",
    "fee_payer": "0.0.7162784",
    "settlement_source": "MIRROR_NODE",
    "settlement_finality": "FINAL",
    "hashscan_url": "https://hashscan.io/testnet/transaction/0.0.7162784-1784746988-798231156",
    "mirror_url": "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.7162784-1784746988-798231156"
  },
  "receipt": {
    "receipt_id": "poa_60a1c2220acb7ef835dcdca8",
    "verdict": "VALID",
    "record_digest": "sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9",
    "signature": {
      "alg": "Ed25519",
      "kid": "nomos-gx402-demo-ed25519-1",
      "signature_domain": "NOMOS_GX402_PROOF_OF_ACTION_V1",
      "canonicalization": "RFC8785-JCS/nomos-int-only-v1",
      "public_key_hex": "593ad93fa6ebbdabada18f9be12f391b32c5d2c487080d8d79f156c943ea21e9"
    },
    "anchor": null,
    "anchor_status": "CONFIRMED ON HEDERA TESTNET",
    "mock_settlement": false,
    "record": {
      "agent_identity": {
        "did": "did:nomos:gx402-demo-agent",
        "public_key_hex": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "key_type": "Ed25519",
        "label": "cp-h2-buyer"
      },
      "authority_scope": {
        "scopes": [
          "evidence:read"
        ],
        "granted_by": "did:nomos:gx402-demo-operator",
        "valid_until": "2026-07-23T19:03:11Z",
        "delegation_hash": null
      },
      "service_identity": {
        "service_id": "nomos-gx402-evidence",
        "resource_url": "http://127.0.0.1:4402/v1/evidence",
        "http_method": "POST"
      },
      "offer_id": "evidence.basic.v1",
      "policy_decision": "ALLOW",
      "policy_version": "nomos-gx402-demo-1.0.0",
      "policy_hash": "sha256:aea1ba25f1ef3f8aa35e5badab77c869f5205571371f73328fe35da3e1fc9efd",
      "decision_id": "ppd_0ede8b56a28eaa786ec4796a",
      "request_hash": "sha256:c7dc3cdf13eeff7c42274882bb3245c073ca0adad736a49d83ddb80f78b9bbac",
      "quote_id": "q_6eb0be075ceaee4b92d86575",
      "quote_hash": "sha256:5155f479779d6c59956c709ea548f6e0efb6b5dde24ea6a0c897d8914b981aa2",
      "idempotency_key": "idem_528bc5d663e7d4dbf8a55699f0746492",
      "nonce": "n_mrwga0d4mklhhizt",
      "network": "hedera:testnet",
      "asset": "HBAR",
      "atomic_amount": "5000000",
      "payer": "0.0.9689846",
      "payee": "0.0.9689904",
      "hedera_transaction_id": "0.0.7162784@1784746988.798231156",
      "consensus_timestamp": "1784746993.237232768",
      "settlement_source": "MIRROR_NODE",
      "settlement_finality": "FINAL",
      "execution_status": "SUCCEEDED",
      "delivery_status": "DELIVERED",
      "result_hash": "sha256:3b7962cf05770f754f3966144ce99b3dc68c302977be6c3886fe51bb45210c8f",
      "refund_due": false,
      "receipt_timestamp": "2026-07-22T19:08:11Z",
      "environment": "TESTNET_DEMO_ONLY",
      "disclaimer": "Demo artifact on Hedera testnet. Not a certification, not legal advice, not a guarantee of service quality."
    },
    "verify_command": "node tools/verify-receipt.ts docs/evidence/cp-h2/receipt.json \\\n  nomos-gx402-demo-ed25519-1=593ad93fa6ebbdabada18f9be12f391b32c5d2c487080d8d79f156c943ea21e9"
  },
  "delivery": {
    "execution_status": "SUCCEEDED",
    "delivery_status": "DELIVERED",
    "result_hash": "sha256:3b7962cf05770f754f3966144ce99b3dc68c302977be6c3886fe51bb45210c8f",
    "result_media_type": "application/json",
    "result_byte_length": 547,
    "result_generated_from": "SYNTHETIC_DETERMINISTIC_FIXTURE",
    "result_summary": {
      "pass": 3,
      "fail": 1,
      "unknown": 0
    },
    "refund_due": false
  },
  "policy": {
    "decision": "ALLOW",
    "decision_code": "ALLOW_WITHIN_POLICY",
    "decision_id": "ppd_0ede8b56a28eaa786ec4796a",
    "policy_version": "nomos-gx402-demo-1.0.0",
    "policy_hash": "sha256:aea1ba25f1ef3f8aa35e5badab77c869f5205571371f73328fe35da3e1fc9efd",
    "authorizes_payment": false,
    "checks": [
      {
        "code": "schema_valid",
        "klass": "hard",
        "passed": true,
        "detail": "ok"
      },
      {
        "code": "network_allowed",
        "klass": "hard",
        "passed": true,
        "detail": "offered=hedera:testnet allowed=hedera:testnet"
      },
      {
        "code": "asset_allowed",
        "klass": "hard",
        "passed": true,
        "detail": "offered=HBAR allowed=HBAR"
      },
      {
        "code": "payee_allowed",
        "klass": "hard",
        "passed": true,
        "detail": "offered=0x98eca0a3f742ddc7791fc64b9cb2e226340607d5"
      },
      {
        "code": "amount_wellformed",
        "klass": "hard",
        "passed": true,
        "detail": "atomic_amount=5000000 (decimal string, integer only)"
      },
      {
        "code": "amount_within_per_payment_cap",
        "klass": "hard",
        "passed": true,
        "detail": "amount=5000000 cap=10000000"
      },
      {
        "code": "cumulative_cap",
        "klass": "hard",
        "passed": true,
        "detail": "spent=0 + 5000000 vs cap=200000000"
      },
      {
        "code": "daily_count_cap",
        "klass": "hard",
        "passed": true,
        "detail": "day=2026-07-22 count=0 cap=50"
      },
      {
        "code": "authority_scope_covers_request",
        "klass": "hard",
        "passed": true,
        "detail": "have=[evidence:read] need=[evidence:read]"
      },
      {
        "code": "authority_not_expired",
        "klass": "hard",
        "passed": true,
        "detail": "valid_until=2026-07-23T19:03:11Z now=2026-07-22T19:03:11Z"
      },
      {
        "code": "nonce_unused",
        "klass": "hard",
        "passed": true,
        "detail": "fresh"
      },
      {
        "code": "amount_below_review_threshold",
        "klass": "review",
        "passed": true,
        "detail": "amount=5000000 review_at>=8000000 (80% of per-payment cap)"
      }
    ]
  },
  "anchor": {
    "state": "CONFIRMED_ON_TESTNET",
    "label": "CONFIRMED ON HEDERA TESTNET",
    "reasons": [],
    "checks": [
      {
        "id": "status_confirmed",
        "ok": true
      },
      {
        "id": "receipt_id_matches",
        "ok": true
      },
      {
        "id": "record_digest_matches",
        "ok": true
      },
      {
        "id": "receipt_digest_reproducible",
        "ok": true
      },
      {
        "id": "topic_id_matches",
        "ok": true
      },
      {
        "id": "sequence_number_matches",
        "ok": true
      },
      {
        "id": "transaction_id_matches",
        "ok": true
      },
      {
        "id": "consensus_timestamp_present",
        "ok": true
      },
      {
        "id": "envelope_sha256_matches",
        "ok": true
      },
      {
        "id": "envelope_bytes_match",
        "ok": true
      },
      {
        "id": "anchor_key_reproducible",
        "ok": true
      },
      {
        "id": "network_is_testnet",
        "ok": true
      },
      {
        "id": "independent_mirror_verified",
        "ok": true
      },
      {
        "id": "receipt_left_unmodified",
        "ok": true
      }
    ],
    "network": "hedera:testnet",
    "topic_id": "0.0.9703011",
    "sequence_number": 1,
    "transaction_id": "0.0.9689846@1784818787.803110569",
    "transaction_id_short": "0.0.9689846@17…03110569",
    "consensus_timestamp": "1784818806.041876104",
    "consensus_utc": "2026-07-23T15:00:06Z",
    "record_digest": "sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9",
    "record_digest_short": "sha256:2bf595c…f71ecdb9",
    "envelope_sha256": "sha256:da01c3a29fa2838b935dc873a9149121891d25bf7a61b4d25e57a186204c43ce",
    "envelope_sha256_short": "sha256:da01c3a…204c43ce",
    "envelope_bytes": 585,
    "anchor_key": "anc_cd5991bdb525e4662dc6f050",
    "running_hash_version": 3,
    "charged_fee_display": "0.00695405 HBAR",
    "envelope_canonical": "{\"anchor_version\":\"v2\",\"canonicalization\":\"RFC8785-JCS/nomos-int-only-v1\",\"created_at\":\"2026-07-23T14:59:11Z\",\"digest_algorithm\":\"sha256\",\"env\":\"TESTNET_DEMO_ONLY\",\"network\":\"hedera:testnet\",\"purpose\":\"proof-of-action receipt digest anchor\",\"receipt_id\":\"poa_60a1c2220acb7ef835dcdca8\",\"receipt_schema_version\":\"nomos.gx402.proof_of_action_receipt.v1\",\"record_digest\":\"sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9\",\"schema\":\"nomos.gx402.anchor.v2\",\"source_consensus_timestamp\":\"1784746993.237232768\",\"source_transaction_id\":\"0.0.7162784@1784746988.798231156\"}",
    "hashscan_url": "https://hashscan.io/testnet/topic/0.0.9703011",
    "mirror_url": "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9703011/messages/1",
    "mirror_verified": true,
    "receipt_unmodified": true,
    "testnet_notice": "Testnet demonstration — not a mainnet production attestation"
  },
  "cards": [
    {
      "id": "transaction",
      "label": "Transaction",
      "value": "SUCCESS",
      "state": "verified",
      "note": "CRYPTOTRANSFER, nonce 0, read from the mirror node."
    },
    {
      "id": "network",
      "label": "Network",
      "value": "Hedera Testnet",
      "state": "neutral",
      "note": "Testnet only. No mainnet document is representable in the schema."
    },
    {
      "id": "amount",
      "label": "Amount",
      "value": "0.05 HBAR",
      "state": "verified",
      "note": "5000000 tinybar, credited to the payee exactly."
    },
    {
      "id": "receipt",
      "label": "Receipt",
      "value": "VALID",
      "state": "verified",
      "note": "Proof-of-action receipt, Ed25519, verified against a caller-supplied key."
    },
    {
      "id": "tamper",
      "label": "Tamper test",
      "value": "DETECTED",
      "state": "detected",
      "note": "One field altered → record_digest_mismatch and signature_invalid."
    },
    {
      "id": "replay",
      "label": "Replay test",
      "value": "BLOCKED",
      "state": "detected",
      "note": "The same (network, transaction id) presented twice → REPLAY_DETECTED."
    },
    {
      "id": "anchor",
      "label": "HCS anchor",
      "value": "CONFIRMED ON HEDERA TESTNET",
      "state": "verified",
      "note": "Topic 0.0.9703011, sequence 1. The receipt digest reached consensus; the receipt itself is unchanged."
    }
  ],
  "flow": [
    {
      "index": 1,
      "id": "request",
      "title": "Request received",
      "summary": "An agent asks for a priced resource. The request body is canonicalized and hashed before anything else happens — every later link commits to this hash.",
      "facts": [
        {
          "label": "Resource",
          "value": "http://127.0.0.1:4402/v1/evidence",
          "mono": true
        },
        {
          "label": "Method",
          "value": "POST",
          "mono": true
        },
        {
          "label": "Offer",
          "value": "evidence.basic.v1",
          "mono": true
        },
        {
          "label": "request_hash",
          "value": "sha256:c7dc3cdf13eeff7c42274882bb3245c073ca0adad736a49d83ddb80f78b9bbac",
          "mono": true
        }
      ],
      "evidence_ref": "docs/evidence/cp-h2/execute-run.json"
    },
    {
      "index": 2,
      "id": "policy",
      "title": "Policy decision",
      "summary": "NOMOS evaluates identity, delegated authority, network, asset, payee, amount and spend caps before a price is ever quoted. The decision is signed whether it allows or refuses.",
      "facts": [
        {
          "label": "Decision",
          "value": "ALLOW · ALLOW_WITHIN_POLICY",
          "mono": true
        },
        {
          "label": "Checks passed",
          "value": "12 / 12",
          "mono": false
        },
        {
          "label": "decision_id",
          "value": "ppd_0ede8b56a28eaa786ec4796a",
          "mono": true
        },
        {
          "label": "policy_hash",
          "value": "sha256:aea1ba25f1ef3f8aa35e5badab77c869f5205571371f73328fe35da3e1fc9efd",
          "mono": true
        }
      ],
      "evidence_ref": "docs/evidence/cp-h2/execute-run.json"
    },
    {
      "index": 3,
      "id": "quote",
      "title": "Quote issued",
      "summary": "HTTP 402 carries the x402 accepts[] terms and a NOMOS quote. The quote id is derived from the offer, the request hash and a nonce — it is not a random handle.",
      "facts": [
        {
          "label": "quote_id",
          "value": "q_6eb0be075ceaee4b92d86575",
          "mono": true
        },
        {
          "label": "quote_hash",
          "value": "sha256:5155f479779d6c59956c709ea548f6e0efb6b5dde24ea6a0c897d8914b981aa2",
          "mono": true
        },
        {
          "label": "Valid until",
          "value": "2026-07-22T19:06:11Z",
          "mono": true
        },
        {
          "label": "idempotency_key",
          "value": "idem_528bc5d663e7d4dbf8a55699f0746492",
          "mono": true
        }
      ],
      "evidence_ref": "docs/evidence/cp-h2/execute-run.json"
    },
    {
      "index": 4,
      "id": "x402",
      "title": "x402 verification",
      "summary": "The facilitator's free /verify endpoint checked the signed transfer before a single tinybar moved: memo intact, hollow payer resolvable, alias payee accepted. Had any of it failed, nothing would have been submitted.",
      "facts": [
        {
          "label": "Endpoint",
          "value": "https://api.testnet.blocky402.com/verify",
          "mono": true
        },
        {
          "label": "Response",
          "value": "{\"isValid\":true,\"payer\":\"0.0.9689846\"}",
          "mono": true
        },
        {
          "label": "Fee payer",
          "value": "0.0.7162784",
          "mono": true
        },
        {
          "label": "Scheme",
          "value": "exact · hedera:testnet",
          "mono": true
        }
      ],
      "evidence_ref": "docs/evidence/CP-H2-REPORT.md §3.1, §2.1"
    },
    {
      "index": 5,
      "id": "settlement",
      "title": "Hedera settlement",
      "summary": "The transfer is submitted with the quote id in the transaction memo. @x402/hedera carries no memo field; that binding is this project's addition, and it is the whole point.",
      "facts": [
        {
          "label": "Transaction",
          "value": "0.0.7162784@1784746988.798231156",
          "mono": true
        },
        {
          "label": "Memo",
          "value": "q_6eb0be075ceaee4b92d86575",
          "mono": true
        },
        {
          "label": "Amount",
          "value": "5000000 tinybar (0.05 HBAR)",
          "mono": true
        },
        {
          "label": "Payer → payee",
          "value": "0.0.9689846 → 0.0.9689904",
          "mono": true
        }
      ],
      "evidence_ref": "docs/evidence/cp-h2/settlement.json"
    },
    {
      "index": 6,
      "id": "mirror",
      "title": "Mirror Node verification",
      "summary": "Amount, asset, network, payee and memo are re-read from the public mirror node — not taken from the facilitator's report — and must be FINAL. This is the gate: work is released after settlement, never after verification alone.",
      "facts": [
        {
          "label": "Source",
          "value": "MIRROR_NODE",
          "mono": true
        },
        {
          "label": "Finality",
          "value": "FINAL",
          "mono": true
        },
        {
          "label": "Consensus",
          "value": "1784746993.237232768",
          "mono": true
        },
        {
          "label": "Payer derived from",
          "value": "the ledger transfer list, not the facilitator",
          "mono": false
        }
      ],
      "evidence_ref": "docs/evidence/cp-h2/settlement.json"
    },
    {
      "index": 7,
      "id": "receipt",
      "title": "Proof-of-Action receipt",
      "summary": "One Ed25519 signature over a canonical record binding identity, authority, policy, request, quote, payment and the hash of what was delivered. No request or result content is ever inside it.",
      "facts": [
        {
          "label": "receipt_id",
          "value": "poa_60a1c2220acb7ef835dcdca8",
          "mono": true
        },
        {
          "label": "record_digest",
          "value": "sha256:2bf595c132c714fc375449c66eb05bc5e0d236d8f04cfba717b00fe9f71ecdb9",
          "mono": true
        },
        {
          "label": "result_hash",
          "value": "sha256:3b7962cf05770f754f3966144ce99b3dc68c302977be6c3886fe51bb45210c8f",
          "mono": true
        },
        {
          "label": "Anchor",
          "value": "receipt.anchor stays null — the anchor is separate evidence on topic 0.0.9703011 #1",
          "mono": false
        }
      ],
      "evidence_ref": "docs/evidence/cp-h2/receipt.json"
    },
    {
      "index": 8,
      "id": "adversarial",
      "title": "Tamper and replay validation",
      "summary": "The receipt was attacked on purpose. Altering one field breaks the digest and the signature; presenting the same settled transaction twice is refused by the replay guard.",
      "facts": [
        {
          "label": "Tamper probe",
          "value": "atomic_amount 5000000 → 1 ⇒ INVALID",
          "mono": false
        },
        {
          "label": "Reasons",
          "value": "record_digest_mismatch, signature_invalid",
          "mono": true
        },
        {
          "label": "Replay probe",
          "value": "1st fresh, 2nd consumed, reclaim throws",
          "mono": false
        },
        {
          "label": "Guard",
          "value": "REPLAY_DETECTED on (network, transaction_id)",
          "mono": true
        }
      ],
      "evidence_ref": "docs/evidence/CP-H2-REPORT.md"
    }
  ],
  "onchain": [
    {
      "id": "tx",
      "label": "Transaction ID",
      "value": "0.0.7162784@1784746988.798231156",
      "copyable": true,
      "hint": "The id belongs to the fee payer — the facilitator submits and pays the network fee."
    },
    {
      "id": "status",
      "label": "Transaction status",
      "value": "SUCCESS",
      "copyable": false,
      "hint": "CRYPTOTRANSFER, nonce 0."
    },
    {
      "id": "consensus",
      "label": "Consensus timestamp",
      "value": "1784746993.237232768",
      "copyable": true,
      "hint": "2026-07-22T19:03:13Z"
    },
    {
      "id": "memo",
      "label": "Memo (quote_id)",
      "value": "q_6eb0be075ceaee4b92d86575",
      "copyable": true,
      "hint": "Identical to the quote id in the receipt. This is the binding."
    },
    {
      "id": "amount",
      "label": "Amount",
      "value": "5000000 tinybar · 0.05 HBAR",
      "copyable": true,
      "hint": "Decimal string throughout; never a float."
    },
    {
      "id": "payer",
      "label": "Payer",
      "value": "0.0.9689846",
      "copyable": true,
      "hint": "Derived from the ledger transfer list."
    },
    {
      "id": "payee",
      "label": "Payee",
      "value": "0.0.9689904",
      "copyable": true,
      "hint": "Auto-created from the EVM alias by this very transaction."
    },
    {
      "id": "alias",
      "label": "Payee EVM alias",
      "value": "0x98eca0a3f742ddc7791fc64b9cb2e226340607d5",
      "copyable": true,
      "hint": "The address the 402 challenge advertised as pay_to."
    },
    {
      "id": "network",
      "label": "Network",
      "value": "hedera:testnet · Hedera Testnet",
      "copyable": false,
      "hint": "Testnet. No mainnet claim is made anywhere on this page."
    },
    {
      "id": "receipt",
      "label": "Receipt ID",
      "value": "poa_60a1c2220acb7ef835dcdca8",
      "copyable": true,
      "hint": "poa_ ids are a truncated hash of (idempotency key, transaction id, record digest)."
    },
    {
      "id": "source",
      "label": "Settlement source",
      "value": "MIRROR_NODE",
      "copyable": false,
      "hint": "The authoritative check ran against Hedera Mirror Node data."
    }
  ],
  "verification": [
    {
      "id": "mirror",
      "check": "Mirror node",
      "result": "PASS",
      "detail": "Transaction indexed, result SUCCESS.",
      "state": "verified"
    },
    {
      "id": "memo",
      "check": "Memo binding",
      "result": "PASS",
      "detail": "Memo equals quote_id q_6eb0be075ceaee4b92d86575.",
      "state": "verified"
    },
    {
      "id": "amount",
      "check": "Amount",
      "result": "PASS",
      "detail": "Payee credited exactly 5000000 tinybar.",
      "state": "verified"
    },
    {
      "id": "payer",
      "check": "Payer",
      "result": "PASS",
      "detail": "0.0.9689846, derived from the ledger rather than the facilitator's report.",
      "state": "verified"
    },
    {
      "id": "payee",
      "check": "Payee / alias",
      "result": "PASS",
      "detail": "Alias 0x98eca0a3f742ddc7791fc64b9cb2e226340607d5 resolved to 0.0.9689904.",
      "state": "verified"
    },
    {
      "id": "request-replay",
      "check": "Request replay",
      "result": "PASS",
      "detail": "Recomputed request hash matches the quote.",
      "state": "verified"
    },
    {
      "id": "policy-replay",
      "check": "Policy replay",
      "result": "PASS",
      "detail": "Recomputed policy hash matches the signed decision.",
      "state": "verified"
    },
    {
      "id": "result-hash",
      "check": "Result hash",
      "result": "PASS",
      "detail": "Recomputed from a fresh execution of the same deterministic service.",
      "state": "verified"
    },
    {
      "id": "receipt",
      "check": "Receipt validation",
      "result": "PASS",
      "detail": "VALID under the standalone verifier with a caller-supplied key set; no mock warning.",
      "state": "verified"
    },
    {
      "id": "tamper",
      "check": "Tamper probe",
      "result": "DETECTED",
      "detail": "atomic_amount 5000000 → 1 ⇒ INVALID: record_digest_mismatch, signature_invalid.",
      "state": "detected"
    },
    {
      "id": "replay",
      "check": "Receipt replay",
      "result": "DETECTED",
      "detail": "Same (network, transaction id) twice ⇒ first fresh, second consumed, reclaim throws REPLAY_DETECTED.",
      "state": "detected"
    },
    {
      "id": "hollow",
      "check": "Hollow-account completion",
      "result": "PASS",
      "detail": "Payer key null → ECDSA_SECP256K1 025da46e31ec…, matching the local demo key.",
      "state": "verified"
    },
    {
      "id": "tests",
      "check": "Test suite at CP-H2",
      "result": "250 / 250",
      "detail": "Offline unit, integration and end-to-end tests, as recorded at that checkpoint. This page's own tests were added afterwards, so the figure is labelled rather than restated as current.",
      "state": "verified"
    },
    {
      "id": "scan",
      "check": "Secret scan at CP-H2",
      "result": "CLEAN",
      "detail": "73 files scanned, no key material and no production identifier — 0 errors, 0 unwaived warnings.",
      "state": "verified"
    },
    {
      "id": "hashscan",
      "check": "HashScan",
      "result": "PRESENTATION ONLY",
      "detail": "HashScan serves 404 to non-browser clients, so the link could not be machine-checked. The authoritative verification used Mirror Node data.",
      "state": "pending"
    }
  ],
  "failClosed": {
    "http_status": 402,
    "error": "SETTLEMENT_UNVERIFIED:amount_mismatch",
    "outcome": "EXECUTE_FAILED",
    "observed": {
      "atomic_amount": "0",
      "payer": "0.0.0",
      "memo": "null",
      "finality": "FAILED",
      "failure_code": "amount_mismatch"
    },
    "cause": "GET /transactions/{id} returns every record sharing that id. Hedera auto-account creation added two children — one creating the payee, one completing the hollow payer — and on the live network they sorted ahead of the transfer. The verifier read transactions[0], a CRYPTOUPDATEACCOUNT with no memo and no user transfers, and compared every field against it.",
    "fix": "selectUserTransaction() now picks the CRYPTOTRANSFER with nonce 0, then any nonce-0 record, then any CRYPTOTRANSFER — and returns null rather than guessing.",
    "regression": "tests/unit/child-records.test.ts — 9 tests built on the actual three-record response, including one asserting that the old behaviour reproduces exactly this failure.",
    "consequences": [
      "Nothing was delivered on unverified evidence. The refusal is the designed behaviour, applied to a payment that happened to be good.",
      "No second payment was made. The receipt was completed against the settlement that had already happened, because a second payment would not be the one the receipt describes.",
      "The ordering rule was tested by a real disagreement between two sources of truth, not by a unit test."
    ]
  },
  "limitations": [
    "Testnet demonstration. Hedera testnet HBAR has no monetary value and no mainnet deployment exists.",
    "The HCS anchor records that this digest existed at a consensus timestamp and in what order. It does not attest that the underlying work was correct, and it does not replace checking the evidence chain itself.",
    "The receipt carries anchor: null and is valid without an anchor. Anchoring is additive: the signed artifact was never edited, and the anchor is separate evidence bound to it by receipt_id and record_digest.",
    "This page renders recorded evidence from committed artifacts. It performs no live query and asserts no continuous production autonomy.",
    "No further payment is required or possible from this page: it has no wallet connection, no payment function and no write path of any kind.",
    "HashScan links are offered for human inspection only. HashScan serves 404 to non-browser clients, so they remain a presentation check.",
    "The authoritative verification used Hedera Mirror Node data. No independent third party has audited or certified this system.",
    "Caps, replay keys and the quote store are in-memory for the demonstration; they are not durable across restarts."
  ]
};

  function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.getOwnPropertyNames(value).forEach(function (key) {
      deepFreeze(value[key]);
    });
    return Object.freeze(value);
  }

  root.__NOMOS_EVIDENCE__ = deepFreeze(EVIDENCE);
})(typeof globalThis !== "undefined" ? globalThis : this);
