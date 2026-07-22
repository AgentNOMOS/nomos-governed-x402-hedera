import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  LocalEd25519Signer,
  SigningBoundaryError,
  verifySignature,
  buildPrepaymentDecisionReceipt,
  verifyPrepaymentDecisionReceipt,
  buildProofOfActionReceipt,
  verifyProofOfActionReceipt,
  attachAnchor,
  type ProofOfActionInput,
} from "../../packages/evidence-receipt/src/index.ts";
import {
  canonicalDigest,
  fixedClock,
  DOMAIN_PROOF_OF_ACTION,
  DOMAIN_PREPAYMENT_DECISION,
  SCHEMA_VERSION,
} from "../../packages/shared-schemas/src/index.ts";
import { evaluate, SpendLedger } from "../../packages/nomos-policy/src/index.ts";
import { T0, PAYER, PAYEE, testSigner, testPolicy, OFFER, AGENT_IDENTITY, authorityScope, REQUEST_BODY } from "../helpers/fixtures.ts";
import { hashEvidenceRequest, validateEvidenceRequest, executeEvidenceRequest, hashEvidenceResult } from "../../services/resource-server/src/evidence-service.ts";

const clock = fixedClock(T0);
const signer = testSigner();
const trustedKeys = { [signer.kid]: signer.publicKeyHex };

const requestHash = hashEvidenceRequest(validateEvidenceRequest(REQUEST_BODY));
const resultHash = hashEvidenceResult(executeEvidenceRequest(validateEvidenceRequest(REQUEST_BODY)));
const TX = `${PAYER}@1700000000.000000001`;

function poaInput(over: Partial<ProofOfActionInput> = {}): ProofOfActionInput {
  return {
    agent_identity: AGENT_IDENTITY as unknown as Record<string, unknown>,
    authority_scope: authorityScope() as unknown as Record<string, unknown>,
    service_identity: OFFER.service,
    offer_id: OFFER.offer_id,
    policy_decision: "ALLOW",
    policy_version: testPolicy().policy_version,
    policy_hash: canonicalDigest(testPolicy()),
    decision_id: `ppd_${"a".repeat(24)}`,
    request_hash: requestHash,
    quote_id: `q_${"b".repeat(24)}`,
    quote_hash: canonicalDigest({ q: 1 }),
    idempotency_key: `idem_${"c".repeat(32)}`,
    nonce: "n_receipt_0001",
    settlement: {
      schema: `nomos.gx402.settlement_evidence.${SCHEMA_VERSION}`,
      source: "MOCK_OFFLINE",
      verified: true,
      network: "hedera:testnet",
      asset: "HBAR",
      atomic_amount: "5000000",
      payer: PAYER,
      payee: PAYEE,
      transaction_id: TX,
      consensus_timestamp: "1700000000.000000001",
      memo: `q_${"b".repeat(24)}`,
      finality: "FINAL",
      checked_at: T0,
      failure_code: null,
    },
    delivery: {
      schema: `nomos.gx402.delivery_evidence.${SCHEMA_VERSION}`,
      idempotency_key: `idem_${"c".repeat(32)}`,
      execution_status: "SUCCEEDED",
      delivery_status: "DELIVERED",
      result_hash: resultHash,
      result_media_type: "application/json",
      result_byte_length: 512,
      executed_at: T0,
      failure_code: null,
      refund_due: false,
    },
    verification: {
      hashscan_transaction_url: "https://hashscan.io/testnet/transaction/0.0.999001-1700000000-000000001",
      mirror_transaction_url: "https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.999001-1700000000-000000001",
      hashscan_topic_url: null,
      mirror_topic_message_url: null,
    },
    clock,
    ...over,
  };
}

