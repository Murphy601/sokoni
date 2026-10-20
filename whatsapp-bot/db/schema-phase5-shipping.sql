-- Phase 5 — shipping fee on products (seller listings)
ALTER TABLE products ADD COLUMN IF NOT EXISTS shipping_kes NUMERIC(12, 2);
