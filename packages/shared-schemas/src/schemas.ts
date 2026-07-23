/**
 * Canonical, versioned schemas for NOMOS Governed x402 on Hedera.
 *
 * This TypeScript module is the SINGLE SOURCE OF TRUTH. The JSON files under
 * `packages/shared-schemas/schemas/` are generated from it (`npm run schemas:emit`)
 * for interop and for anyone who wants to validate a receipt without running
 * our code.
 *
 * Design rules that apply to every schema here:
 *   - `additionalProperties: false` everywhere. An unbound field is an unsigned
 *     field, and an unsigned field is a hole in the evidence.
 *   - Atomic amounts are DECIMAL STRINGS, never numbers. tinybar values exceed
 *     nothing dangerous today, but "amount as float" is the classic money bug
 *     and the type system should make it impossible rather than unlikely.
 *   - `network` is pinned to `hedera:testnet` by const, not by convention.
 *     A mainnet document cannot even be represented.
 *   - No free-text request or result content. Only canonical hashes.
 */

export const SCHEMA_VERSION = "v1" as const;
const BASE = "https://nomos.example/schemas/gx402";

// ── shared primitives ───────────────────────────────────────────────────────

/** Hedera entity id: shard.realm.num — accounts, topics and tokens all share it. */
export const PATTERN_ENTITY_ID = "^[0-9]+\\.[0-9]+\\.[0-9]+$";
/** Hedera transaction id: payer@validStartSeconds.nanos */
export const PATTERN_TX_ID = "^[0-9]+\\.[0-9]+\\.[0-9]+@[0-9]+\\.[0-9]+$";
/** Consensus timestamp: seconds.nanos */
export const PATTERN_CONSENSUS_TS = "^[0-9]+\\.[0-9]+$";
/** Our only digest format. */
export const PATTERN_DIGEST = "^sha256:[0-9a-f]{64}$";
/** Atomic amount: unsigned decimal integer as a string. Leading zeros rejected. */
export const PATTERN_ATOMIC = "^(0|[1-9][0-9]*)$";
export const PATTERN_ISO8601 = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$";

/** The only network this project will ever emit. Enforced by const, not by hope. */
export const NETWORK = "hedera:testnet" as const;

/** Assets the demo policy may ever allow. HTS tokens are named by entity id. */
export const ASSET_HBAR = "HBAR" as const;

/**
 * Account id, OR a 20-byte EVM address alias.
 *
 * The alias form exists for exactly one case: Hedera auto-account creation. A
 * transfer to an alias that has no account yet CREATES that account. That lets a
 * demo pay a receiver that does not exist at quote time — which is the situation
 * when a faucet's daily limit is exhausted.
 *
 * Deliberately allowed ONLY on the offer/quote/challenge side. The receipt's
 * `payee` stays strictly `0.0.x`, because by the time a receipt exists the
 * account has been created and the ledger knows its real id. An alias in a
 * receipt would be a claim about an account rather than a reference to one.
 */
export const PATTERN_ACCOUNT_OR_ALIAS = "^([0-9]+\\.[0-9]+\\.[0-9]+|0x[0-9a-f]{40})$";

const digest = (description: string) => ({ type: "string", pattern: PATTERN_DIGEST, description });
const entityId = (description: string) => ({ type: "string", pattern: PATTERN_ENTITY_ID, description });
const accountOrAlias = (description: string) => ({ type: "string", pattern: PATTERN_ACCOUNT_OR_ALIAS, description });
const atomic = (description: string) => ({ type: "string", pattern: PATTERN_ATOMIC, description });
const isoTime = (description: string) => ({ type: "string", pattern: PATTERN_ISO8601, description });

/** Anchored on both ends deliberately: a partially-anchored alternation would
 *  accept `NOTHBAR0.0.1`, which is exactly the kind of near-miss an asset
 *  allowlist exists to catch. */
export const PATTERN_ASSET = "^(HBAR|[0-9]+\\.[0-9]+\\.[0-9]+)$";

const assetSchema = {
  type: "string",
  pattern: PATTERN_ASSET,
  description: "HBAR, or an HTS token id in shard.realm.num form.",
};

const networkSchema = {
  type: "string",
  const: NETWORK,
  description: "Pinned to Hedera testnet. Mainnet documents are unrepresentable by construction.",
};

/**
 * Declared here rather than beside the other literals at the bottom of the file
 * because schemas below embed them as `const` values, and a schema object is
 * built at module-evaluation time — a later `const` would still be in its
 * temporal dead zone.
 */
