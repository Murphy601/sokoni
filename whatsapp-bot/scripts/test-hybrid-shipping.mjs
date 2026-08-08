/**
 * Smoke test: county seed count + zone PIP + fee engine (no network).
 */
import assert from "node:assert/strict";
import { listCounties, getCounty, loadKenyaLocations } from "../src/services/kenya-locations.js";
import {
  upsertVendorShippingProfile,
  saveVendorZone,
  pointInPolygon,
  resolveVendorShippingFee,
} from "../src/services/vendor-shipping.js";
import { calculateShipping } from "../src/services/calculate-shipping.js";

const data = loadKenyaLocations();
assert.equal(data.counties.length, 47, "expected 47 counties");
assert.equal(listCounties().length, 47);
assert.equal(getCounty("Nairobi")?.tier, 1);
assert.equal(getCounty("Turkana")?.tier, 4);

const vendor = "test-hybrid-shop";
upsertVendorShippingProfile(vendor, {
  shippingType: "TIERED",
  tier1RateKes: 180,
  tier2RateKes: 320,
  tier3RateKes: 440,
  tier4RateKes: 700,
  localExpressEnabled: true,
  supportedTiers: [1, 2, 3, 4],
});

const zone = saveVendorZone(vendor, {
  zoneName: "Test Westlands box",
  priceKes: 150,
  boundary: {
    type: "Polygon",
    coordinates: [
      [
        [36.8, -1.26],
        [36.82, -1.26],
        [36.82, -1.28],
        [36.8, -1.28],
        [36.8, -1.26],
      ],
    ],
  },
});
assert.equal(zone.ok, true);
assert.equal(pointInPolygon(36.81, -1.27, zone.zone.boundary), true);
assert.equal(pointInPolygon(36.9, -1.27, zone.zone.boundary), false);

const pinFee = resolveVendorShippingFee({
  vendorKey: vendor,
  deliveryMethod: "MAP_PIN",
  buyerCoordinates: { lat: -1.27, lng: 36.81 },
});
assert.equal(pinFee.shippingFee, 150);

const countyFee = resolveVendorShippingFee({
  vendorKey: vendor,
  deliveryMethod: "COUNTY_DROPDOWN",
  buyerCounty: "Kisumu",
});
assert.equal(countyFee.shippingFee, 320);
assert.equal(countyFee.tier, 2);

const calc = await calculateShipping({
  cartItems: [{ productId: "p1", vendorId: vendor, qty: 1 }],
  deliveryMethod: "MAP_PIN",
  buyerCoordinates: { lat: -1.27, lng: 36.81 },
});
assert.equal(calc.ok, true);
assert.equal(calc.totalShippingFee, 150);

const noProfile = await calculateShipping({
  cartItems: [{ productId: "p1", vendorId: "brand-new-seller-xyz", qty: 1 }],
  deliveryMethod: "COUNTY_DROPDOWN",
  buyerCounty: "Nairobi",
});
assert.equal(noProfile.totalShippingFee, 0, "no profile must keep KES 0 shipping");

console.log("OK hybrid shipping smoke tests passed");
