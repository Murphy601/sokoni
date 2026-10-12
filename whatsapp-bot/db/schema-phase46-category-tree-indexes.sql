-- Phase 46 — live catalog indexes for category / browse-tree GROUP BY
-- (no separate categories table: taxonomy lives on products + browse-menu.json)

CREATE INDEX IF NOT EXISTS idx_products_sub_category
  ON products(sub_category);

CREATE INDEX IF NOT EXISTS idx_products_browse_sub_category
  ON products(browse_sub_category);

CREATE INDEX IF NOT EXISTS idx_products_live_category
  ON products(category, sub_category)
  WHERE in_stock = TRUE AND is_sold = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_live_browse
  ON products(browse_category, browse_sub_category)
  WHERE in_stock = TRUE AND is_sold = FALSE;
