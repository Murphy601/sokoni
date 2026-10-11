import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pickDailyDropItems,
  pickNextDripItem,
  dailyDropCaption,
  dripDropCaption,
  isDripSlot,
  runDailyDrop,
} from "./daily-drop.js";
import { ensureCatalogImageBotUrl } from "../lib/catalog-images.js";

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
    assert.equal(posted.drip, true);
  });

  it("reuses a local catalog cover for WhatsApp", async () => {
    const url = await ensureCatalogImageBotUrl(
      { id: "pt-tondx-001" },
      "https://res.cloudinary.com/rztynxme/image/upload/v1/sokoni-studio/cutout.jpg"
    );
    assert.match(String(url), /catalog-images\/pt-tondx-001\.jpg/);
  });

  it("attaches the Cloudinary catalog photo with the caption", async () => {
    const { isAllowedOpsMediaUrl } = await import("./ops-desk-actions.js");
    const cloudinary =
      "https://res.cloudinary.com/rztynxme/image/upload/v1790629931/sokoni-studio/cutout.jpg";
    assert.equal(isAllowedOpsMediaUrl(cloudinary), true);
    assert.equal(isAllowedOpsMediaUrl("https://evil.example/itel.jpg"), false);

    const posted = await runDailyDrop({
      dryRun: true,
      media_url: cloudinary,
      items: [{ id: "c", name: "Black Itel Feature Phone", priceKes: 12 }],
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.destination, "BOTH");
    assert.equal(posted.mediaUrl, cloudinary);
    assert.ok(!posted.mediaSkipped);
    assert.match(posted.text, /Black Itel Feature Phone/);
  });

  it("rotates the seller who has waited longest, then their oldest item", () => {
    const next = pickNextDripItem(
      [
        { id: "a1", name: "A jacket", sellerHandle: "ada", inStock: true, lastPromotedAt: 100, priceKes: 800 },
        { id: "b1", name: "B boots", sellerHandle: "ben", inStock: true, lastPromotedAt: 50, priceKes: 1200 },
        { id: "b2", name: "B bag", sellerHandle: "ben", inStock: true, lastPromotedAt: null, priceKes: 900 },
        { id: "sold", name: "Gone", sellerHandle: "ada", isSold: true, lastPromotedAt: null },
      ],
      {}
    );
    assert.equal(next.id, "b2");
    const caption = dripDropCaption(next);
    assert.match(caption, /B bag/);
    assert.match(caption, /Prepaid M-Pesa escrow/);
    assert.equal(/\bpaybill\b/i.test(caption), false);
  });

  it("fires on the 30-minute window from 08:00 to 20:30 EAT", () => {
    assert.equal(isDripSlot({ hour: 8, minute: 0 }), true);
    assert.equal(isDripSlot({ hour: 8, minute: 30 }), true);
    assert.equal(isDripSlot({ hour: 20, minute: 30 }), true);
    assert.equal(isDripSlot({ hour: 7, minute: 30 }), false);
    assert.equal(isDripSlot({ hour: 21, minute: 0 }), false);
    assert.equal(isDripSlot({ hour: 12, minute: 15 }), false);
  });

  it("skips unknown hosts and still posts the caption", async () => {
    const posted = await runDailyDrop({
      dryRun: true,
      media_url: "https://evil.example/itel.jpg",
      items: [{ id: "c", name: "Black Itel Feature Phone", priceKes: 12 }],
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.destination, "BOTH");
    assert.equal(posted.mediaUrl, null);
    assert.equal(posted.mediaSkipped, true);
  });
});
