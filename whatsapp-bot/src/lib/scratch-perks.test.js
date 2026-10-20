import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validatePerk,
  maxDiscountFor,
  deliveryCostNotice,
  isPerkExpired,
  perkMinutesLeft,
  PERK_TYPES,
  PRICE_FLOOR_KES,
  PERK_TTL_MS,
} from "./scratch-perks.js";
import { BASE_FEE_KES, MAX_FEE_KES } from "./rider-distance-fee.js";

describe("the floor holds", () => {
  it("never lets a price drop below the floor", () => {
    // A zero or negative payout is the failure this rule exists to stop.
    for (const price of [101, 150, 200, 500, 1000, 5000]) {
      for (const pct of [1, 25, 50, 75, 90]) {
        const r = validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: pct }, price);
        assert.equal(r.ok, true, `${pct}% off ${price}`);
        assert.ok(r.finalKes >= PRICE_FLOOR_KES, `${pct}% off ${price} left ${r.finalKes}`);
      }
    }
  });

  it("caps a percentage that would go under, rather than refusing it", () => {
    // 90% off 150 is 135, which would leave 15. Take 50 and say so.
    const r = validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: 90 }, 150);
    assert.equal(r.ok, true);
    assert.equal(r.finalKes, PRICE_FLOOR_KES);
    assert.equal(r.discountKes, 50);
    assert.equal(r.capped, true);
  });

  it("refuses a fixed amount that would go under, and says the most allowed", () => {
    const r = validatePerk({ type: PERK_TYPES.AMOUNT_OFF, amountKes: 500 }, 400);
    assert.equal(r.ok, false);
    assert.equal(r.error, "below_floor");
    assert.match(r.message, /KES 300/);
  });

  it("says there is no room on an item already at the floor", () => {
    const r = validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: 10 }, 100);
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_room");
    assert.match(r.message, /free delivery/i);
  });

  it("computes the room correctly", () => {
    assert.equal(maxDiscountFor(1000), 900);
    assert.equal(maxDiscountFor(100), 0);
    assert.equal(maxDiscountFor(50), 0);
    assert.equal(maxDiscountFor(0), 0);
  });

  it("rounds a percentage down, so it never takes more than it says", () => {
    const r = validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: 33 }, 1000);
    assert.equal(r.discountKes, 330);
  });
});

describe("free delivery is the seller's money", () => {
  it("does not touch the item price", () => {
    const r = validatePerk({ type: PERK_TYPES.FREE_DELIVERY }, 1000);
    assert.equal(r.ok, true);
    assert.equal(r.finalKes, 1000);
    assert.equal(r.discountKes, 0);
  });

  it("is offered even on an item too cheap to discount", () => {
    // The one perk that still works at the floor.
    assert.equal(validatePerk({ type: PERK_TYPES.FREE_DELIVERY }, 100).ok, true);
  });

  it("warns with the real rider range, read from the tariff", () => {
    const notice = deliveryCostNotice();
    assert.match(notice, /escrow payout/i);
    assert.ok(notice.includes(BASE_FEE_KES.toLocaleString("en-US")), "no floor in the notice");
    assert.ok(notice.includes(MAX_FEE_KES.toLocaleString("en-US")), "no cap in the notice");
  });

  it("keeps the notice honest if the tariff changes", () => {
    // Read from rider-distance-fee, not restated, so 400-1500 cannot go stale.
    assert.equal(BASE_FEE_KES, 400);
    assert.equal(MAX_FEE_KES, 1500);
  });
});

describe("what a perk may be", () => {
  it("refuses a percentage outside 1 to 90", () => {
    for (const pct of [0, -5, 91, 100, 1000, NaN]) {
      assert.equal(validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: pct }, 1000).ok, false, String(pct));
    }
  });

  it("refuses a zero or negative amount", () => {
    for (const amt of [0, -100, NaN, null]) {
      assert.equal(validatePerk({ type: PERK_TYPES.AMOUNT_OFF, amountKes: amt }, 1000).ok, false, String(amt));
    }
  });

  it("refuses a perk type it does not offer", () => {
    for (const t of ["free_money", "", null, "PERCENT_OFF"]) {
      assert.equal(validatePerk({ type: t }, 1000).ok, false, String(t));
    }
  });

  it("refuses an item with no price", () => {
    assert.equal(validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: 10 }, 0).ok, false);
  });

  it("does not throw on rubbish", () => {
    for (const bad of [null, undefined, "x", 5, []]) {
      assert.doesNotThrow(() => validatePerk(bad, 1000));
      assert.equal(validatePerk(bad, 1000).ok, false);
    }
  });

  it("labels each perk in words a buyer will read", () => {
    assert.equal(validatePerk({ type: PERK_TYPES.PERCENT_OFF, percent: 10 }, 1000).perk.label, "10% off");
    assert.equal(validatePerk({ type: PERK_TYPES.AMOUNT_OFF, amountKes: 100 }, 1000).perk.label, "KES 100 off");
    assert.equal(validatePerk({ type: PERK_TYPES.FREE_DELIVERY }, 1000).perk.label, "Free delivery");
  });
});

describe("a revealed perk expires", () => {
  it("lasts 24 hours from the scratch", () => {
    assert.equal(PERK_TTL_MS, 24 * 60 * 60 * 1000);
    const now = Date.now();
    assert.equal(isPerkExpired(new Date(now - 60_000), now), false);
    assert.equal(isPerkExpired(new Date(now - PERK_TTL_MS + 1000), now), false);
    assert.equal(isPerkExpired(new Date(now - PERK_TTL_MS - 1000), now), true);
  });

  it("does not expire before it is scratched", () => {
    // The countdown is the point: it starts when the buyer reveals it.
    assert.equal(isPerkExpired(null), false);
    assert.equal(isPerkExpired(undefined), false);
  });

  it("counts down in minutes and stops at zero", () => {
    const now = Date.now();
    assert.equal(perkMinutesLeft(null), 1440);
    assert.equal(perkMinutesLeft(new Date(now - 60 * 60_000), now), 1380);
    assert.equal(perkMinutesLeft(new Date(now - PERK_TTL_MS * 2), now), 0);
  });

  it("treats an unreadable timestamp as gone rather than forever", () => {
    assert.equal(perkMinutesLeft("not a date"), 0);
  });
});
