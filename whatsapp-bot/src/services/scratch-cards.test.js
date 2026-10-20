import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { perkOptions } from "./scratch-cards.js";
import { PERK_TYPES, PRICE_FLOOR_KES } from "../lib/scratch-perks.js";
import { BASE_FEE_KES, MAX_FEE_KES } from "../lib/rider-distance-fee.js";

const SRC = readFileSync(new URL("./scratch-cards.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../routes/socialApi.js", import.meta.url), "utf8");

describe("the perks a seller is offered", () => {
  it("shows all three on an ordinary item", () => {
    const opts = perkOptions(1000);
    const types = opts.map((o) => o.type);
    assert.ok(types.includes(PERK_TYPES.FREE_DELIVERY));
    assert.ok(types.includes(PERK_TYPES.PERCENT_OFF));
    assert.ok(types.includes(PERK_TYPES.AMOUNT_OFF));
  });

  it("warns what free delivery costs, with the real rider range", () => {
    const free = perkOptions(1000).find((o) => o.type === PERK_TYPES.FREE_DELIVERY);
    assert.match(free.notice, /escrow payout/i);
    assert.ok(free.notice.includes(BASE_FEE_KES.toLocaleString("en-US")));
    assert.ok(free.notice.includes(MAX_FEE_KES.toLocaleString("en-US")));
  });

  it("drops the money perks on an item too cheap to discount", () => {
    // At the floor there is no room, but free delivery still works.
    const opts = perkOptions(PRICE_FLOOR_KES);
    assert.deepEqual(opts.map((o) => o.type), [PERK_TYPES.FREE_DELIVERY]);
  });

  it("shows what the buyer would end up paying", () => {
    const ten = perkOptions(1000).find((o) => o.type === PERK_TYPES.PERCENT_OFF);
    assert.equal(ten.finalKes, 900);
  });

  it("survives a nonsense price", () => {
    assert.doesNotThrow(() => perkOptions(0));
    assert.doesNotThrow(() => perkOptions(null));
  });
});

describe("only the seller may discount, only their own item", () => {
  it("has no buyer path on the send route", () => {
    const start = API.indexOf('router.post("/chat/scratch-card"');
    // Bound to this route only -- the reveal route below it is buyer-auth by
    // design, and a loose slice would read it and pass for the wrong reason.
    const end = API.indexOf("router.post", start + 10);
    const route = API.slice(start, end);
    assert.match(route, /resolveAuthenticatedSellerSocialContext/);
    assert.doesNotMatch(route, /applyBuyerIdentityAuth/);
  });

  it("refuses an item that is not theirs", () => {
    assert.match(SRC, /not_your_item/);
    assert.match(SRC, /Number\(product\.seller_user_id\) !== seller/);
  });

  it("reads the price from the catalogue, not the request", () => {
    // A seller who could send their own price could make a perk look bigger
    // than it is.
    assert.match(SRC, /SELECT id, title, price_kes, seller_user_id, in_stock, is_sold/);
    assert.match(SRC, /Number\(product\.price_kes\)/);
  });

  it("refuses a sold or delisted item", () => {
    assert.match(SRC, /item_unavailable/);
  });
});

describe("scratching", () => {
  it("can only be done by the buyer it was sent to", () => {
    assert.match(SRC, /not_your_card/);
    assert.match(SRC, /Number\(row\.receiver_user_id\) !== viewer/);
  });

  it("starts the clock on reveal, not on send", () => {
    // A card sent overnight must not already be dead by morning.
    assert.match(SRC, /revealedAt: null/);
    assert.match(SRC, /'\{revealedAt\}'/);
  });

  it("does not restart the clock on a second scratch", () => {
    // Refreshing the page must not extend the buyer's own deadline.
    assert.match(SRC, /if \(payload\.revealedAt\) \{/);
    assert.match(SRC, /alreadyRevealed: true/);
  });

  it("refuses a perk that has run out", () => {
    assert.match(SRC, /perk_expired/);
  });
});

describe("a revealed perk uses the existing rails", () => {
  it("creates an offer at the discounted price", () => {
    // Accepting then goes through offer -> STK -> escrow, which already works.
    assert.match(SRC, /INSERT INTO offers/);
    assert.match(SRC, /payload\.finalKes/);
  });

  it("makes no offer for free delivery, which has no item discount", () => {
    assert.match(SRC, /payload\.perk\?\.type !== PERK_TYPES\.FREE_DELIVERY/);
  });

  it("still reveals the perk if the offer cannot be created", () => {
    const fn = SRC.slice(SRC.indexOf("export async function revealScratchCard"));
    assert.match(fn, /catch \(err\)[\s\S]*offer from perk skipped/);
  });
});
