import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { quoteShippingForPending } from "./prepaid-order-steps.js";
import {
  upsertVendorShippingProfile,
  normalizeVendorKey,
} from "./vendor-shipping.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STORE_FILE = path.join(DATA_DIR, "vendor-shipping.json");
const BACKUP_FILE = path.join(DATA_DIR, `vendor-shipping.test-backup.${process.pid}.json`);

describe("STK shipping gate — force block missing rates", () => {
  before(() => {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(STORE_FILE)) {
      writeFileSync(BACKUP_FILE, readFileSync(STORE_FILE, "utf8"));
    } else {
      writeFileSync(BACKUP_FILE, JSON.stringify({ profiles: {}, zones: {} }));
    }
    writeFileSync(STORE_FILE, JSON.stringify({ profiles: {}, zones: {} }, null, 2));
  });

  after(() => {
    if (existsSync(BACKUP_FILE)) {
      renameSync(BACKUP_FILE, STORE_FILE);
    }
  });

  it("quoteShippingForPending fails closed when seller has no Hub profile", () => {
    const quote = quoteShippingForPending(
      {
        shopHandle: "ghost_shop_no_rates_xyz",
        sellerNetKes: 60,
        priceKes: 60,
      },
      { county: "Nairobi", town: "Westlands", tier: 1 }
    );
    assert.equal(quote.ok, false);
    assert.equal(quote.configured, false);
    assert.equal(quote.error, "missing_shipping_rates");
    assert.match(String(quote.message || ""), /No M-Pesa prompt/i);
  });

  it("quoteShippingForPending fails when fee is 0 without free-shipping flag", () => {
    const key = normalizeVendorKey("zero_rate_shop_xyz");
    upsertVendorShippingProfile(key, {
      shippingType: "FLAT_RATE",
      flatLocalRateKes: 0,
      flatUpcountryRateKes: 0,
      isFreeShippingEnabled: false,
    });
    const quote = quoteShippingForPending(
      { shopHandle: key, sellerNetKes: 60, priceKes: 60 },
      { county: "Nairobi", town: "CBD", tier: 1 }
    );
    assert.equal(quote.ok, false);
    assert.match(String(quote.error || ""), /missing_shipping|unsupported/i);
  });

  it("quoteShippingForPending allows explicit free shipping", () => {
    const key = normalizeVendorKey("free_ship_shop_xyz");
    upsertVendorShippingProfile(key, {
      shippingType: "FLAT_RATE",
      flatLocalRateKes: 200,
      flatUpcountryRateKes: 400,
      isFreeShippingEnabled: true,
    });
    const quote = quoteShippingForPending(
      { shopHandle: key, sellerNetKes: 60, priceKes: 60 },
      { county: "Nairobi", town: "CBD", tier: 1 }
    );
    assert.equal(quote.ok, true);
    assert.equal(quote.configured, true);
    assert.equal(quote.shippingKes, 0);
    assert.equal(quote.freeShipping, true);
  });

  it("shipping-gate ensure catch is fail-closed", () => {
    const src = readFileSync(path.join(__dirname, "shipping-gate.js"), "utf-8");
    assert.match(src, /ensure FAILED — blocking STK/);
    assert.doesNotMatch(src, /ensure failed:[\s\S]{0,80}ok: true/);
  });

  it("confirmPrepaidOrder re-quotes before STK", () => {
    const src = readFileSync(path.join(__dirname, "menu.js"), "utf-8");
    assert.match(src, /quoteShippingForPending\(quoteBase/);
    assert.match(src, /gateShippingBeforeStk\(order\)/);
    assert.match(src, /No M-Pesa prompt will be sent/);
  });

  it("KES 61 on ~KES 55 item is platform 10% fee + zero shipping — not listing shipping", async () => {
    const { computeFeeBreakdown } = await import("./shipping-tiers.js");
    const fees = computeFeeBreakdown(55, 0, {
      freeShipping: true,
      deliveryMethod: "seller_express",
    });
    assert.equal(fees.platformFeeKes, 6);
    assert.equal(fees.shippingKes, 0);
    assert.equal(fees.buyerTotalKes, 61);
  });

  it("computeProductTotals ignores product.shippingKes listing field", async () => {
    const { computeProductTotals } = await import("./shipping-tiers.js");
    const totals = computeProductTotals({
      sellerNetKes: 55,
      priceKes: 61,
      shippingKes: 6,
      shippingFeeKes: 6,
      deliveryMethod: "seller_express",
    });
    assert.equal(totals.shippingKes, 0);
    assert.equal(totals.shippingSource, "pending_hub");
  });

  it("ensureHybridShippingBeforePayment fails closed without Hub profile", async () => {
    const src = readFileSync(path.join(__dirname, "apply-order-shipping.js"), "utf-8");
    assert.match(src, /reason: "no_profile"/);
    assert.match(src, /ok: false, order, applied: false, reason: "no_profile"/);
    assert.doesNotMatch(
      src,
      /leave totals, but don't block STK/
    );
  });

  it("gate rejects listing shipping not from Hub", () => {
    const src = readFileSync(path.join(__dirname, "shipping-gate.js"), "utf-8");
    assert.match(src, /listing_shipping_not_hub/);
    assert.match(src, /isHubPricedShipping/);
  });
});
