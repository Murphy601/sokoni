-- Phase 15 — Hybrid logistics engine (additive; does not alter existing checkout)
-- Counties (47) + vendor shipping profiles + optional GeoJSON / PostGIS zones.
-- Safe to re-run.

-- PostGIS is optional. When unavailable, boundary_geojson JSONB is the source of truth.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'postgis: insufficient privilege — continuing with JSONB boundaries';
  WHEN undefined_file THEN
    RAISE NOTICE 'postgis: extension not installed — continuing with JSONB boundaries';
  WHEN OTHERS THEN
    RAISE NOTICE 'postgis: skipped (%) — continuing with JSONB boundaries', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE TYPE vendor_shipping_type AS ENUM (
    'FLAT_RATE',
    'TIERED',
    'CUSTOM_ZONES',
    'LOCAL_ONLY'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS counties (
  id                          SERIAL PRIMARY KEY,
  name                        VARCHAR(80) NOT NULL UNIQUE,
  tier_level                  INT NOT NULL CHECK (tier_level BETWEEN 1 AND 4),
  default_delivery_fee_kes    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  estimated_delivery_hours    INT NOT NULL DEFAULT 48,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_counties_tier ON counties(tier_level);

CREATE TABLE IF NOT EXISTS county_towns (
  id            SERIAL PRIMARY KEY,
  county_id     INT NOT NULL REFERENCES counties(id) ON DELETE CASCADE,
  name          VARCHAR(120) NOT NULL,
  areas         JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (county_id, name)
);

CREATE TABLE IF NOT EXISTS vendor_shipping_profiles (
  id                          TEXT PRIMARY KEY,
  vendor_key                  VARCHAR(120) NOT NULL UNIQUE,
  shipping_type               vendor_shipping_type NOT NULL DEFAULT 'FLAT_RATE',
  flat_local_rate_kes         NUMERIC(12, 2),
  flat_upcountry_rate_kes     NUMERIC(12, 2),
  tier1_rate_kes              NUMERIC(12, 2),
  tier2_rate_kes              NUMERIC(12, 2),
  tier3_rate_kes              NUMERIC(12, 2),
  tier4_rate_kes              NUMERIC(12, 2),
  supported_tiers             JSONB NOT NULL DEFAULT '[1,2,3,4]'::jsonb,
  local_counties              JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_free_shipping_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  local_express_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_delivery_zones (
  id                TEXT PRIMARY KEY,
  vendor_key        VARCHAR(120) NOT NULL,
  zone_name         VARCHAR(160) NOT NULL,
  price_kes         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  boundary_geojson  JSONB NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_zones_vendor ON vendor_delivery_zones(vendor_key)
  WHERE is_active = TRUE;

-- Optional PostGIS geometry mirror (only when extension exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    EXECUTE $sql$
      ALTER TABLE vendor_delivery_zones
        ADD COLUMN IF NOT EXISTS boundary GEOMETRY(Polygon, 4326)
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS idx_vendor_zones_boundary
        ON vendor_delivery_zones USING GIST (boundary)
    $sql$;
  END IF;
END $$;

-- Order delivery coordinates for heatmaps / pin checkout (additive columns)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_lat DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_lng DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_county VARCHAR(80);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_town VARCHAR(120);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_method_calc VARCHAR(40);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_calc_meta JSONB;

-- Rider live location (polled / socket optional)
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rider_lat DOUBLE PRECISION;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rider_lng DOUBLE PRECISION;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rider_heading DOUBLE PRECISION;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS rider_updated_at TIMESTAMPTZ;

INSERT INTO schema_migrations (name) VALUES ('phase15_hybrid_logistics')
ON CONFLICT (name) DO NOTHING;
