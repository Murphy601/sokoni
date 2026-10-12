import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { categoryTreeCacheControl, invalidateCategoryCache } from "./category-tree.js";

describe("category tree cache", () => {
  it("sends browser and CDN cache headers", () => {
    const header = categoryTreeCacheControl();
    assert.match(header, /max-age=1800/);
    assert.match(header, /s-maxage=3600/);
    assert.match(header, /stale-while-revalidate/);
  });

  it("clears the in-memory tree", () => {
    invalidateCategoryCache();
  });
});