const CANONICALIZATION_ID_VALUE = "RFC8785-JCS/nomos-int-only-v1";
const ENVIRONMENT_VALUE = "TESTNET_DEMO_ONLY";

const agentIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["did", "public_key_hex", "key_type"],
  description: "Who is acting. No human names, no emails, no free text.",
  properties: {
    did: { type: "string", minLength: 8, maxLength: 256, description: "Stable agent identifier, e.g. did:key:z…" },
    public_key_hex: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Raw Ed25519 public key of the agent." },
    key_type: { type: "string", const: "Ed25519" },
    label: { type: "string", maxLength: 64, description: "Optional non-identifying display label." },
  },
};

const authorityScopeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scopes", "granted_by", "valid_until"],
  description: "What the agent was authorised to do, and by whom, and until when.",
  properties: {
    scopes: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { type: "string", pattern: "^[a-z0-9_]+:[a-z0-9_*]+$" },
      description: "Capability strings such as evidence:read.",
    },
    granted_by: { type: "string", minLength: 8, maxLength: 256, description: "DID of the granting authority." },
    valid_until: isoTime("Delegation expiry. Past expiry the policy denies fail-closed."),
    delegation_hash: { ...digest("Optional digest of the full delegation document."), nullable: true },
  },
};

const serviceIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["service_id", "resource_url", "http_method"],
  properties: {
    service_id: { type: "string", minLength: 3, maxLength: 128 },
    resource_url: { type: "string", minLength: 8, maxLength: 512 },
    http_method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
  },
};

const signatureBlockSchema = {
  type: "object",
  additionalProperties: false,
  required: ["alg", "kid", "signature_domain", "canonicalization", "public_key_hex", "signature"],
  properties: {
    alg: { type: "string", const: "Ed25519" },
    kid: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Key id. A verifier MUST resolve this against a published key set rather than trusting public_key_hex.",
    },
    signature_domain: { type: "string", minLength: 8, maxLength: 128 },
    canonicalization: { type: "string", const: "RFC8785-JCS/nomos-int-only-v1" },
    public_key_hex: { type: "string", pattern: "^[0-9a-f]{64}$" },
    signature: { type: "string", pattern: "^[A-Za-z0-9+/]+={0,2}$", description: "base64 Ed25519 signature." },
  },
};

// ── 1. service offer ────────────────────────────────────────────────────────

export const SERVICE_OFFER_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/service_offer.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Service Offer v1",
  description: "What a resource server publishes for discovery. Contains no secrets and no pricing history.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "offer_id", "service", "network", "asset", "atomic_amount", "pay_to", "quote_ttl_seconds"],
  properties: {
    schema: { type: "string", const: `nomos.gx402.service_offer.${SCHEMA_VERSION}` },
    offer_id: { type: "string", minLength: 3, maxLength: 128 },
    service: serviceIdentitySchema,
    description: { type: "string", maxLength: 512 },
    network: networkSchema,
    asset: assetSchema,
    atomic_amount: atomic("Price in atomic units (tinybar for HBAR). Decimal string, never a float."),
    pay_to: accountOrAlias(
      "Receiver: a Hedera account id (0.0.x), or a 0x EVM address alias when the receiver " +
      "is to be created by Hedera auto-account creation on first payment.",
    ),
    quote_ttl_seconds: { type: "integer", minimum: 1, maximum: 600 },
  },
} as const satisfies Record<string, unknown>;

// ── 2. policy preflight request ─────────────────────────────────────────────

export const POLICY_PREFLIGHT_REQUEST_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/policy_preflight_request.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Policy Preflight Request v1",
  description: "Everything the policy engine needs. Deliberately excludes the request BODY — only its hash travels.",
  type: "object",
  additionalProperties: false,
  required: [
    "schema", "request_id", "nonce", "agent_identity", "authority_scope",
    "offer", "request_hash", "requested_at",
  ],
  properties: {
    schema: { type: "string", const: `nomos.gx402.policy_preflight_request.${SCHEMA_VERSION}` },
    request_id: { type: "string", minLength: 8, maxLength: 128 },
    nonce: { type: "string", minLength: 8, maxLength: 128, description: "Anti-replay nonce, unique per request." },
    agent_identity: agentIdentitySchema,
    authority_scope: authorityScopeSchema,
    offer: SERVICE_OFFER_SCHEMA,
    request_hash: digest("Canonical digest of the request body the agent intends to send."),
    requested_at: isoTime("Client clock. The engine uses its own clock for expiry decisions."),
  },
} as const satisfies Record<string, unknown>;

