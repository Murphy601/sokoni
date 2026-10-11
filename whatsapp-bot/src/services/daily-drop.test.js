import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickDailyDropItems, dailyDropCaption } from "./daily-drop.js";

describe("daily drop curation", () => {
  it("picks the most viewed unsold items and writes a prepaid caption", () => {
    const items = pickDailyDropItems(
      [
        { id: "a", name: "Sold jacket", isSold: true, views: 99, priceKes: 2000 },
        { id: "b", name: "Quiet shirt", views: 2, inStock: true, priceKes: 800 },
        { id: "c", name: "Popular boots", views: 400, inStock: true, priceKes: 3500 },
        { id: "d", name: "OOS bag", quantity: 0, views: 80, priceKes: 1200 },
        { id: "e", name: "Mid denim", reviews: 12, rating: 4.5, inStock: true, priceKes: 1500 },
      ],
      3
    );
    assert.equal(items[0].id, "c");
    assert.ok(!items.some((p) => p.isSold || p.quantity === 0));
    const caption = dailyDropCaption(items);
    assert.match(caption, /Prepaid M-Pesa escrow/);
    assert.match(caption, /Countrywide Kenya/);
    assert.equal(/\bpaybill\b/i.test(caption), false);
    assert.match(caption, /Popular boots/);
  });
});
