-- Phase 24: Ops safeguards — pickup OTP custody, payout caps/retry, M-Pesa name audit

-- Vendor pickup OTP (custody transfer before in-transit)
ALTER TABLE delivery_dispatches
  ADD COLUMN IF NOT EXISTS pickup_otp_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS pickup_otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS custody_status VARCHAR(20) DEFAULT 'ASSIGNED';

-- Rider M-Pesa identity audit (from B2C ReceiverPartyPublicName)
ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS mpesa_account_name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS mpesa_name_match_status VARCHAR(20) DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS mpesa_name_flagged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mpesa_name_last_checked_at TIMESTAMPTZ;

-- Payout retry / manual approval
ALTER TABLE rider_payouts
  ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS requires_manual_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS payout_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_rider_payouts_retry
  ON rider_payouts (status, retry_after)
  WHERE status = 'PENDING_RETRY';

CREATE INDEX IF NOT EXISTS idx_rider_payouts_needs_approval
  ON rider_payouts (status, requires_manual_approval)
  WHERE requires_manual_approval = TRUE OR status = 'NEEDS_APPROVAL';

CREATE INDEX IF NOT EXISTS idx_delivery_custody
  ON delivery_dispatches (custody_status, status);