// ── 3. prepayment decision receipt ──────────────────────────────────────────

/**
 * The v2 lesson from the production stack, carried forward: ALLOW, DENY and
 * REVIEW carry the SAME complete binding. A DENY whose binding is weaker than
 * an ALLOW is a DENY nobody can audit.
 */
export const PREPAYMENT_DECISION_RECEIPT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/prepayment_decision_receipt.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Prepayment Decision Receipt v1",
  description:
    "Signed record of a pre-payment policy decision. NEVER authorises, signs or executes a payment. " +
    "Identical binding for ALLOW, DENY and REVIEW.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "decision_id", "record", "record_digest", "signature"],
  properties: {
    schema: { type: "string", const: `nomos.gx402.prepayment_decision_receipt.${SCHEMA_VERSION}` },
    decision_id: { type: "string", pattern: "^ppd_[0-9a-f]{24}$" },
    record_digest: digest("Digest over `record`."),
    signature: signatureBlockSchema,
    record: {
      type: "object",
      additionalProperties: false,
      required: [
        "request_id", "nonce", "decision", "decision_code", "checks",
        "agent_identity", "authority_scope", "bound_terms", "bound_terms_digest",
        "policy_version", "policy_hash", "issued_at", "valid_until",
        "authorizes_payment", "environment",
      ],
      properties: {
        request_id: { type: "string", minLength: 8, maxLength: 128 },
        nonce: { type: "string", minLength: 8, maxLength: 128 },
        decision: { type: "string", enum: ["ALLOW", "DENY", "REVIEW"] },
        decision_code: { type: "string", minLength: 2, maxLength: 64 },
        checks: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["code", "class", "passed"],
            properties: {
              code: { type: "string", minLength: 2, maxLength: 64 },
              class: { type: "string", enum: ["hard", "review", "technical"] },
              passed: { type: "boolean" },
              detail: { type: "string", maxLength: 256 },
            },
          },
        },
        agent_identity: agentIdentitySchema,
        authority_scope: authorityScopeSchema,
        bound_terms: {
          type: "object",
          additionalProperties: false,
          description:
            "The complete bound field set — present and identically shaped for ALLOW, DENY and REVIEW. " +
            "A verifier can recompute bound_terms_digest from this object alone.",
          required: [
            "offer_id", "resource_url", "http_method", "request_hash", "quote_hash",
            "network", "asset", "atomic_amount", "pay_to", "request_id", "nonce",
            "decision", "decision_code", "policy_version",
          ],
          properties: {
            offer_id: { type: "string", minLength: 1, maxLength: 128 },
            resource_url: { type: "string", minLength: 1, maxLength: 512 },
            http_method: { type: "string", minLength: 3, maxLength: 8 },
            request_hash: digest("Digest of the request body."),
            quote_hash: digest("Digest of the quote/offer the decision was made against."),
            network: { type: "string", minLength: 1, maxLength: 64 },
            asset: { type: "string", minLength: 1, maxLength: 64 },
            atomic_amount: { type: "string", minLength: 1, maxLength: 40 },
            pay_to: { type: "string", minLength: 1, maxLength: 64 },
            request_id: { type: "string", minLength: 1, maxLength: 128 },
            nonce: { type: "string", minLength: 1, maxLength: 128 },
            decision: { type: "string", enum: ["ALLOW", "DENY", "REVIEW"] },
            decision_code: { type: "string", minLength: 1, maxLength: 64 },
            policy_version: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
        bound_terms_digest: digest("Digest over bound_terms. Independently reproducible."),
        policy_version: { type: "string", minLength: 1, maxLength: 64 },
        policy_hash: digest("Digest of the effective policy document."),
        issued_at: isoTime("Issue time."),
        valid_until: isoTime("issued_at + at most quote_ttl_seconds."),
        authorizes_payment: { type: "boolean", const: false },
        environment: { type: "string", const: "TESTNET_DEMO_ONLY" },
      },
    },
  },
} as const satisfies Record<string, unknown>;

// ── 4. x402 payment challenge ───────────────────────────────────────────────

