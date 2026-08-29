-- Phase 22: Rider payout B2C columns + dispute resolution metadata

ALTER TABLE rider_payouts
  ADD COLUMN IF NOT EXISTS b2c_conversation_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS b2c_originator_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mpesa_receipt VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_rider_payouts_status
  ON rider_payouts (status, rider_id);

CREATE INDEX IF NOT EXISTS idx_rider_payouts_b2c_conv
  ON rider_payouts (b2c_conversation_id)
  WHERE b2c_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rider_payouts_b2c_orig
  ON rider_payouts (b2c_originator_id)
  WHERE b2c_originator_id IS NOT NULL;
