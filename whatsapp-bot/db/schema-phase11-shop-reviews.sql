-- Phase 11 — shop reviews for prepaid SK- orders (JSON) + Postgres orders
-- order_reviews originally required orders.id; live prepaid orders are SK-* in JSON.

ALTER TABLE order_reviews
  ALTER COLUMN order_id DROP NOT NULL;

ALTER TABLE order_reviews
  ADD COLUMN IF NOT EXISTS order_ref VARCHAR(64);

-- One review per prepaid SK code (or tracking code)
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reviews_order_ref_unique
  ON order_reviews (order_ref)
  WHERE order_ref IS NOT NULL AND BTRIM(order_ref) <> '';

INSERT INTO schema_migrations (name)
VALUES ('phase11_shop_reviews_order_ref')
ON CONFLICT (name) DO NOTHING;