export const PAYMENT_CHALLENGE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/payment_challenge.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Payment Challenge v1",
  description:
    "The body served alongside HTTP 402. `accepts` mirrors the x402 shape; " +
    "`nomos` carries the governance binding that plain x402 has no place for.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "x402_version", "accepts", "nomos"],
  properties: {
    schema: { type: "string", const: `nomos.gx402.payment_challenge.${SCHEMA_VERSION}` },
    x402_version: { type: "integer", minimum: 1, maximum: 99 },
    accepts: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["scheme", "network", "asset", "atomic_amount", "pay_to", "max_timeout_seconds", "resource"],
        properties: {
          scheme: { type: "string", const: "exact" },
          network: networkSchema,
          asset: assetSchema,
          atomic_amount: atomic("Exact amount the payer must transfer."),
          pay_to: accountOrAlias("Receiver account id, or an EVM address alias to be auto-created."),
          max_timeout_seconds: { type: "integer", minimum: 1, maximum: 600 },
          resource: { type: "string", minLength: 8, maxLength: 512 },
          memo: {
            type: "string",
            maxLength: 100,
            description:
              "MUST be set to quote_id. This is the on-chain link between the transfer and the quote — " +
              "the field a verifier reads back from the mirror node.",
          },
        },
      },
    },
    nomos: {
      type: "object",
      additionalProperties: false,
      required: ["quote_id", "quote_hash", "request_hash", "idempotency_key", "issued_at", "expires_at", "decision_id"],
      properties: {
        quote_id: { type: "string", pattern: "^q_[0-9a-f]{24}$" },
        quote_hash: digest("Digest of the quote object."),
        request_hash: digest("Digest of the request body this quote is valid for."),
        idempotency_key: { type: "string", pattern: "^idem_[0-9a-f]{32}$" },
        issued_at: isoTime("Quote issue time."),
        expires_at: isoTime("Hard expiry. Past this the server refuses fail-closed."),
        decision_id: { type: "string", pattern: "^ppd_[0-9a-f]{24}$" },
      },
    },
  },
} as const satisfies Record<string, unknown>;

// ── 5. settlement evidence ──────────────────────────────────────────────────

export const SETTLEMENT_EVIDENCE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/settlement_evidence.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Settlement Evidence v1",
  description:
    "What the verifier established about the payment. `source` distinguishes a real mirror-node " +
    "observation from a MOCK — this field is what keeps an offline demo honest.",
  type: "object",
  additionalProperties: false,
  required: [
    "schema", "source", "verified", "network", "asset", "atomic_amount",
    "payer", "payee", "transaction_id", "finality", "checked_at",
  ],
  properties: {
    schema: { type: "string", const: `nomos.gx402.settlement_evidence.${SCHEMA_VERSION}` },
    source: {
      type: "string",
      enum: ["MOCK_OFFLINE", "MIRROR_NODE"],
      description: "MOCK_OFFLINE means NOTHING was observed on-chain. Never present it as a real payment.",
    },
    verified: { type: "boolean" },
    network: networkSchema,
    asset: assetSchema,
    atomic_amount: atomic("Amount actually observed, not the amount expected."),
    payer: entityId("Sending account observed on-chain."),
    payee: entityId(
      "Receiving account observed on-chain. Always a real 0.0.x — an alias has been " +
      "resolved to its created account by the time settlement is observed.",
    ),
    transaction_id: { type: "string", pattern: PATTERN_TX_ID },
    consensus_timestamp: { type: "string", pattern: PATTERN_CONSENSUS_TS, nullable: true },
    memo: { type: "string", maxLength: 100, nullable: true, description: "Observed transaction memo — expected to equal quote_id." },
    finality: { type: "string", enum: ["FINAL", "PENDING", "FAILED"] },
    checked_at: isoTime("When the verifier looked."),
    failure_code: { type: "string", maxLength: 64, nullable: true },
  },
} as const satisfies Record<string, unknown>;

// ── 6. delivery evidence ────────────────────────────────────────────────────

export const DELIVERY_EVIDENCE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/delivery_evidence.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Delivery Evidence v1",
  description: "What was executed and handed over. Carries hashes only — never the result content.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "idempotency_key", "execution_status", "delivery_status", "result_hash", "executed_at"],
  properties: {
    schema: { type: "string", const: `nomos.gx402.delivery_evidence.${SCHEMA_VERSION}` },
    idempotency_key: { type: "string", pattern: "^idem_[0-9a-f]{32}$" },
    execution_status: { type: "string", enum: ["SUCCEEDED", "FAILED"] },
    delivery_status: { type: "string", enum: ["DELIVERED", "NOT_DELIVERED"] },
    result_hash: {
      ...digest("Canonical digest of the delivered result. `sha256:` of the empty-object canon when nothing was delivered."),
    },
    result_media_type: { type: "string", maxLength: 128, nullable: true },
    result_byte_length: { type: "integer", minimum: 0, nullable: true },
    executed_at: isoTime("Execution completion time."),
    failure_code: { type: "string", maxLength: 64, nullable: true },
    refund_due: {
      type: "boolean",
      description: "True when payment landed but execution failed. The demo does NOT auto-refund; it records the obligation.",
    },
  },
} as const satisfies Record<string, unknown>;

