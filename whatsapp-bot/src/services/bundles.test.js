import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bundleText } from "./bundle-cards.js";
import { MAX_BUNDLE_ITEMS, BUNDLE_TTL_HOURS } from "../db/repositories/bundles.js";

const REPO = readFileSync(new URL("../db/repositories/bundles.js", import.meta.url), "utf8");
const SCHEMA = readFileSync(new URL("../../db/schema-phase38-bundles.sql", import.meta.url), "utf8");
const CARDS = readFileSync(new URL("./bundle-cards.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../routes/socialApi.js", import.meta.url), "utf8");

const bundle = (over = {}) => ({
  id: 1,
  items: [{ productId: "a" }, { productId: "b" }],
  amountKes: 2600,
  listTotalKes: 3000,
  savingKes: 400,
  status: "pending",
  lastActor: "buyer",
  ...over,
});

describe("what the card says", () => {
  it("leads with the count, the price and the saving", () => {
    const t = bundleText(bundle());
    assert.match(t, /Bundle of 2 items/);
    assert.match(t, /KES 2,600/);
    assert.match(t, /saves KES 400/);
  });

  it("says where the negotiation stands", () => {
    assert.match(bundleText(bundle({ status: "accepted" })), /accepted/);
    assert.match(bundleText(bundle({ status: "declined" })), /declined/);
    assert.match(bundleText(bundle({ status: "expired" })), /expired/);
    assert.match(bundleText(bundle({ status: "countered" })), /^Counter:/);
  });

  it("does not claim a saving when there is none", () => {
    assert.doesNotMatch(bundleText(bundle({ savingKes: 0 })), /saves/);
  });

  it("survives a half-built bundle", () => {
    assert.doesNotThrow(() => bundleText({}));
    assert.doesNotThrow(() => bundleText(null));
  });
});

describe("prices come from the catalogue, never the request", () => {
  it("reads list prices out of products", () => {
    // A buyer who could send their own list prices could set the saving to
    // anything and the seller would see a total that was never true.
    assert.match(REPO, /SELECT id, title, price_kes, seller_user_id, in_stock, is_sold/);
    assert.match(REPO, /Number\(p\.price_kes\)/);
  });

  it("freezes the list total on the row", () => {
    // A seller repricing later must not silently change what was agreed.
    assert.match(SCHEMA, /list_total_kes\s+NUMERIC/);
    assert.match(SCHEMA, /list_kes\s+NUMERIC/);
  });
});

describe("what a bundle refuses", () => {
  it("refuses items from more than one shop", () => {
    // Otherwise it would create lines nobody in the conversation can dispatch.
    assert.match(REPO, /mixed_sellers/);
  });

  it("refuses sold or delisted items", () => {
    assert.match(REPO, /item_unavailable/);
    assert.match(REPO, /is_sold \|\| p\.in_stock === false/);
  });

  it("refuses bundling with yourself", () => {
    assert.match(REPO, /You can't bundle with yourself/);
    assert.match(SCHEMA, /bundles_two_parties CHECK \(buyer_user_id <> seller_user_id\)/);
  });

  it("caps how many items one bundle holds", () => {
    assert.equal(MAX_BUNDLE_ITEMS, 8);
    assert.match(REPO, /bundle_too_large/);
  });

  it("refuses a price above list, in the database as well", () => {
    assert.match(SCHEMA, /bundles_not_above_list CHECK \(amount_kes <= list_total_kes\)/);
  });
});

describe("one negotiation at a time", () => {
  it("is enforced by a partial unique index", () => {
    assert.match(SCHEMA, /idx_bundles_one_pending/);
    assert.match(SCHEMA, /WHERE status IN \('pending', 'countered'\)/);
  });

  it("supersedes the old one rather than rejecting the new basket", () => {
    // The buyer's newest basket is the one they mean.
    assert.match(REPO, /SET status = 'expired'[\s\S]*status IN \('pending', 'countered'\)/);
  });
});

describe("nobody accepts their own price", () => {
  it("blocks the side that moved last", () => {
    assert.match(REPO, /row\.last_actor === side && action !== "declined"/);
    assert.match(REPO, /not_your_turn/);
  });

  it("locks the row, so two taps of accept cannot both win", () => {
    assert.match(REPO, /SELECT \* FROM bundles WHERE id = \$1 FOR UPDATE/);
  });

  it("expires a stale proposal on read rather than honouring it", () => {
    assert.match(REPO, /bundle_expired/);
    assert.equal(BUNDLE_TTL_HOURS, 48);
  });
});

describe("the chat card", () => {
  it("is updated in place, not appended per move", () => {
    // Four cards at four prices is the confusion the ledger exists to avoid.
    assert.match(CARDS, /UPDATE messages SET payload = \$2::jsonb/);
    assert.match(CARDS, /ORDER BY id DESC LIMIT 1/);
  });

  it("cannot fail the API call that created the bundle", () => {
    assert.match(API, /void postBundleCard\(/);
    assert.match(CARDS, /catch \(err\)[\s\S]*return null/);
  });
});

describe("checkout reuses the ordinary cart path", () => {
  it("derives the split at checkout rather than storing a second copy", () => {
    assert.match(REPO, /export async function bundleCartLines/);
    assert.match(REPO, /bundle_not_accepted/);
  });
});
