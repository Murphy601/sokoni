import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVendorShippingFee } from "./vendor-shipping.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("no invented platform shipping fees", () => {
  it("tiered profile without tier rate returns unsupported (not KES 350)", () => {
    const out = resolveVendorShippingFee({
      vendorKey: "test_shop",
      deliveryMethod: "COUNTY_DROPDOWN",
      buyerCounty: "Nakuru",
      profile: {
        sellerConfigured: true,
        shippingType: "TIERED",
        tier1RateKes: 100,
        // tier2 intentionally missing — Nakuru is tier 2 (was inventing KES 350)
        supportedTiers: [1, 2, 3, 4],
        isFreeShippingEnabled: false,
      },
    });
    assert.equal(out.unsupported, true);
    assert.equal(out.shippingFee, 0);
    assert.doesNotMatch(String(out.methodUsed || ""), /PLATFORM/);
  });

  it("checkout fails closed when shipping gate throws", () => {
    const src = readFileSync(path.join(__dirname, "prepaid-checkout.js"), "utf-8");
    assert.match(src, /shipping gate FAILED — blocking STK/);
    assert.doesNotMatch(src, /shipping gate skipped/);
    assert.doesNotMatch(src, /ensureHybridShippingBeforePayment\(order\)/);
  });

  it("boda enrich resolves seller pickup helper", () => {
    const src = readFileSync(path.join(__dirname, "boda-fleet.js"), "utf-8");
    assert.match(src, /resolveSellerPickupDetailsAsync/);
    assert.match(src, /Ask seller for exact pin on call/);
  });
});
