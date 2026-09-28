import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  apportionBundlePrice,
  bundleListTotal,
  suggestBundlePrice,
  MIN_LINE_KES,
} from "./bundle-pricing.js";

const lines = (...prices) => prices.map((p, i) => ({ id: `p${i + 1}`, priceKes: p }));

describe("the split always sums to what was agreed", () => {
  it("handles the everyday case", () => {
    const r = apportionBundlePrice(lines(1200, 1000, 800), 2600);
    assert.equal(r.ok, true, r.message);
    assert.equal(r.totalKes, 2600);
    assert.equal(r.lines.reduce((s, l) => s + l.priceKes, 0), 2600);
  });

  it("sums exactly across prices that do not divide cleanly", () => {
    // Thirds of an odd number are where naive rounding loses a shilling.
    for (const total of [1000, 999, 1001, 777, 1, 2, 3]) {
      const r = apportionBundlePrice(lines(333, 333, 334), Math.max(3, total));
      if (!r.ok) continue;
      assert.equal(
        r.lines.reduce((s, l) => s + l.priceKes, 0),
        r.totalKes,
        `lost money at ${total}`
      );
    }
  });

  it("sums exactly over a wide sweep", () => {
    const set = lines(1200, 1000, 800, 450, 99);
    for (let agreed = 5; agreed <= 3549; agreed += 7) {
      const r = apportionBundlePrice(set, agreed);
      if (!r.ok) continue;
      const sum = r.lines.reduce((s, l) => s + l.priceKes, 0);
      assert.equal(sum, agreed, `sum ${sum} != agreed ${agreed}`);
    }
  });

  it("gives no line away for free, however steep the discount", () => {
    const r = apportionBundlePrice(lines(5000, 5000, 10), 20);
    assert.equal(r.ok, true, r.message);
    for (const l of r.lines) {
      assert.ok(l.priceKes >= MIN_LINE_KES, `a line came out at ${l.priceKes}`);
    }
    assert.equal(r.lines.reduce((s, l) => s + l.priceKes, 0), 20);
  });

  it("splits in proportion to what each item is worth", () => {
    const r = apportionBundlePrice(lines(2000, 1000), 1500);
    assert.equal(r.ok, true);
    // The dearer item carries roughly twice the value and twice the discount.
    assert.equal(r.lines[0].priceKes, 1000);
    assert.equal(r.lines[1].priceKes, 500);
  });

  it("reports what the bundle saves", () => {
    const r = apportionBundlePrice(lines(1200, 1000), 2000);
    assert.equal(r.discountKes, 200);
  });
});

describe("prices it refuses", () => {
  it("refuses a bundle of one", () => {
    const r = apportionBundlePrice(lines(1000), 900);
    assert.equal(r.ok, false);
    assert.equal(r.error, "bundle_too_small");
  });

  it("refuses more than buying separately", () => {
    // Not an offer, a mistake. Better to say so than to charge it.
    const r = apportionBundlePrice(lines(1000, 500), 1600);
    assert.equal(r.ok, false);
    assert.equal(r.error, "above_list");
    assert.match(r.message, /1,500/);
  });

  it("refuses a total too small to give every line a shilling", () => {
    const r = apportionBundlePrice(lines(100, 100, 100), 2);
    assert.equal(r.ok, false);
    assert.equal(r.error, "below_floor");
  });

  it("refuses zero, negative and nonsense", () => {
    for (const bad of [0, -100, NaN, null, undefined, "free"]) {
      assert.equal(apportionBundlePrice(lines(500, 500), bad).ok, false, String(bad));
    }
  });

  it("refuses an item with no price", () => {
    assert.equal(apportionBundlePrice([{ id: "a", priceKes: 0 }, { id: "b", priceKes: 100 }], 50).ok, false);
  });

  it("refuses rubbish input rather than throwing", () => {
    for (const bad of [null, undefined, [], "x", 5]) {
      assert.doesNotThrow(() => apportionBundlePrice(bad, 100));
      assert.equal(apportionBundlePrice(bad, 100).ok, false);
    }
  });
});

describe("what the buyer is shown", () => {
  it("totals the list prices", () => {
    assert.equal(bundleListTotal(lines(1200, 1000, 800)), 3000);
    assert.equal(bundleListTotal([]), 0);
    assert.equal(bundleListTotal(null), 0);
  });

  it("suggests a round opening price, not a calculation", () => {
    // 10% off 3,000 is 2,700; people say 2,700, not 2,699.37.
    assert.equal(suggestBundlePrice(lines(1200, 1000, 800)), 2700);
    assert.equal(suggestBundlePrice(lines(1999, 1)) % 50, 0);
  });

  it("never suggests a price the splitter would then refuse", () => {
    for (const set of [lines(100, 100), lines(50, 50, 50), lines(10, 10, 10, 10), lines(5000, 3)]) {
      const s = suggestBundlePrice(set);
      const r = apportionBundlePrice(set, s);
      assert.equal(r.ok, true, `suggested ${s} but split failed: ${r.message}`);
    }
  });

  it("suggests nothing for an empty bundle", () => {
    assert.equal(suggestBundlePrice([]), 0);
  });
});
