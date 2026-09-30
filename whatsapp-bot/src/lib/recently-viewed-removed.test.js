/**
 * "Recently viewed" is gone.
 *
 * It was asked for twice. The first time I read it as "stop showing deleted
 * products" and built pruning instead of removing the strip, which is not
 * what was asked for.
 *
 * This keeps it gone: the module, the markup, the script tags, the recorder
 * and the styles. A leftover script tag or a stray record() call would put
 * the data back without the strip ever reappearing to show it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "website");
const read = (rel) => readFileSync(path.join(WEB_DIR, rel), "utf8");

const pages = readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"));
const scripts = readdirSync(path.join(WEB_DIR, "assets", "js")).filter((f) => f.endsWith(".js"));

describe("the feature is removed, not just hidden", () => {
  it("deletes the module", () => {
    assert.equal(existsSync(path.join(WEB_DIR, "assets", "js", "recently-viewed.js")), false);
  });

  it("leaves no page loading it", () => {
    for (const page of pages) {
      assert.doesNotMatch(read(page), /recently-viewed\.js/, `${page} still loads it`);
    }
  });

  it("leaves no mount point in the markup", () => {
    for (const page of pages) {
      const html = read(page);
      assert.doesNotMatch(html, /id="inbox-recently-viewed"/, `${page} still has the strip`);
      assert.doesNotMatch(html, /aria-label="Recently viewed"/, `${page} still has the section`);
    }
  });

  it("stops recording what people look at", () => {
    // The recorder lived in product-sheet.js and wrote on every product view.
    // Left in, it would keep filling a store nothing reads.
    for (const file of scripts) {
      const src = read(path.join("assets", "js", file));
      assert.doesNotMatch(src, /SokoniRecentlyViewed/, `${file} still calls into it`);
    }
  });

  it("drops the styles with it", () => {
    assert.doesNotMatch(read(path.join("assets", "css", "depop-surfaces.css")), /inbox-recent-/);
  });
});

describe("the data it left behind", () => {
  it("is cleared from the browsers that already have it", () => {
    // Deleting the feature does not delete what it stored on each visitor's
    // device. Without this, a list of products nothing will ever read sits in
    // localStorage forever.
    const inbox = read(path.join("assets", "js", "inbox.js"));
    assert.match(inbox, /function forgetRecentlyViewed/);
    assert.match(inbox, /localStorage\.removeItem\("sokoni-recently-viewed"\)/);
    assert.match(inbox, /forgetRecentlyViewed\(\);/);
  });

  it("does not break where storage is blocked", () => {
    const inbox = read(path.join("assets", "js", "inbox.js"));
    const fn = inbox.slice(inbox.indexOf("function forgetRecentlyViewed"));
    assert.match(fn.slice(0, 400), /try \{/);
    assert.match(fn.slice(0, 400), /catch \{/);
  });
});
