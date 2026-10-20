import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SHOP_PINS,
  normalizePins,
  resolvePinSlot,
  isPinnable,
  compactPins,
} from "./shop-pins.js";

describe("normalizePins", () => {
  it("accepts DB snake_case rows", () => {
    const out = normalizePins([{ product_id: "fa-2", pin_rank: 2 }, { product_id: "fa-1", pin_rank: 1 }]);
    assert.deepEqual(out, [
      { productId: "fa-1", rank: 1 },
      { productId: "fa-2", rank: 2 },
    ]);
  });

  it("drops rows outside 1..3 and blanks", () => {
    const out = normalizePins([
      { productId: "ok", rank: 1 },
      { productId: "too-high", rank: 9 },
      { productId: "zero", rank: 0 },
      { productId: "", rank: 2 },
      { productId: "nan", rank: "x" },
    ]);
    assert.deepEqual(out, [{ productId: "ok", rank: 1 }]);
  });

  it("tolerates junk input", () => {
    assert.deepEqual(normalizePins(null), []);
    assert.deepEqual(normalizePins("nope"), []);
  });
});

describe("resolvePinSlot", () => {
  it("takes the first free slot when none requested", () => {
    const r = resolvePinSlot({ currentPins: [{ productId: "a", rank: 1 }], productId: "b" });
    assert.equal(r.ok, true);
    assert.equal(r.rank, 2);
    assert.deepEqual(r.moves, []);
  });

  it("fills a gap left by an unpin", () => {
    const r = resolvePinSlot({
      currentPins: [{ productId: "a", rank: 1 }, { productId: "c", rank: 3 }],
      productId: "b",
    });
    assert.equal(r.rank, 2);
  });

  it("re-pinning an already pinned item is a no-op move, not a new pin", () => {
    const pins = [
      { productId: "a", rank: 1 },
      { productId: "b", rank: 2 },
      { productId: "c", rank: 3 },
    ];
    const r = resolvePinSlot({ currentPins: pins, productId: "b" });
    assert.equal(r.ok, true, "must not hit the limit for something already pinned");
    assert.equal(r.rank, 2);
  });

  it("refuses a fourth pin", () => {
    const pins = [
      { productId: "a", rank: 1 },
      { productId: "b", rank: 2 },
      { productId: "c", rank: 3 },
    ];
    const r = resolvePinSlot({ currentPins: pins, productId: "d" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "pins_full");
    assert.match(r.message, /Unpin one first/);
  });

  it("honours an explicit free slot", () => {
    const r = resolvePinSlot({ currentPins: [{ productId: "a", rank: 1 }], productId: "b", requestedRank: 3 });
    assert.equal(r.rank, 3);
    assert.deepEqual(r.moves, []);
  });

  it("swaps when an explicit slot is taken and the item is already pinned", () => {
    const pins = [
      { productId: "a", rank: 1 },
      { productId: "b", rank: 2 },
    ];
    const r = resolvePinSlot({ currentPins: pins, productId: "b", requestedRank: 1 });
    assert.equal(r.rank, 1);
    assert.deepEqual(r.moves, [{ productId: "a", rank: 2 }], "a takes b's old slot");
  });

  it("evicts to unpinned when an explicit slot is taken by another item", () => {
    const r = resolvePinSlot({
      currentPins: [{ productId: "a", rank: 1 }],
      productId: "new",
      requestedRank: 1,
    });
    assert.equal(r.rank, 1);
    assert.deepEqual(r.moves, [{ productId: "a", rank: 0 }], "rank 0 means unpin");
  });

  it("rejects an out-of-range slot", () => {
    for (const bad of [0, 4, -1, 2.5]) {
      const r = resolvePinSlot({ currentPins: [], productId: "a", requestedRank: bad });
      assert.equal(r.ok, false, `rank ${bad}`);
      assert.equal(r.error, "bad_rank");
    }
  });

  it("rejects a blank product id", () => {
    const r = resolvePinSlot({ currentPins: [], productId: "  " });
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_product");
  });

  it("caps at MAX_SHOP_PINS", () => {
    assert.equal(MAX_SHOP_PINS, 3);
  });
});

describe("isPinnable", () => {
  it("allows a live listing", () => {
    assert.equal(isPinnable({ isSold: false, inStock: true, stockQuantity: 2 }).ok, true);
  });

  it("blocks sold items", () => {
    const r = isPinnable({ isSold: true });
    assert.equal(r.ok, false);
    assert.equal(r.error, "sold");
  });

  it("blocks out-of-stock items", () => {
    assert.equal(isPinnable({ inStock: false }).error, "out_of_stock");
    assert.equal(isPinnable({ stockQuantity: 0 }).error, "out_of_stock");
  });

  it("allows a listing with unknown stock rather than guessing", () => {
    assert.equal(isPinnable({}).ok, true);
  });
});

describe("compactPins", () => {
  it("closes the gap after an unpin", () => {
    const out = compactPins([{ productId: "a", rank: 1 }, { productId: "c", rank: 3 }]);
    assert.deepEqual(out, [
      { productId: "a", rank: 1 },
      { productId: "c", rank: 2 },
    ]);
  });

  it("is stable when already contiguous", () => {
    const pins = [
      { productId: "a", rank: 1 },
      { productId: "b", rank: 2 },
    ];
    assert.deepEqual(compactPins(pins), pins);
  });
});
