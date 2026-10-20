-- Phase 26: Sokoni platform rider pin / auto-dispatch

ALTER TABLE riders
  ADD COLUMN IF NOT EXISTS last_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;

ALTER TABLE delivery_dispatches
  ADD COLUMN IF NOT EXISTS pinned_rider_id INT REFERENCES riders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pin_offered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_source VARCHAR(40) DEFAULT 'platform',
  ADD COLUMN IF NOT EXISTS backup_pinged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dispatches_pinned
  ON delivery_dispatches (pinned_rider_id, status)
  WHERE pinned_rider_id IS NOT NULL AND status = 'REQUESTED';
