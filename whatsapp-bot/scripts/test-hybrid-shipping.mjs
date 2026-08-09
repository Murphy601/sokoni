/**
 * Smoke test: county seed count + zone PIP + fee engine (no network).
 */
import assert from "node:assert/strict";
import { listCounties, getCounty, loadKenyaLocations, inferCountyFromText } from "../src/services/kenya-locations.js";
import {
  upsertVendorShippingProfile,
  upsertVendorShippingProfileForSeller,
  findConfiguredVendorProfile,
  saveVendorZone,
  pointInPolygon,
  resolveVendorShippingFee,
  isConfiguredShippingProfile,
} from "../src/services/vendor-shipping.js";
import { calculateShipping } from "../src/services/calculate-shipping.js";
import { quoteShippingForPending, parseLocationStep } from "../src/services/prepaid-order-steps.js";

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

assert.equal(inferCountyFromText("Jane, Umoja 1 near the market, 0712345678")?.county, "Nairobi");
assert.equal(inferCountyFromText("Nakuru Naivas")?.county, "Nakuru");
assert.equal(isConfiguredShippingProfile(upsertVendorShippingProfile(vendor, {}).profile), true);

// Multi-key seller profile: rates saved under supplier id must quote via shop handle.
const seller = {
  shopHandle: "@adiv_thrift",
  id: "seller-adiv-thrift-lom7",
  phone: "254748879579",
};
upsertVendorShippingProfileForSeller(seller, {
  shippingType: "TIERED",
  tier1RateKes: 200,
  tier2RateKes: 350,
  tier3RateKes: 450,
  tier4RateKes: 750,
  supportedTiers: [1, 2, 3, 4],
});
const foundHandle = findConfiguredVendorProfile(["adiv_thrift"]);
const foundId = findConfiguredVendorProfile(["seller-adiv-thrift-lom7"]);
assert.equal(Boolean(foundHandle.profile), true);
assert.equal(Boolean(foundId.profile), true);

const muranga = parseLocationStep("Murang'a, kandara, kcb bank");
assert.equal(muranga?.county, "Murang'a");
const quote = quoteShippingForPending(
  {
    shopHandle: "adiv_thrift",
    supplierId: "seller-adiv-thrift-lom7",
    sellerNetKes: 70,
    priceKes: 70,
  },
  muranga
);
assert.equal(quote.ok, true);
assert.ok(quote.shippingKes > 0, "Murang'a delivery must not be KES 0 when rates exist");

console.log("OK hybrid shipping smoke tests passed");
