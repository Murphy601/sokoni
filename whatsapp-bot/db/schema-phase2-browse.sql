-- Phase 2 — browse taxonomy columns on products

ALTER TABLE products ADD COLUMN IF NOT EXISTS browse_category VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS browse_sub_category VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_products_browse ON products(browse_category, browse_sub_category);