// ── 7. HCS anchor reference ─────────────────────────────────────────────────

export const HCS_ANCHOR_REFERENCE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/hcs_anchor_reference.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 HCS Anchor Reference v1",
  description:
    "Proof that a receipt digest was submitted to a Hedera Consensus Service topic. " +
    "Anchoring is ADDITIVE: a receipt without an anchor is still fully valid.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "source", "status", "network", "anchored_digest"],
  properties: {
    schema: { type: "string", const: `nomos.gx402.hcs_anchor_reference.${SCHEMA_VERSION}` },
    source: { type: "string", enum: ["MOCK_OFFLINE", "HEDERA_HCS"] },
    status: { type: "string", enum: ["ANCHORED", "PENDING", "FAILED"] },
    network: networkSchema,
    anchored_digest: digest("MUST equal the receipt's record_digest."),
    topic_id: { ...entityId("Topic the message was submitted to."), nullable: true },
    sequence_number: { type: "integer", minimum: 1, nullable: true },
    transaction_id: { type: "string", pattern: PATTERN_TX_ID, nullable: true },
    consensus_timestamp: { type: "string", pattern: PATTERN_CONSENSUS_TS, nullable: true },
    anchored_at: { ...isoTime("Local submit time."), nullable: true },
    hashscan_url: { type: "string", maxLength: 512, nullable: true },
    mirror_url: { type: "string", maxLength: 512, nullable: true },
    failure_code: { type: "string", maxLength: 64, nullable: true },
  },
} as const satisfies Record<string, unknown>;

// ── 7b. HCS anchor envelope — the bytes that actually go on-chain ───────────

/**
 * The CP-H7 on-chain message.
 *
 * `hcs_anchor_reference` above describes what we *learned* from anchoring
 * (topic, sequence, consensus timestamp). This schema describes what we *say* —
 * the message body itself. They are deliberately separate documents: one is
 * authored by us and published, the other is observed from the ledger and can
 * only be filled in after consensus.
 *
 * Every field is either a digest, an identifier, or a fixed literal. There is
 * no field capable of holding request content, result content, a key, a path or
 * a personal identifier, so no code path — not even a wrong one — can publish
 * them. HCS messages are public and permanent; that property has to come from
 * the type, not from care at the call site.
 *
 * The envelope carries `source_transaction_id` and `source_consensus_timestamp`
 * so a reader who has only the topic can walk back to the payment that the
 * anchored receipt describes, without holding the receipt.
 */
