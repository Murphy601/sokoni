-- Phase 45 — fair seller drip: rotate live listings by last_promoted_at
ALTER TABLE products ADD COLUMN IF NOT EXISTS last_promoted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_products_last_promoted
  ON products (last_promoted_at ASC NULLS FIRST)
  WHERE in_stock = TRUE AND COALESCE(is_sold, FALSE) = FALSE;
