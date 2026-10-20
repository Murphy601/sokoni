import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shareCardFor, FIT_CHECK_TTL_HOURS } from "./fit-check.js";

const SRC = readFileSync(new URL("./fit-check.js", import.meta.url), "utf8");
const STORE = readFileSync(new URL("./fit-photo-store.js", import.meta.url), "utf8");
const HUB = readFileSync(new URL("./communication-hub.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../routes/socialApi.js", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../../db/schema-phase39-fit-check.sql", import.meta.url), "utf8");
const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");

describe("when it is asked", () => {
  it("fires on escrow release, not on delivery", () => {
    // The moment the buyer has the thing and the deal is finished.
    assert.match(HUB, /inviteFitCheck\(fresh\)/);
    const block = HUB.slice(HUB.indexOf("inviteFitCheck") - 900, HUB.indexOf("inviteFitCheck"));
    assert.match(block, /escrowStatus: "released"|postEscrowCard\(fresh, "released"\)/);
  });

  it("asks once per order", () => {
    // Asking the same person again for the same purchase is nagging.
    assert.match(SRC, /WHERE kind = \$1 AND payload->>'orderRef' = \$2 LIMIT 1/);
  });

  it("stays quiet if it cannot tell whether it already asked", () => {
    const fn = SRC.slice(SRC.indexOf("export async function inviteFitCheck"));
    assert.match(fn.slice(0, 1400), /duplicate check failed, skipping/);
  });

  it("cannot hold up a release", () => {
    assert.match(HUB, /void inviteFitCheck\(fresh\)/);
    const block = HUB.slice(HUB.indexOf("inviteFitCheck") - 300, HUB.indexOf("inviteFitCheck") + 200);
    assert.match(block, /catch \(err\)/);
  });

  it("asks for a photo and does not offer a discount", () => {
    assert.match(SRC, /How does it fit/);
    assert.doesNotMatch(SRC, /KES 100|off your next|rewardKes/);
  });

  it("lets the invitation lapse rather than standing forever", () => {
    assert.equal(FIT_CHECK_TTL_HOURS, 72);
    assert.match(SRC, /fit_check_expired/);
  });
});

describe("verified means something", () => {
  it("only the buyer on that order may attach a photo", () => {
    assert.match(SRC, /not_your_card/);
    assert.match(SRC, /Number\(row\.receiver_user_id\) !== viewer/);
  });

  it("refuses a second photo for the same order", () => {
    assert.match(SRC, /already_shared/);
  });

  it("writes the badge deliberately rather than inferring it", () => {
    assert.match(SCHEMA, /is_verified BOOLEAN NOT NULL DEFAULT FALSE/);
    assert.match(SRC, /'buyer_to_seller', \$5, TRUE/);
  });
});

describe("the review row", () => {
  it("goes into order_reviews, not a table of its own", () => {
    // A fit check should count towards a seller's rating like any review;
    // a separate table means every reader has to remember to union it.
    assert.match(SRC, /INSERT INTO order_reviews/);
    assert.doesNotMatch(SRC, /shop_reviews/);
  });

  it("names the direction, because phase 13 keys uniqueness on it", () => {
    assert.match(SRC, /direction, photo_url, is_verified/);
    assert.match(SRC, /ON CONFLICT DO NOTHING/);
  });

  it("keeps the photo even if the review row fails", () => {
    // The buyer has done their part either way.
    const fn = SRC.slice(SRC.indexOf("export async function attachFitCheckPhoto"));
    assert.match(fn, /review publish skipped/);
    assert.match(fn, /published,/);
  });
});

describe("the photo on disk", () => {
  it("is kept, unlike a voice note", () => {
    // A public review whose photo vanishes reads as a deleted image to
    // everyone who visits afterwards.
    assert.match(STORE, /Kept, not expired/);
  });

  it("is named with a UUID, never from the upload", () => {
    assert.match(STORE, /randomUUID\(\)/);
    assert.doesNotMatch(STORE, /originalname/);
  });

  it("accepts only real image types", () => {
    assert.ok(API.includes("jpe?g|png|webp"), "route does not restrict image types");
    assert.match(STORE, /unsupported_image/);
  });

  it("is capped and held in memory only", () => {
    assert.match(API, /fileSize: 5 \* 1024 \* 1024/);
    assert.match(API, /storage: multer\.memoryStorage\(\)/);
  });
});

describe("the share card", () => {
  it("is data, not a rendered image", () => {
    // Drawing one server-side means a canvas library and a file per order.
    const card = shareCardFor({ productTitle: "Nike windbreaker", orderRef: "SKN-1042" }, "/p.jpg");
    assert.equal(card.photoUrl, "/p.jpg");
    assert.equal(card.title, "Nike windbreaker");
    assert.match(card.caption, /Sokoni Mall/);
  });

  it("copes with a bare payload", () => {
    assert.doesNotThrow(() => shareCardFor(null, "/p.jpg"));
    assert.equal(shareCardFor({}, "/p.jpg").title, "My Sokoni find");
  });

  it("falls back to copying when there is no share sheet", () => {
    assert.match(JS, /navigator\.share/);
    assert.match(JS, /clipboard\?\.writeText/);
  });

  it("does not treat a cancelled share as a failure", () => {
    const fn = JS.slice(JS.indexOf("async function shareFitCard"));
    assert.match(fn.slice(0, 900), /catch \{/);
  });
});

describe("declining is normal", () => {
  it("shows the seller that it was asked, not a button they cannot press", () => {
    assert.match(JS, /Buyer was invited to share a fit pic/);
  });

  it("clears the file input so the same photo can be re-picked", () => {
    assert.match(JS, /input\.value = ""/);
  });
});