export const HCS_ANCHOR_ENVELOPE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/hcs_anchor_envelope.v2.json`,
  title: "NOMOS GX402 HCS Anchor Envelope v2",
  description:
    "The exact message body submitted to a Hedera Consensus Service topic. Digests and " +
    "identifiers only — never receipt content, keys, paths or personal data.",
  type: "object",
  additionalProperties: false,
  required: [
    "anchor_version",
    "canonicalization",
    "created_at",
    "digest_algorithm",
    "env",
    "network",
    "purpose",
    "receipt_id",
    "receipt_schema_version",
    "record_digest",
    "schema",
    "source_consensus_timestamp",
    "source_transaction_id",
  ],
  properties: {
    schema: { type: "string", const: "nomos.gx402.anchor.v2" },
    anchor_version: { type: "string", const: "v2" },
    network: networkSchema,
    receipt_id: { type: "string", pattern: "^poa_[0-9a-f]{24}$" },
    record_digest: digest("The anchored value. MUST equal the receipt's record_digest."),
    digest_algorithm: {
      type: "string",
      const: "sha256",
      description: "Hash function behind record_digest. The value itself is `sha256:<64 lowercase hex>`.",
    },
    canonicalization: {
      type: "string",
      const: CANONICALIZATION_ID_VALUE,
      description: "Profile under which record_digest is reproducible. Without it the digest is unverifiable.",
    },
    receipt_schema_version: {
      type: "string",
      const: `nomos.gx402.proof_of_action_receipt.${SCHEMA_VERSION}`,
      description: "Which receipt schema the anchored digest was computed under.",
    },
    source_transaction_id: {
      type: "string",
      pattern: PATTERN_TX_ID,
      description: "The Hedera payment the receipt attests. Lets a topic reader reach the payment.",
    },
    source_consensus_timestamp: {
      type: "string",
      pattern: PATTERN_CONSENSUS_TS,
      description: "Consensus timestamp of that payment.",
    },
    created_at: isoTime("When the envelope was built. NOT the consensus time — that is assigned by the network."),
    purpose: {
      type: "string",
      const: "proof-of-action receipt digest anchor",
      description: "Fixed literal. A free-text purpose would be a content channel.",
    },
    env: {
      type: "string",
      const: ENVIRONMENT_VALUE,
      description: "Machine-readable honesty flag: anyone reading the topic sees this is a testnet demo.",
    },
  },
} as const satisfies Record<string, unknown>;

// ── 7c. HCS anchor evidence — what we may claim after consensus ─────────────

/**
 * The local evidence record written after a submit.
 *
 * `status` starts at SUBMITTED and only becomes CONFIRMED once the message has
 * been read back from a mirror node and its bytes matched the envelope. Nothing
 * may present an anchor as proven while this says SUBMITTED — the ledger, not
 * our own optimism, decides when a digest is anchored.
 */
export const HCS_ANCHOR_EVIDENCE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/hcs_anchor_evidence.v1.json`,
  title: "NOMOS GX402 HCS Anchor Evidence v1",
  description:
    "Local record of one anchor submission and its independent mirror-node confirmation. " +
    "CONFIRMED requires the on-chain bytes to equal the envelope bytes exactly.",
  type: "object",
  additionalProperties: false,
  required: [
    "schema",
    "status",
    "network",
    "anchor_key",
    "envelope",
    "envelope_digest",
    "envelope_bytes",
  ],
  properties: {
    schema: { type: "string", const: `nomos.gx402.hcs_anchor_evidence.${SCHEMA_VERSION}` },
    status: {
      type: "string",
      enum: ["SUBMITTED", "CONFIRMED", "FAILED"],
      description: "CONFIRMED only after a mirror-node read-back matched the envelope byte for byte.",
    },
    network: networkSchema,
    anchor_key: {
      type: "string",
      pattern: "^anc_[0-9a-f]{24}$",
      description: "Idempotency key over (network, receipt_id, record_digest). Same receipt ⇒ same key, forever.",
    },
    envelope: HCS_ANCHOR_ENVELOPE_SCHEMA,
    envelope_digest: digest("Digest of the canonical envelope bytes. Binds this record to what was sent."),
    envelope_bytes: {
      type: "integer",
      minimum: 1,
      maximum: 1024,
      description: "Byte length of the submitted message. Bounded to one HCS chunk.",
    },
    topic_id: { ...entityId("Topic the message was submitted to."), nullable: true },
    sequence_number: { type: "integer", minimum: 1, nullable: true },
    transaction_id: { type: "string", pattern: PATTERN_TX_ID, nullable: true },
    consensus_timestamp: { type: "string", pattern: PATTERN_CONSENSUS_TS, nullable: true },
    running_hash: {
      type: "string",
      // base64, which is how a mirror node actually returns it. This pattern
      // said hex until CP-H7F, where a real submit produced a value the schema
      // rejected — an assumption that had never met the ledger.
      pattern: "^[A-Za-z0-9+/]+={0,2}$",
      maxLength: 192,
      nullable: true,
    },
    submitted_at: { ...isoTime("Local submit time."), nullable: true },
    confirmed_at: { ...isoTime("When the mirror-node read-back succeeded."), nullable: true },
    hashscan_url: { type: "string", maxLength: 512, nullable: true },
    mirror_url: { type: "string", maxLength: 512, nullable: true },
    failure_code: { type: "string", maxLength: 64, nullable: true },

    // ── observed after consensus ──────────────────────────────────────────
    // Declared rather than waved through: `additionalProperties: false` is the
    // reason this schema is worth having, and a verifier that had to tolerate
    // undeclared fields could not tell an enriched record from a forged one.
    running_hash_version: { type: "integer", minimum: 1, nullable: true },
    chunk: {
      type: "object",
      additionalProperties: false,
      required: ["number", "total"],
      description: "Chunk position. Anything other than 1 of 1 means the message was split.",
      properties: {
        number: { type: "integer", minimum: 1 },
        total: { type: "integer", minimum: 1 },
      },
      nullable: true,
    },
    charged_tx_fee_tinybar: { type: "string", pattern: PATTERN_ATOMIC, nullable: true },
    max_transaction_fee_tinybar: { type: "string", pattern: PATTERN_ATOMIC, nullable: true },
    source_topic_create: {
      type: "object",
      additionalProperties: false,
      required: ["transaction_id", "consensus_timestamp"],
      description: "The topic-creation transaction this anchor's topic came from.",
      properties: {
        transaction_id: { type: "string", pattern: PATTERN_TX_ID },
        consensus_timestamp: { type: "string", pattern: PATTERN_CONSENSUS_TS },
      },
      nullable: true,
    },
    independent_verification: {
      type: "object",
      additionalProperties: true,
      description:
        "A read-back performed outside the submitting tool. A tool confirming its own work is not a second opinion.",
      required: ["byte_exact_match", "result"],
      properties: {
        byte_exact_match: { type: "boolean" },
        result: { type: "string", maxLength: 32 },
      },
      nullable: true,
    },
    duplicate_protection: { type: "object", additionalProperties: true, nullable: true },
    receipt_unmodified: {
      type: "object",
      additionalProperties: true,
      description:
        "Proof that the signed CP-H2 receipt was left alone. Writing an anchor into it would change its canonical bytes.",
      required: ["sha256", "anchor_field"],
      properties: {
        sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        anchor_field: { type: "null" },
      },
      nullable: true,
    },
    permanence_note: { type: "string", maxLength: 1024, nullable: true },
  },
} as const satisfies Record<string, unknown>;

