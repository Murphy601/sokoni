import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSellerOrigin } from "./apply-order-shipping.js";
import { resolveMetroCoords } from "../lib/metro-coords.js";
import { priceLocalDelivery, BASE_FEE_KES } from "../lib/rider-distance-fee.js";
import { haversineMeters } from "./boda-fleet.js";

const SRC = readFileSync(new URL("./apply-order-shipping.js", import.meta.url), "utf8");

describe("seller origin", () => {
  it("prefers an explicit pickup address", () => {
    assert.equal(
      resolveSellerOrigin({ pickupAddress: "Shop 4, Ruaka Town", sellerCity: "Nairobi" }),
      "Shop 4, Ruaka Town"
    );
  });

  it("falls through the order's own location fields", () => {
    assert.equal(resolveSellerOrigin({ sellerLocation: "Westlands" }), "Westlands");
    assert.equal(resolveSellerOrigin({ sellerCity: "Karen" }), "Karen");
  });

  it("returns empty rather than guessing when nothing is known", () => {
    for (const o of [{}, { pickupAddress: "   " }, { shopHandle: "@nobody-here" }]) {
      assert.equal(resolveSellerOrigin(o), "");
    }
  });

  it("survives a broken lookup instead of failing the order", () => {
    assert.equal(resolveSellerOrigin({ shopHandle: {}, sellerPhone: {} }), "");
  });
});

describe("the origin actually reaches the pricing", () => {
  it("no longer reads fields that do not exist on a shipping profile", () => {
    // shopLocation and baseCounty are not profile fields. Reading them left
    // the origin empty and every rider delivery at the bare minimum.
    assert.doesNotMatch(SRC, /profile\?\.shopLocation/);
    assert.doesNotMatch(SRC, /profile\?\.baseCounty/);
    assert.match(SRC, /resolveSellerOrigin\(order\)/);
  });

  it("prices by distance once the seller has a city", () => {
    const origin = resolveSellerOrigin({ sellerCity: "Westlands" });
    const quote = priceLocalDelivery(
      resolveMetroCoords(origin),
      resolveMetroCoords("Kitengela"),
      haversineMeters
    );
    assert.equal(quote.basis, "DISTANCE");
    assert.ok(quote.feeKes > BASE_FEE_KES, `still the minimum: ${quote.feeKes}`);
  });

  it("still charges the minimum when the seller has no usable city", () => {
    const quote = priceLocalDelivery(
      resolveMetroCoords(resolveSellerOrigin({})),
      resolveMetroCoords("Kitengela"),
      haversineMeters
    );
    assert.equal(quote.feeKes, BASE_FEE_KES);
    assert.equal(quote.basis, "MINIMUM_NO_COORDS");
  });
});
