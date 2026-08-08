-- Phase 11 — shop reviews for prepaid SK- orders (JSON) + Postgres orders
-- order_reviews originally required orders.id; live prepaid orders are SK-* in JSON.
-- Note: phase13 replaces order_ref uniqueness with (order_ref, direction).

ALTER TABLE order_reviews
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE order_reviews
  ADD COLUMN IF NOT EXISTS order_ref VARCHAR(64);

-- Unique index is best-effort. Live DBs may already have duplicate order_ref
-- rows (buyer + seller reviews). Skip rather than aborting migrate; phase13
-- installs direction-aware uniqueness instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_order_reviews_order_ref_unique'
  ) THEN
    RAISE NOTICE 'phase11: idx_order_reviews_order_ref_unique already exists';
  ELSIF EXISTS (
    SELECT 1
    FROM order_reviews
    WHERE order_ref IS NOT NULL AND BTRIM(order_ref) <> ''
    GROUP BY order_ref
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'phase11: skipping idx_order_reviews_order_ref_unique (duplicate order_ref); phase13 will apply direction-aware uniqueness';
  ELSE
    CREATE UNIQUE INDEX idx_order_reviews_order_ref_unique
      ON order_reviews (order_ref)
      WHERE order_ref IS NOT NULL AND BTRIM(order_ref) <> '';
  END IF;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('phase11_shop_reviews_order_ref')
ON CONFLICT (name) DO NOTHING;