describe("signer — key boundary", () => {
  test("the same seed always produces the same key", () => {
    assert.equal(LocalEd25519Signer.fromSeed(Buffer.alloc(32, 7)).publicKeyHex, signer.publicKeyHex);
  });

  test("a generated key differs from the fixture key", () => {
    assert.notEqual(LocalEd25519Signer.generate().publicKeyHex, signer.publicKeyHex);
  });

  test("loading a key from the production signing directory is refused", () => {
    for (const p of [
      "/srv/nomos/signing/passport/issuer_ed25519.key",
      "/srv/nomos/verify/prod/whatever.key",
      "/opt/nomos-preflight/x.key",
      "/root/.hedera-testnet-keys.json",
      "/root/ops/sec_hedera_a1_quarantine_20260612/anything",
    ]) {
      assert.throws(() => LocalEd25519Signer.fromFile(p, "k"), SigningBoundaryError, `must refuse ${p}`);
    }
  });

  test("a relative path that resolves into a forbidden prefix is still refused", () => {
    assert.throws(
      () => LocalEd25519Signer.fromFile("/srv/nomos/signing/../signing/passport/issuer_ed25519.key", "k"),
      SigningBoundaryError,
    );
  });

  test("a bad seed length is rejected", () => {
    assert.throws(() => LocalEd25519Signer.fromSeed(Buffer.alloc(31)), SigningBoundaryError);
  });
});

describe("signature verification", () => {
  const rec = { a: 1, b: "two" };

  test("a valid signature verifies", () => {
    const block = signer.sign(DOMAIN_PROOF_OF_ACTION, rec);
    assert.equal(verifySignature(rec, block, DOMAIN_PROOF_OF_ACTION, trustedKeys).ok, true);
  });

  test("a modified record fails", () => {
    const block = signer.sign(DOMAIN_PROOF_OF_ACTION, rec);
    const v = verifySignature({ ...rec, a: 2 }, block, DOMAIN_PROOF_OF_ACTION, trustedKeys);
    assert.equal(v.ok, false);
    assert.deepEqual(v.reasons, ["signature_invalid"]);
  });

  test("a signature made under another domain does not verify", () => {
    const block = signer.sign(DOMAIN_PREPAYMENT_DECISION, rec);
    const v = verifySignature(rec, { ...block, signature_domain: DOMAIN_PROOF_OF_ACTION }, DOMAIN_PROOF_OF_ACTION, trustedKeys);
    assert.equal(v.ok, false);
  });

  test("an unknown kid is rejected when a key set is supplied", () => {
    const block = signer.sign(DOMAIN_PROOF_OF_ACTION, rec);
    const v = verifySignature(rec, { ...block, kid: "someone-else" }, DOMAIN_PROOF_OF_ACTION, trustedKeys);
    assert.ok(v.reasons.includes("unknown_kid"));
  });

  test("a self-asserted public key is rejected against the trusted set", () => {
    const other = LocalEd25519Signer.generate(signer.kid);
    const block = other.sign(DOMAIN_PROOF_OF_ACTION, rec);
    const v = verifySignature(rec, block, DOMAIN_PROOF_OF_ACTION, trustedKeys);
    assert.ok(v.reasons.includes("public_key_not_trusted"), "trusting the key inside the document is transcription, not verification");
  });
});

describe("prepayment decision receipt", () => {
  function decide(offerOver: Record<string, unknown> = {}) {
    const r = evaluate(
      {
        schema: `nomos.gx402.policy_preflight_request.${SCHEMA_VERSION}`,
        request_id: "req_r_000001",
        nonce: "n_r_000001",
        agent_identity: AGENT_IDENTITY,
        authority_scope: authorityScope(),
        offer: { ...OFFER, ...offerOver },
        request_hash: requestHash,
        requested_at: T0,
      },
      { policy: testPolicy(), ledger: new SpendLedger(), clock, usedNonces: new Set() },
    );
    return buildPrepaymentDecisionReceipt(r.record, r.decision_id, signer);
  }

  test("an ALLOW receipt verifies", () => {
    assert.deepEqual(verifyPrepaymentDecisionReceipt(decide(), trustedKeys), { ok: true, reasons: [] });
  });

  test("a DENY receipt verifies just as completely", () => {
    const v = verifyPrepaymentDecisionReceipt(decide({ pay_to: "0.0.888888" }), trustedKeys);
    assert.deepEqual(v, { ok: true, reasons: [] });
  });

  test("flipping the decision to another VALID value is still caught", () => {
    // Deliberately schema-legal: an attacker would not choose a value that the
    // validator rejects on sight. ALLOW -> REVIEW passes every structural check
    // and is caught only by the digest and the signature.
    const r = decide();
    (r.record as any).decision = "REVIEW";
    const v = verifyPrepaymentDecisionReceipt(r, trustedKeys);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("record_digest_mismatch"));
    assert.ok(v.reasons.includes("signature_invalid"));
  });

  test("a structurally invalid receipt is rejected at the schema layer, before any crypto", () => {
    const r = decide();
    (r.record as any).decision = "ALLOW_TAMPERED";
    const v = verifyPrepaymentDecisionReceipt(r, trustedKeys);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.every((x) => x.startsWith("schema:")));
  });

  test("tampering with a bound term is caught by bound_terms_digest", () => {
    const r = decide();
    (r.record as any).bound_terms.atomic_amount = "1";
    const v = verifyPrepaymentDecisionReceipt(r, trustedKeys);
    assert.ok(v.reasons.includes("bound_terms_digest_mismatch"));
  });
});

