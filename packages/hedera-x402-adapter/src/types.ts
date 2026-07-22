/** Structural type mirroring the settlement_evidence schema, kept here so the
 *  adapter interface does not have to import the receipt package. */
export interface SettlementEvidenceLike {
  schema: string;
  source: "MOCK_OFFLINE" | "MIRROR_NODE";
  verified: boolean;
  network: string;
  asset: string;
  atomic_amount: string;
  payer: string;
  payee: string;
  transaction_id: string;
  consensus_timestamp?: string | null;
  memo?: string | null;
  finality: "FINAL" | "PENDING" | "FAILED";
  checked_at: string;
  failure_code?: string | null;
}
