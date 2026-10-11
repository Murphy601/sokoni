import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickDailyDropItems, dailyDropCaption, runDailyDrop } from "./daily-drop.js";

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

  it("posts the drop to Status and Channel together", async () => {
    const posted = await runDailyDrop({
      dryRun: true,
      items: [{ id: "c", name: "Popular boots", priceKes: 3500, views: 400 }],
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.destination, "BOTH");
    assert.deepEqual(posted.destinations, ["STATUS", "CHANNEL"]);
    assert.equal(posted.dailyDrop, true);
  });

  it("posts text when the product photo is on a blocked host", async () => {
    const posted = await runDailyDrop({
      dryRun: true,
      media_url: "https://res.cloudinary.com/demo/itel.jpg",
      items: [{ id: "c", name: "Black Itel Feature Phone", priceKes: 12 }],
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.destination, "BOTH");
    assert.equal(posted.mediaUrl, null);
    assert.equal(posted.mediaSkipped, true);
  });
});