describe("proof-of-action receipt — construction", () => {
  test("a well-formed receipt verifies end to end", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    const v = verifyProofOfActionReceipt(r, { trustedKeys });
    assert.deepEqual(v.reasons, []);
    assert.equal(v.ok, true);
  });

  test("a MOCK settlement is flagged all the way through verification", () => {
    const v = verifyProofOfActionReceipt(buildProofOfActionReceipt(poaInput(), signer), { trustedKeys });
    assert.equal(v.mock_settlement, true, "an offline demo must never read as a real payment");
  });

  test("the receipt id is derived, not random", () => {
    const a = buildProofOfActionReceipt(poaInput(), signer);
    const b = buildProofOfActionReceipt(poaInput(), signer);
    assert.equal(a.receipt_id, b.receipt_id);
    assert.match(a.receipt_id, /^poa_[0-9a-f]{24}$/);
  });

  test("delivery evidence for a different execution is refused at build time", () => {
    assert.throws(
      () => buildProofOfActionReceipt(poaInput({ idempotency_key: `idem_${"d".repeat(32)}` }), signer),
      /IDEMPOTENCY_KEY_MISMATCH/,
    );
  });
});

describe("proof-of-action receipt — manipulation detection", () => {
  const good = () => buildProofOfActionReceipt(poaInput(), signer);

  const MUTATIONS: Array<[string, (r: any) => void]> = [
    ["atomic_amount", (r) => (r.record.atomic_amount = "1")],
    ["payee", (r) => (r.record.payee = "0.0.111111")],
    ["payer", (r) => (r.record.payer = "0.0.222222")],
    ["asset", (r) => (r.record.asset = "0.0.456858")],
    ["hedera_transaction_id", (r) => (r.record.hedera_transaction_id = `${PAYER}@1700000000.000000002`)],
    ["request_hash", (r) => (r.record.request_hash = canonicalDigest({ other: true }))],
    ["result_hash", (r) => (r.record.result_hash = canonicalDigest({ other: true }))],
    ["quote_hash", (r) => (r.record.quote_hash = canonicalDigest({ other: true }))],
    ["policy_hash", (r) => (r.record.policy_hash = canonicalDigest({ other: true }))],
    ["policy_decision", (r) => (r.record.policy_decision = "REVIEW")],
    ["delivery_status", (r) => (r.record.delivery_status = "NOT_DELIVERED")],
    ["agent_identity.did", (r) => (r.record.agent_identity.did = "did:nomos:someone-else")],
    ["idempotency_key", (r) => (r.record.idempotency_key = `idem_${"e".repeat(32)}`)],
  ];

  for (const [field, mutate] of MUTATIONS) {
    test(`mutating ${field} is detected`, () => {
      const r = good();
      mutate(r);
      const v = verifyProofOfActionReceipt(r, { trustedKeys });
      assert.equal(v.ok, false, `${field} mutation must be caught`);
      assert.ok(v.reasons.includes("record_digest_mismatch"));
    });
  }

  test("re-digesting after tampering still fails on the signature", () => {
    const r = good() as any;
    r.record.atomic_amount = "1";
    r.record_digest = canonicalDigest(r.record); // attacker repairs the digest
    const v = verifyProofOfActionReceipt(r, { trustedKeys });
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("signature_invalid"));
  });

  test("re-signing with a foreign key fails against the trusted key set", () => {
    const attacker = LocalEd25519Signer.generate(signer.kid);
    const r = good() as any;
    r.record.atomic_amount = "1";
    r.record_digest = canonicalDigest(r.record);
    r.receipt_id = buildProofOfActionReceipt(poaInput(), attacker).receipt_id;
    r.signature = attacker.sign(DOMAIN_PROOF_OF_ACTION, r.record);
    const v = verifyProofOfActionReceipt(r, { trustedKeys });
    assert.equal(v.ok, false);
    assert.ok(v.reasons.includes("public_key_not_trusted"));
  });
});

