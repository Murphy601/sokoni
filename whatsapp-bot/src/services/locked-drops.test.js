import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isDropUnlocked,
  dropSecondsLeft,
  DROP_WINDOW_MS,
  MAX_DROP_RECIPIENTS,
} from "./locked-drops.js";

const SRC = readFileSync(new URL("./locked-drops.js", import.meta.url), "utf8");
const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url), "utf8");

describe("the window", () => {
  it("lasts an hour", () => {
    assert.equal(DROP_WINDOW_MS, 60 * 60 * 1000);
  });

  it("knows when it has closed", () => {
    const now = Date.now();
    assert.equal(isDropUnlocked(new Date(now + 60_000), now), false);
    assert.equal(isDropUnlocked(new Date(now - 1000), now), true);
  });

  it("treats an unreadable time as open rather than locked forever", () => {
    // A card stuck locked is worse than one that opens early.
    assert.equal(isDropUnlocked("not a date"), true);
    assert.equal(dropSecondsLeft("not a date"), 0);
  });

  it("counts down and stops at zero", () => {
    const now = Date.now();
    assert.equal(dropSecondsLeft(new Date(now + 90_000), now), 90);
    assert.equal(dropSecondsLeft(new Date(now - 90_000), now), 0);
  });
});

describe("who may receive one", () => {
  it("is limited to people who have bought from this seller", () => {
    // A drop to strangers is a broadcast; the point is rewarding past buyers.
    assert.match(SRC, /export async function eligibleDropRecipients/);
    assert.match(SRC, /o\.seller_user_id = \$1 AND o\.status = 'accepted'/);
    assert.match(SRC, /not_past_buyers/);
  });

  it("filters the request against that list rather than trusting it", () => {
    assert.match(SRC, /wanted\.filter\(\(id\) => eligible\.has\(id\)\)/);
  });

  it("caps how many people one drop reaches", () => {
    assert.equal(MAX_DROP_RECIPIENTS, 10);
    assert.match(SRC, /too_many_recipients/);
  });

  it("only lets a seller drop their own item", () => {
    assert.match(SRC, /not_your_item/);
  });

  it("does not lose the drop when one recipient is refused", () => {
    const fn = SRC.slice(SRC.indexOf("for (const buyer of recipients)"));
    assert.match(fn.slice(0, 600), /else sent \+= 1/);
  });
});

describe("the card", () => {
  it("blurs until the window opens", () => {
    assert.match(CSS, /\.inbox-drop-art img \{[\s\S]*filter: blur/);
    assert.match(CSS, /\.inbox-drop\.is-open \.inbox-drop-art img \{[\s\S]*filter: none/);
  });

  it("is honest that the blur is decoration", () => {
    // The image URL is in the payload; pretending otherwise would be a claim
    // anyone could check and disprove.
    assert.match(CSS, /Decoration, not protection/);
  });

  it("uses one timer for every card on screen", () => {
    // An interval per card leaves one running behind each thread reload.
    assert.match(JS, /let dropTimer = null/);
    assert.match(JS, /if \(dropTimer\) clearInterval\(dropTimer\)/);
  });

  it("stops ticking when no drops are left", () => {
    assert.match(JS, /if \(!cards\.length\) \{[\s\S]*clearInterval\(dropTimer\)/);
  });

  it("redraws once when a drop opens", () => {
    assert.match(JS, /if \(anyOpened\) void loadThread\(\)/);
  });
});
