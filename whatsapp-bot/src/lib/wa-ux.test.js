import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  msgBuyerShippingCancel,
  msgSellerShippingCancel,
  msgSellerShippingReminder,
  msgRiderPickupStep,
  msgRiderDeliveryStep,
  msgBuyerOutForDelivery,
  msgAdminPickupHandover,
  msgPickupFormatHint,
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
    assert.match(m, /1️⃣/);
    assert.match(m, /4️⃣/);
    assert.match(m, /Save/);
  });

  it("rider accept shows seller contact, delivery step shows buyer", () => {
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

  it("buyer out-for-delivery + admin audit", () => {
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
    });
    assert.match(a, /DISPATCH AUDIT/);
    assert.match(a, /IN_TRANSIT/);
  });

  it("pickup format hint", () => {
    assert.match(msgPickupFormatHint("SKN-1015"), /PICKUP SKN-1015/);
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
