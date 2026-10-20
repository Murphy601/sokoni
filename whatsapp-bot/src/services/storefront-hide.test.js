import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  blockedShopLookup,
  isProductFromBlockedShop,
  assertProductShopVisible,
  isProductFromMissingShop,
  isPlatformOwnedListing,
} from "./enforce-account.js";

describe("storefront hide helpers", () => {
  it("exposes blockedShopLookup shape", () => {
    const blocked = blockedShopLookup();
    assert.ok(blocked.ids instanceof Set);
    assert.ok(blocked.handles instanceof Set);
    assert.ok(blocked.phones instanceof Set);
  });

  it("isProductFromBlockedShop matches supplier id / handle / phone", () => {
    const lookup = {
      ids: new Set(["sup_1"]),
      handles: new Set(["nairobi_kicks"]),
      phones: new Set(["712345678"]),
    };
    assert.equal(isProductFromBlockedShop({ supplierId: "sup_1" }, lookup), true);
    assert.equal(isProductFromBlockedShop({ shopHandle: "@nairobi_kicks" }, lookup), true);
    assert.equal(isProductFromBlockedShop({ sellerPhone: "254712345678" }, lookup), true);
    assert.equal(
      isProductFromBlockedShop({ supplierId: "other", shopHandle: "ok-shop-xyz" }, lookup),
      // Peer handle with no live supplier → orphan → blocked
      true
    );
  });

  it("platform listings without supplier stay visible", () => {
    assert.equal(isPlatformOwnedListing({ id: "p1", shopHandle: "sokoni-store" }), true);
    assert.equal(isPlatformOwnedListing({ id: "p2" }), true);
    const gate = assertProductShopVisible({ id: "prod_x", title: "Tee", shopHandle: "sokoni-store" });
    assert.equal(gate.ok, true);
  });

  it("peer listings with missing supplier are orphans", () => {
    const orphan = {
      id: "prod_orphan",
      shopHandle: "deleted_shop_xyz_never",
      sellerPhone: "254700000099",
      supplierId: "sup_gone_forever",
    };
    assert.equal(isProductFromMissingShop(orphan), true);
    const gate = assertProductShopVisible(orphan);
    assert.equal(gate.ok, false);
    assert.equal(gate.shopStatus, "deleted");
    assert.equal(isProductFromBlockedShop(orphan, { ids: new Set(), handles: new Set(), phones: new Set() }), true);
  });
});