describe("proof-of-action receipt — payment/request/result substitution", () => {
  test("a receipt for a different request is caught by the relying party's expectation", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    const v = verifyProofOfActionReceipt(r, { trustedKeys, expected: { request_hash: canonicalDigest({ other: 1 }) } });
    assert.ok(v.reasons.includes("expectation_mismatch:request_hash"));
  });

  test("a receipt for a different result is caught", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    const v = verifyProofOfActionReceipt(r, { trustedKeys, expected: { result_hash: canonicalDigest({ other: 1 }) } });
    assert.ok(v.reasons.includes("expectation_mismatch:result_hash"));
  });

  test("a receipt for a different amount or payee is caught", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    const v = verifyProofOfActionReceipt(r, { trustedKeys, expected: { atomic_amount: "1", payee: "0.0.7" } });
    assert.ok(v.reasons.includes("expectation_mismatch:atomic_amount"));
    assert.ok(v.reasons.includes("expectation_mismatch:payee"));
  });
});

describe("proof-of-action receipt — impossible state combinations", () => {
  test("DELIVERED without FINAL settlement is rejected", () => {
    const input = poaInput();
    input.settlement.finality = "PENDING";
    const r = buildProofOfActionReceipt(input, signer);
    const v = verifyProofOfActionReceipt(r, { trustedKeys });
    assert.ok(v.reasons.includes("delivered_without_final_settlement"));
  });

  test("paid + execution failed must carry refund_due", () => {
    const input = poaInput();
    input.delivery.execution_status = "FAILED";
    input.delivery.delivery_status = "NOT_DELIVERED";
    input.delivery.refund_due = false;
    const r = buildProofOfActionReceipt(input, signer);
    const v = verifyProofOfActionReceipt(r, { trustedKeys });
    assert.ok(v.reasons.includes("paid_and_failed_without_refund_flag"));
  });

  test("paid + execution failed + refund_due is a VALID receipt — the failure is the evidence", () => {
    const input = poaInput();
    input.delivery.execution_status = "FAILED";
    input.delivery.delivery_status = "NOT_DELIVERED";
    input.delivery.refund_due = true;
    const v = verifyProofOfActionReceipt(buildProofOfActionReceipt(input, signer), { trustedKeys });
    assert.deepEqual(v.reasons, []);
  });
});

describe("anchor attachment is additive", () => {
  const anchorRef = (digest: string) => ({
    schema: `nomos.gx402.hcs_anchor_reference.${SCHEMA_VERSION}`,
    source: "MOCK_OFFLINE" as const,
    status: "ANCHORED" as const,
    network: "hedera:testnet" as const,
    anchored_digest: digest,
    topic_id: "0.0.999200",
    sequence_number: 1,
    transaction_id: "0.0.999002@1700000000.000000003",
    consensus_timestamp: "1700000000.000000003",
    anchored_at: T0,
    hashscan_url: "https://hashscan.io/testnet/topic/0.0.999200/message/1",
    mirror_url: null,
    failure_code: null,
  });

  test("a receipt is fully valid before any anchor exists", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    assert.equal(r.anchor, null);
    assert.equal(verifyProofOfActionReceipt(r, { trustedKeys }).ok, true);
  });

  test("attaching a matching anchor keeps it valid", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    const withAnchor = attachAnchor(r, anchorRef(r.record_digest));
    assert.equal(verifyProofOfActionReceipt(withAnchor, { trustedKeys }).ok, true);
  });

  test("an anchor for a different digest is refused at attach time", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    assert.throws(() => attachAnchor(r, anchorRef(canonicalDigest({ other: 1 }))), /ANCHOR_DIGEST_MISMATCH/);
  });

  test("an anchor claiming ANCHORED without a topic reference is rejected by the verifier", () => {
    const r = buildProofOfActionReceipt(poaInput(), signer);
    const a = anchorRef(r.record_digest);
    const withAnchor = attachAnchor(r, { ...a, source: "HEDERA_HCS", topic_id: null, sequence_number: null, transaction_id: null });
    const v = verifyProofOfActionReceipt(withAnchor, { trustedKeys });
    assert.ok(v.reasons.includes("anchor_claims_anchored_without_reference"));
  });
});
