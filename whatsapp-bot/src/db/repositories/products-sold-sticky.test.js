import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, "products.js"), "utf-8");

describe("catalog upsert sold sticky", () => {
  it("SQL never clears is_sold when master claims live stock", () => {
    assert.match(SRC, /is_sold = products\.is_sold OR EXCLUDED\.is_sold/);
    assert.doesNotMatch(
      SRC,
      /WHEN EXCLUDED\.in_stock = TRUE AND COALESCE\(EXCLUDED\.stock_quantity/
    );
  });

  it("does not call ensureSellerSocialProfile from resolveCatalogSeller", () => {
    // Catalog sync must not provision zombie sellers after DELETE SELLER + rider reuse.
    const resolveStart = SRC.indexOf("async function resolveCatalogSeller");
    const resolveEnd = SRC.indexOf("export async function upsertCatalogProduct");
    assert.ok(resolveStart > 0 && resolveEnd > resolveStart);
    const body = SRC.slice(resolveStart, resolveEnd);
    assert.doesNotMatch(body, /await import\("\.\/users\.js"\)/);
    assert.doesNotMatch(body, /ensureSellerSocialProfile\s*\(/);
    assert.match(body, /no live supplier/);
  });

  it("preserves compare_at_price instead of wiping with null", () => {
    assert.match(SRC, /compare_at_price = COALESCE\(\$2, compare_at_price\)/);
    assert.match(SRC, /original_price_kes = COALESCE\(EXCLUDED\.original_price_kes, products\.original_price_kes\)/);
  });
});
