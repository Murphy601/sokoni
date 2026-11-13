import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { instagramPublishingConfigured, instagramDropEnabled } from "./instagram-page.js";

describe("instagram-page", () => {
  it("is unconfigured without Meta page token", () => {
    assert.equal(instagramPublishingConfigured(), false);
    assert.equal(instagramDropEnabled(), false);
  });
});
