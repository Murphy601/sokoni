-- Phase 36: Map pins for sellers, riders and buyers.
--
-- Delivery pricing measures seller pin -> buyer pin, and the CONFIRM geofence
-- checks the rider against the buyer's. Before this the seller's location was
-- free text ("Shop 4, Ruaka Town") resolved to a locality centre, and the
-- buyer's was geocoded from a typed address that often failed outright --
-- which is what left drop-off GPS missing at CONFIRM time.
--
-- Nullable throughout: a pin is collected going forward, never backfilled by
-- guessing, and every reader falls back to the old behaviour without one.

ALTER TABLE riders
  -- Where the rider works from. Distinct from last_lat/last_lng (phase 26),
  -- which is their live position and moves all day.
  ADD COLUMN IF NOT EXISTS stage_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS stage_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS stage_pin_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE riders ADD CONSTRAINT riders_stage_pin_in_kenya CHECK (
    (stage_lat IS NULL AND stage_lng IS NULL)
    OR (stage_lat BETWEEN -4.8 AND 5.1 AND stage_lng BETWEEN 33.8 AND 41.95)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Sellers live in the users table (ensureSellerSocialProfile writes there).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_pin_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_label VARCHAR(160);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_pickup_pin_in_kenya CHECK (
    (pickup_lat IS NULL AND pickup_lng IS NULL)
    OR (pickup_lat BETWEEN -4.8 AND 5.1 AND pickup_lng BETWEEN 33.8 AND 41.95)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Ops view: which riders and sellers still have no pin.
CREATE INDEX IF NOT EXISTS idx_riders_missing_stage_pin
  ON riders (operating_town)
  WHERE stage_lat IS NULL;

INSERT INTO schema_migrations (name)
VALUES ('phase36_location_pins')
ON CONFLICT (name) DO NOTHING;
