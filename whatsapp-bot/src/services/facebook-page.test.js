import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mediaKindFromUrl, facebookPageConfigured } from "./facebook-page.js";

describe("facebook-page", () => {
  it("detects video vs image URLs", () => {
    assert.equal(mediaKindFromUrl("https://res.cloudinary.com/x/video/upload/v1/a.mp4"), "video");
    assert.equal(mediaKindFromUrl("https://res.cloudinary.com/x/image/upload/v1/a.jpg"), "image");
  });

  it("is unconfigured without env (dry-run path)", () => {
    assert.equal(facebookPageConfigured(), false);
  });
});
