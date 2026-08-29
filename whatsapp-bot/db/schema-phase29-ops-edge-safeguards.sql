-- Phase 29: Operational edge safeguards
-- Buyer no-show return custody, upcountry pre-shipment photos

ALTER TABLE delivery_dispatches
  ADD COLUMN IF NOT EXISTS wait_timer_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_otp_hash VARCHAR(128),
  ADD COLUMN IF NOT EXISTS return_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_fee_kes NUMERIC(12, 2);

CREATE INDEX IF NOT EXISTS idx_dispatches_no_show_wait
  ON delivery_dispatches (wait_timer_started_at)
  WHERE wait_timer_started_at IS NOT NULL
    AND return_confirmed_at IS NULL
    AND custody_status IN ('IN_TRANSIT', 'RETURN_IN_TRANSIT');

ALTER TABLE upcountry_shipments
  ADD COLUMN IF NOT EXISTS pre_shipment_photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS packaged_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS item_condition_photo_url TEXT;
