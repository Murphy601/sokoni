/**
 * Buyer-facing trust: real rows, no discount, hub stays off.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sellerTrustLine } from "./escrow-chat-cards.js";
import { buyerCanRelease } from "./buyer-release.js";
import { refundDue, stampDispatchDeadline, DISPATCH_DEADLINE_MS } from "./undispatched-refund.js";
import { hubInspectionOffer } from "./hub-inspection.js";
import { tickerItems } from "./trust-ticker.js";
import { inspectionRemainingLabel, inspectionWindowOpen } from "../agents/inspection-window.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the escrow card", () => {
  it("tells the buyer the seller is not paid yet", () => {
    const body = src("./escrow-chat-cards.js");
    assert.match(body, /2-hour inspection window ends/);
    assert.match(body, /SOKONI ESCROW PROTECTION ACTIVE/);
    assert.doesNotMatch(body, /Segregated/);
  });
});

describe("seller trust", () => {
  it("uses the rating on file and does not invent a perfect score", () => {
    assert.equal(
      sellerTrustLine({ completed_orders: 0, is_seller_verified: true, rating_score: 5 }),
      "New verified seller. Your money stays in escrow."
    );
    assert.equal(
      sellerTrustLine({ completed_orders: 42, rating_score: 4.9, rating_count: 10, is_seller_verified: true }),
      "4.9 rating · 42 completed orders · Verified seller"
    );
  });
});

describe("the inspection window", () => {
  it("counts down and lets the buyer release only after delivery", () => {
    const ends = Date.now() + 2 * 60 * 60 * 1000;
    assert.match(inspectionRemainingLabel(ends), /02h 00m|01h 5/);
    const order = {
      id: "SKN-9",
      status: "delivered",
      customerPaymentStatus: "confirmed",
      inspectionStartedAt: Date.now(),
      inspectionEndsAt: ends,
      escrowStatus: "held",
    };
    assert.equal(inspectionWindowOpen(order), true);
    assert.equal(buyerCanRelease(order), true);
    assert.equal(buyerCanRelease({ ...order, disputeHold: true }), false);
  });
});

describe("a seller who does not dispatch", () => {
  it("refunds only a stamped order that is still sitting", () => {
    const paidAt = 1_000_000;
    const order = {
      id: "SKN-9",
      customerPaymentStatus: "confirmed",
      dispatchDeadlineAt: stampDispatchDeadline(paidAt),
      escrowStatus: "held",
    };
    assert.equal(stampDispatchDeadline(paidAt) - paidAt, DISPATCH_DEADLINE_MS);
    assert.equal(refundDue(order, paidAt + DISPATCH_DEADLINE_MS - 1), false);
    assert.equal(refundDue(order, paidAt + DISPATCH_DEADLINE_MS), true);
    assert.equal(refundDue({ ...order, sellerDispatchedAt: paidAt }, paidAt + DISPATCH_DEADLINE_MS), false);
    assert.equal(refundDue({ id: "SKN-1", customerPaymentStatus: "confirmed" }, Date.now()), false);
  });
});

describe("the public ticker and the hub", () => {
  it("leaves phones and order ids out of the feed", () => {
    const items = tickerItems([
      {
        id: "SKN-9",
        productName: "Vintage jacket",
        deliveryTown: "Kisumu",
        phone: "254712345678",
        escrowStatus: "released",
        buyerConfirmedAt: Date.now() - 60_000,
        totalKes: 1400,
      },
    ]);
    assert.equal(items.length, 1);
    assert.match(items[0].text, /Kisumu/);
    assert.doesNotMatch(items[0].text, /2547|SKN-9/);
  });

  it("does not offer hub inspection until the flag is on", () => {
    const previous = process.env.SOKONI_HUB_INSPECTION;
    delete process.env.SOKONI_HUB_INSPECTION;
    assert.equal(hubInspectionOffer({ totalKes: 8000 }).offered, false);
    if (previous == null) delete process.env.SOKONI_HUB_INSPECTION;
    else process.env.SOKONI_HUB_INSPECTION = previous;
  });
});
