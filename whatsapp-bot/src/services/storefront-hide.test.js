import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  blockedShopLookup,
  isProductFromBlockedShop,
  assertProductShopVisible,
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
    assert.equal(isProductFromBlockedShop({ supplierId: "other", shopHandle: "ok" }, lookup), false);
  });

  it("assertProductShopVisible allows products with no supplier link", () => {
    const gate = assertProductShopVisible({ id: "prod_x", title: "Tee" });
    assert.equal(gate.ok, true);
  });
});
