import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestBundlePrice, apportionBundlePrice } from "../lib/bundle-pricing.js";

const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../website/inbox.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url), "utf8");

describe("the drawer", () => {
  it("only offers items from the shop being talked to", () => {
    // A bundle across two shops creates lines nobody in the thread can
    // dispatch, and the server refuses it anyway.
    assert.match(JS, /normalizeHandle\(p\.shopHandle \|\| ""\) === want/);
  });

  it("leaves out anything sold or out of stock", () => {
    assert.match(JS, /p\.inStock !== false && !p\.isSold/);
  });

  it("holds the same item cap as the server", () => {
    assert.match(JS, /MAX_BUNDLE_ITEMS = 8/);
  });

  it("will not send fewer than two items", () => {
    assert.match(JS, /productIds\.length < 2/);
    assert.match(JS, /tooFew \? "disabled" : ""/);
  });

  it("rebuilds through one delegated listener", () => {
    // The grid is redrawn on every pick; per-tile handlers would pile up.
    assert.match(JS, /drawer\.addEventListener\("click"/);
    assert.match(JS, /closest\("\[data-bundle-pick\]"\)/);
  });
});

describe("the suggested price matches the server", () => {
  it("agrees with suggestBundlePrice for ordinary baskets", () => {
    // The client suggests, the server splits. If they disagree the buyer sees
    // a number the server then refuses.
    const sets = [
      [1200, 1000],
      [1200, 1000, 800],
      [450, 99, 2000],
      [50, 50, 50],
    ];
    for (const prices of sets) {
      const lines = prices.map((p, i) => ({ id: `p${i}`, priceKes: p }));
      const listTotal = prices.reduce((s, p) => s + p, 0);
      const clientSide = Math.max(lines.length, Math.floor((listTotal * 0.9) / 50) * 50);
      assert.equal(clientSide, suggestBundlePrice(lines), prices.join("+"));
    }
  });

  it("suggests something the splitter accepts", () => {
    for (const prices of [[1200, 1000, 800], [450, 99], [5000, 3]]) {
      const lines = prices.map((p, i) => ({ id: `p${i}`, priceKes: p }));
      assert.equal(apportionBundlePrice(lines, suggestBundlePrice(lines)).ok, true, prices.join("+"));
    }
  });
});

describe("the card in the thread", () => {
  it("renders bundles instead of a text bubble", () => {
    assert.match(JS, /if \(msg\.kind === "bundle"\) return bundleCard\(msg\)/);
  });

  it("hides the buttons from whoever moved last", () => {
    // Showing buttons the server would refuse is worse than showing none.
    assert.match(JS, /const myTurn = !closed && !iMovedLast/);
  });

  it("shows nothing to act on once the bundle is closed", () => {
    assert.match(JS, /\["accepted", "declined", "expired"\]\.includes\(p\.status\)/);
  });

  it("caps the photo grid and counts the rest", () => {
    assert.ok(JS.includes(".slice(0, 4)"), "photo grid is not capped");
    assert.match(JS, /inbox-bundle-more/);
  });

  it("escapes titles and ids it renders", () => {
    assert.match(JS, /escapeHtml\(i\.title \|\| "Item"\)/);
    assert.match(JS, /escapeHtml\(String\(p\.bundleId \|\| ""\)\)/);
  });
});

describe("markup and styles", () => {
  it("has the button and the drawer", () => {
    assert.ok(HTML.includes('id="chat-bundle-btn"'));
    assert.ok(HTML.includes('id="bundle-drawer"'));
    assert.match(HTML, /id="bundle-drawer"[^>]*class="hidden"/);
  });

  it("is a sheet, so the thread stays visible behind it", () => {
    assert.match(CSS, /#bundle-drawer \{[\s\S]*position: absolute/);
    assert.match(CSS, /\.bundle-sheet \{[\s\S]*max-height: 70vh/);
  });

  it("clamps long titles so one tile cannot break the grid", () => {
    assert.match(CSS, /\.bundle-tile-name \{[\s\S]*-webkit-line-clamp: 2/);
  });

  it("marks the picked state for screen readers too", () => {
    assert.match(JS, /aria-pressed="\$\{bundlePicked\.has\(p\.id\) \? "true" : "false"\}"/);
  });
});
