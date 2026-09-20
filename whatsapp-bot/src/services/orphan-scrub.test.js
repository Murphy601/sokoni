import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPlatformOwnedListing,
  isProductFromMissingShop,
  isProductFromBlockedShop,
} from "./enforce-account.js";
import { isOverrideCommand, normalizeMasterCommand } from "./admin-override.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("orphan peer detection", () => {
  it("treats seller-/sup- supplierIds as peer even without handle", () => {
    assert.equal(
      isPlatformOwnedListing({ id: "x", supplierId: "seller-adiv-thrift-lom7" }),
      false
    );
    assert.equal(isPlatformOwnedListing({ id: "x", supplierId: "sup-abc" }), false);
    assert.equal(isPlatformOwnedListing({ id: "x", shopHandle: "sokoni-store" }), true);
    assert.equal(isPlatformOwnedListing({ id: "x" }), true);
  });

  it("marks missing peer shops as blocked", () => {
    const orphan = {
      id: "hb-1",
      shopHandle: "adiv_thrift",
      supplierId: "seller-adiv-thrift-lom7",
      sellerPhone: "254700000001",
    };
    assert.equal(isProductFromMissingShop(orphan), true);
    assert.equal(
      isProductFromBlockedShop(orphan, { ids: new Set(), handles: new Set(), phones: new Set() }),
      true
    );
  });
});

describe("SCRUB ORPHANS command", () => {
  it("normalizes Boss SCRUB ORPHANS", () => {
    assert.equal(isOverrideCommand("SCRUB ORPHANS"), true);
    assert.equal(normalizeMasterCommand("SCRUB ORPHANS"), "SCRUB_ORPHANS");
  });
});

describe("static catalogs carry no zombie rows", () => {
  // The original guard denylisted shop handles (adiv_thrift / beauty_shop) and
  // allowed only sokoni-store. That can only pass while the catalog is empty --
  // peer sellers listing is the whole product. It went red the moment a real
  // beauty_shop listing was published 8 minutes after the scrub.
  //
  // The invariant worth guarding is what actually broke: sold-out and
  // out-of-stock rows resurfacing on the storefront after a purge.
  const CATALOGS = {
    "website/data/products.json": path.join(
      __dirname, "..", "..", "..", "website", "data", "products.json"
    ),
    "whatsapp-bot/src/data/products.json": path.join(__dirname, "..", "data", "products.json"),
  };

  function load(file) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw : raw.products || [];
  }

  for (const [label, file] of Object.entries(CATALOGS)) {
    it(`${label} has no sold or out-of-stock rows`, () => {
      for (const p of load(file)) {
        assert.notEqual(p.isSold, true, `${p.id} is sold but still published`);
        assert.notEqual(p.inStock, false, `${p.id} is out of stock but still published`);
        assert.notEqual(
          Number(p.stockQuantity),
          0,
          `${p.id} has 0 units but is still published`
        );
      }
    });

    it(`${label} rows all name a shop`, () => {
      for (const p of load(file)) {
        const handle = String(p.shopHandle || p.sellerHandle || "").replace(/^@/, "").trim();
        assert.ok(handle, `${p.id} has no shopHandle -- cannot be traced to a live shop`);
      }
    });
  }
});
