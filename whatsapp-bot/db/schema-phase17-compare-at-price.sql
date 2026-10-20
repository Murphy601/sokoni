-- Phase 17: compare_at_price for strike-through + % OFF badges
-- Semantics: show was-price / discount badge ONLY when price_kes < compare_at_price.
-- On price raise, clear compare_at_price (and original_price_kes) so badges hide.
-- Kept in sync with original_price_kes for backward compatibility.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(12, 2) DEFAULT NULL;

UPDATE products
   SET compare_at_price = original_price_kes
 WHERE compare_at_price IS NULL
   AND original_price_kes IS NOT NULL
   AND original_price_kes > price_kes;

COMMENT ON COLUMN products.compare_at_price IS
  'Buyer-facing compare-at (was) price. Show strike-through + % OFF only when price_kes < compare_at_price.';
