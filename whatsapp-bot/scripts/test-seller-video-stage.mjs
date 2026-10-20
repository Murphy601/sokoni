#!/usr/bin/env node
/** Smoke checks for seller video staging URL shape (no live auth/network). */
const STAGE_RE = /\/catalog-images\/stage_[a-z0-9_-]+\.mp4(?:$|\?)/i;

function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
}

assert(
  "staging URL matches saveMediaFiles rename rule",
  STAGE_RE.test("https://bot.sokonimall.com/catalog-images/stage_tlom7_m1abc2.mp4")
);
assert(
  "product mp4 is not treated as staging",
  !STAGE_RE.test("https://bot.sokonimall.com/catalog-images/fa-tlom7-003.mp4")
);
assert(
  "cloudinary reel is not treated as staging",
  !STAGE_RE.test("https://res.cloudinary.com/demo/image/upload/f_mp4/sokoni-studio/reel_1.mp4")
);

console.log("OK: seller video staging URL rules");
