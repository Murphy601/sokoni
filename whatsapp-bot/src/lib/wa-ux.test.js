import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  msgBuyerShippingCancel,
  msgSellerShippingCancel,
  msgSellerShippingReminder,
  msgSellerNewPaidOrder,
  msgSellerLowStock,
  msgRiderPickupStep,
  msgRiderDeliveryStep,
  msgBuyerOutForDelivery,
  msgBuyerPaymentConfirmed,
  msgAdminPickupHandover,
  msgPickupFormatHint,
  dedupeLocationLine,
  generateOrderPrintLabelUrl,
  generateRiderScanUrl,
} from "../lib/wa-ux.js";

describe("wa-ux templates", () => {
  it("shipping cancel messages have header + reason + no STK claim", () => {
    const b = msgBuyerShippingCancel("SKN-1015", "Blue shoes");
    assert.match(b, /ORDER CANCELLED/);
    assert.match(b, /SKN-1015/);
    assert.match(b, /Blue shoes/);
    assert.match(b, /No funds deducted/);
    const s = msgSellerShippingCancel("SKN-1015", "Blue shoes", "Nairobi");
    assert.match(s, /ORDER CANCELLED/);
    assert.match(s, /Nairobi/);
    assert.match(s, /Hub Drop-off/);
  });

  it("seller reminder is numbered steps", () => {
    const m = msgSellerShippingReminder();
    assert.match(m, /ACTION REQUIRED/);
    assert.match(m, /Hub Drop-off/);
    assert.match(m, /Save/);
  });

  it("seller paid includes printable QR waybill link", () => {
    const m = msgSellerNewPaidOrder({
      orderId: "SKN-1020",
      itemName: "Mustard Trucker Cap",
      listingId: "fa-pekbd-001",
      location: "Westlands Stage, Nairobi, Westlands",
      payoutKes: 245,
      localRider: true,
    });
    assert.match(m, /NEW PAID ORDER/);
    assert.match(m, /PRINTABLE QR WAYBILL/);
    assert.match(m, /label\.html\?order=SKN-1020/);
    assert.doesNotMatch(m, /Problem\?/);
    assert.doesNotMatch(m, /You do not pick or pin/);
    // location deduped — Westlands not thrice
    assert.equal((m.match(/Westlands/gi) || []).length <= 2, true);
  });

  it("low stock template is scannable", () => {
    const m = msgSellerLowStock({
      itemName: "Mustard Trucker Cap",
      remainingUnits: 1,
      restockUrl: "https://sokonimall.com/suppliers/list.html",
    });
    assert.match(m, /LOW STOCK/);
    assert.match(m, /1 unit/);
    assert.match(m, /suppliers\/list\.html/);
  });

  it("rider accept shows seller contact + scan link, delivery step shows buyer", () => {
    const pick = msgRiderPickupStep({
      orderId: "SKN-1015",
      shopName: "Westlands Shop",
      pickupAddr: "Stage Westlands",
      sellerPhone: "254712000000",
      feeKes: 55,
    });
    assert.match(pick, /JOB CONFIRMED/);
    assert.match(pick, /Westlands Shop/);
    assert.match(pick, /254712000000/);
    assert.match(pick, /PICKUP SKN-1015/);
    assert.match(pick, /SCAN PARCEL QR/);
    assert.match(pick, /rider\/scan\.html\?order=SKN-1015/);
    assert.doesNotMatch(pick, /Drop-off|Buyer phone/i);

    const del = msgRiderDeliveryStep({
      orderId: "SKN-1015",
      buyerName: "Ann",
      dropoffAddr: "Kilimani",
      buyerPhone: "254711111111",
      feeKes: 55,
    });
    assert.match(del, /PICKUP VERIFIED/);
    assert.match(del, /Ann/);
    assert.match(del, /Kilimani/);
    assert.match(del, /CONFIRM SKN-1015/);
  });

  it("buyer payment + out-for-delivery + admin audit", () => {
    const paid = msgBuyerPaymentConfirmed({
      orderId: "SKN-1020",
      itemName: "Cap",
      totalKes: 310,
      location: "Westlands Stage, Nairobi",
    });
    assert.match(paid, /PAYMENT CONFIRMED/);
    assert.match(paid, /310/);

    const b = msgBuyerOutForDelivery({
      orderId: "SKN-1015",
      riderName: "Peter",
      riderPhone: "254748879579",
      plate: "KMGB 123X",
      deliveryOtp: "4821",
    });
    assert.match(b, /OUT FOR DELIVERY/);
    assert.match(b, /Peter/);
    assert.match(b, /4821/);
    assert.match(b, /stay near your phone/i);

    const a = msgAdminPickupHandover({
      orderId: "SKN-1015",
      riderName: "Peter",
      riderPhone: "254748879579",
      plate: "KMGB 123X",
      sellerPhone: "254700000000",
      buyerName: "Jane",
      buyerPhone: "254711111111",
      escrowKes: 310,
    });
    assert.match(a, /DISPATCH AUDIT/);
    assert.match(a, /IN_TRANSIT/);
    assert.match(a, /310/);
  });

  it("pickup format hint", () => {
    assert.match(msgPickupFormatHint("SKN-1015"), /PICKUP SKN-1015/);
  });

  it("dedupeLocationLine collapses repeats", () => {
    assert.equal(
      dedupeLocationLine("Nairobi, Westlands, Westlands stage, Westlands"),
      "Nairobi, Westlands stage"
    );
    assert.match(generateOrderPrintLabelUrl("skn-1020"), /order=SKN-1020/);
    assert.match(generateRiderScanUrl("SKN-1020"), /rider\/scan\.html\?order=SKN-1020/);
  });
});

describe("PICK UP regex", () => {
  it("matches Pick up SkN-1015 5972", () => {
    const trimmed = "Pick up SkN-1015 5972".replace(/\s+/g, " ").trim();
    const m = trimmed.match(/^(?:PICK\s*UP|PICKUP)\s+(SKN?-?\d{1,6}(?:-\d+)?)\s+(\d{4})\b/i);
    assert.ok(m);
    assert.match(m[1], /1015/);
    assert.equal(m[2], "5972");
  });
});
