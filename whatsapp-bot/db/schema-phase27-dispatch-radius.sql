-- Phase 27: Dispatch radius engine — offer queue, acceptance stats, rating audit

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS offers_sent INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offers_accepted INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acceptance_rate NUMERIC(5, 2) NOT NULL DEFAULT 70.00,
  ADD COLUMN IF NOT EXISTS rating_events JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE delivery_dispatches
  ADD COLUMN IF NOT EXISTS offer_index INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offer_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offer_queue INT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS late_pickup_penalized BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_dispatches_offer_expiry
  ON delivery_dispatches (status, offer_expires_at)
  WHERE status = 'REQUESTED' AND offer_expires_at IS NOT NULL;