// ── 8. proof-of-action receipt ──────────────────────────────────────────────

export const PROOF_OF_ACTION_RECEIPT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${BASE}/proof_of_action_receipt.${SCHEMA_VERSION}.json`,
  title: "NOMOS GX402 Proof-of-Action Receipt v1",
  description:
    "The deliverable. Binds identity, authority, policy decision, request, quote, payment and " +
    "delivery into one signed, independently verifiable record. Contains hashes only — never " +
    "request or result content, never personal data.",
  type: "object",
  additionalProperties: false,
  required: ["schema", "receipt_version", "receipt_id", "record", "record_digest", "signature"],
  properties: {
    schema: { type: "string", const: `nomos.gx402.proof_of_action_receipt.${SCHEMA_VERSION}` },
    receipt_version: { type: "string", const: SCHEMA_VERSION },
    receipt_id: { type: "string", pattern: "^poa_[0-9a-f]{24}$" },
    record_digest: digest("Digest over `record`. This is the value that gets anchored to HCS."),
    signature: signatureBlockSchema,
    anchor: { ...HCS_ANCHOR_REFERENCE_SCHEMA, nullable: true },
    verification: {
      type: "object",
      additionalProperties: false,
      required: ["hashscan_transaction_url"],
      description: "Human-checkable links. Derived, never authoritative — the hashes are.",
      properties: {
        hashscan_transaction_url: { type: "string", maxLength: 512 },
        hashscan_topic_url: { type: "string", maxLength: 512, nullable: true },
        mirror_transaction_url: { type: "string", maxLength: 512, nullable: true },
        mirror_topic_message_url: { type: "string", maxLength: 512, nullable: true },
      },
    },
    record: {
      type: "object",
      additionalProperties: false,
      required: [
        "agent_identity", "authority_scope", "service_identity", "offer_id",
        "policy_decision", "policy_version", "policy_hash", "decision_id",
        "request_hash", "quote_id", "quote_hash", "idempotency_key", "nonce",
        "network", "asset", "atomic_amount", "payer", "payee",
        "hedera_transaction_id", "settlement_source", "settlement_finality",
        "execution_status", "delivery_status", "result_hash",
        "receipt_timestamp", "environment", "disclaimer",
      ],
      properties: {
        agent_identity: agentIdentitySchema,
        authority_scope: authorityScopeSchema,
        service_identity: serviceIdentitySchema,
        offer_id: { type: "string", minLength: 1, maxLength: 128 },

        policy_decision: { type: "string", enum: ["ALLOW", "DENY", "REVIEW"] },
        policy_version: { type: "string", minLength: 1, maxLength: 64 },
        policy_hash: digest("Digest of the effective policy document."),
        decision_id: { type: "string", pattern: "^ppd_[0-9a-f]{24}$" },

        request_hash: digest("Canonical digest of the request body."),
        quote_id: { type: "string", pattern: "^q_[0-9a-f]{24}$" },
        quote_hash: digest("Canonical digest of the quote."),
        idempotency_key: { type: "string", pattern: "^idem_[0-9a-f]{32}$" },
        nonce: { type: "string", minLength: 8, maxLength: 128 },

        network: networkSchema,
        asset: assetSchema,
        atomic_amount: atomic("Amount settled, in atomic units, as a decimal string."),
        payer: entityId("Paying account, as debited on the ledger."),
        payee: entityId(
          "Receiving account, as credited on the ledger. Never an alias: a receipt names " +
          "the account that exists, not the address it was created from.",
        ),

        hedera_transaction_id: { type: "string", pattern: PATTERN_TX_ID },
        consensus_timestamp: { type: "string", pattern: PATTERN_CONSENSUS_TS, nullable: true },
        settlement_source: { type: "string", enum: ["MOCK_OFFLINE", "MIRROR_NODE"] },
        settlement_finality: { type: "string", enum: ["FINAL", "PENDING", "FAILED"] },

        execution_status: { type: "string", enum: ["SUCCEEDED", "FAILED"] },
        delivery_status: { type: "string", enum: ["DELIVERED", "NOT_DELIVERED"] },
        result_hash: digest("Canonical digest of the delivered result."),
        refund_due: { type: "boolean" },

        receipt_timestamp: isoTime("When this receipt was assembled."),
        environment: { type: "string", const: "TESTNET_DEMO_ONLY" },
        disclaimer: { type: "string", minLength: 8, maxLength: 512 },
      },
    },
  },
} as const satisfies Record<string, unknown>;

// ── reusable sub-shapes (exported for validators that need them standalone) ──

export const AGENT_IDENTITY_SHAPE = agentIdentitySchema;
export const AUTHORITY_SCOPE_SHAPE = authorityScopeSchema;
export const SERVICE_IDENTITY_SHAPE = serviceIdentitySchema;
export const SIGNATURE_BLOCK_SHAPE = signatureBlockSchema;

// ── registry ────────────────────────────────────────────────────────────────

export const ALL_SCHEMAS = {
  service_offer: SERVICE_OFFER_SCHEMA,
  policy_preflight_request: POLICY_PREFLIGHT_REQUEST_SCHEMA,
  prepayment_decision_receipt: PREPAYMENT_DECISION_RECEIPT_SCHEMA,
  payment_challenge: PAYMENT_CHALLENGE_SCHEMA,
  settlement_evidence: SETTLEMENT_EVIDENCE_SCHEMA,
  delivery_evidence: DELIVERY_EVIDENCE_SCHEMA,
  hcs_anchor_reference: HCS_ANCHOR_REFERENCE_SCHEMA,
  hcs_anchor_envelope: HCS_ANCHOR_ENVELOPE_SCHEMA,
  hcs_anchor_evidence: HCS_ANCHOR_EVIDENCE_SCHEMA,
  proof_of_action_receipt: PROOF_OF_ACTION_RECEIPT_SCHEMA,
} as const;

export type SchemaName = keyof typeof ALL_SCHEMAS;

/** Signature domains. One per signed artifact — never reused across schemas. */
export const DOMAIN_PREPAYMENT_DECISION = "NOMOS_GX402_PREPAYMENT_DECISION_V1";
export const DOMAIN_PROOF_OF_ACTION = "NOMOS_GX402_PROOF_OF_ACTION_V1";

export const CANONICALIZATION_ID = CANONICALIZATION_ID_VALUE;
export const ENVIRONMENT = ENVIRONMENT_VALUE;

/** CP-H7 anchor envelope literals. Exported so the builder cannot drift from the schema. */
export const ANCHOR_ENVELOPE_SCHEMA_ID = "nomos.gx402.anchor.v2";
export const ANCHOR_VERSION = "v2";
export const ANCHOR_PURPOSE = "proof-of-action receipt digest anchor";
export const ANCHOR_DIGEST_ALGORITHM = "sha256";
/** `sha256:` + 64 lowercase hex. Stated explicitly because the envelope only names the algorithm. */
export const ANCHOR_DIGEST_ENCODING = "prefixed-lowercase-hex";
export const DISCLAIMER =
  "Demo artifact on Hedera testnet. Not a certification, not legal advice, not a guarantee of service quality.";
