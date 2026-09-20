-- Phase 35: Seller-pinned shop items (top 3 on /shop/@handle)
--
-- pin_rank is 1..3 when pinned, NULL otherwise. NULL rather than 0 so the
-- partial unique index below only constrains rows that are actually pinned.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pin_rank SMALLINT,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_pin_rank_range CHECK (pin_rank IS NULL OR pin_rank BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- One product per slot per seller. Partial, so unpinned rows never collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_seller_pin_slot
  ON products (seller_user_id, pin_rank)
  WHERE pin_rank IS NOT NULL AND seller_user_id IS NOT NULL;

-- Storefront ordering: pinned block first, then newest.
CREATE INDEX IF NOT EXISTS idx_products_seller_pin_order
  ON products (seller_user_id, pin_rank NULLS LAST, created_at DESC)
  WHERE in_stock = TRUE AND is_sold = FALSE;

INSERT INTO schema_migrations (name)
VALUES ('phase35_shop_pins')
ON CONFLICT (name) DO NOTHING;
