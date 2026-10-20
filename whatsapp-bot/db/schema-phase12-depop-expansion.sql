-- Phase 12 — Depop expansion foundations
-- Additive only: shop social links + flat garment measurements.

ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok_url TEXT;

ALTER TABLE products ADD COLUMN IF NOT EXISTS pit_to_pit_in NUMERIC(6, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_in NUMERIC(6, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS waist_in NUMERIC(6, 2);

CREATE INDEX IF NOT EXISTS idx_products_sold_owner
  ON products (seller_user_id, is_sold, created_at DESC)
  WHERE is_sold = TRUE;
