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

describe("static catalogs scrubbed of zombie peers", () => {
  it("website products.json has no peer shops", () => {
    const website = path.join(__dirname, "..", "..", "..", "website", "data", "products.json");
    const raw = JSON.parse(readFileSync(website, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.products || [];
    for (const p of list) {
      const h = String(p.shopHandle || p.sellerHandle || "")
        .replace(/^@/, "")
        .toLowerCase();
      assert.notEqual(h, "adiv_thrift");
      assert.notEqual(h, "beauty_shop");
      if (h && h !== "sokoni-store") {
        assert.fail(`unexpected peer in website catalog: ${h}`);
      }
    }
  });

  it("bot master products.json has no adiv_thrift / beauty_shop", () => {
    const master = path.join(__dirname, "..", "data", "products.json");
    const raw = JSON.parse(readFileSync(master, "utf8"));
    const list = Array.isArray(raw) ? raw : raw.products || [];
    for (const p of list) {
      const h = String(p.shopHandle || p.sellerHandle || "")
        .replace(/^@/, "")
        .toLowerCase();
      assert.notEqual(h, "adiv_thrift");
      assert.notEqual(h, "beauty_shop");
    }
  });
});
