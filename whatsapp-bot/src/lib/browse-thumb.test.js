import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = readFileSync(path.join(ROOT, "website", "assets/js/browse-thumb.js"), "utf8");
const INDEX = readFileSync(path.join(ROOT, "website", "index.html"), "utf8");
const HEADERS = readFileSync(path.join(ROOT, "website", "_headers"), "utf8");
const SERVER = readFileSync(path.join(ROOT, "whatsapp-bot", "src", "server.js"), "utf8");
const MEGA = readFileSync(path.join(ROOT, "website", "assets/js/mega-menu.js"), "utf8");
const CATALOG_NAV = readFileSync(path.join(ROOT, "website", "assets/js/catalog-nav.js"), "utf8");
const TRADE = readFileSync(path.join(ROOT, "website", "assets/js/depop-trade-across.js"), "utf8");
const APP = readFileSync(path.join(ROOT, "website", "assets/js/app.js"), "utf8");

function loadThumb() {
  const sandbox = {
    window: {},
    URL,
    URLSearchParams,
    Number,
    Math,
  };
  sandbox.globalThis = sandbox.window;
  vm.runInNewContext(SRC, sandbox);
  return sandbox.window.SokoniBrowseThumb;
}

describe("browse category thumbnail URLs", () => {
  it("inserts f_auto,q_auto,w_150 on Cloudinary upload URLs", () => {
    const { thumbUrl } = loadThumb();
    const out = thumbUrl("https://res.cloudinary.com/demo/image/upload/v1/sokoni-studio/cutout.jpg");
    assert.match(out, /\/upload\/f_auto,q_auto,w_150\//);
    assert.match(out, /sokoni-studio\/cutout\.jpg/);
  });

  it("does not double-insert Cloudinary transforms", () => {
    const { thumbUrl } = loadThumb();
    const once = thumbUrl("https://res.cloudinary.com/demo/image/upload/sample.jpg");
    const twice = thumbUrl(once);
    assert.equal(twice, once);
  });

  it("scales Unsplash category photos to 150px with auto format", () => {
    const { thumbUrl } = loadThumb();
    const out = thumbUrl(
      "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=600&h=600&q=80&sig=1"
    );
    const u = new URL(out);
    assert.equal(u.searchParams.get("w"), "150");
    assert.equal(u.searchParams.get("h"), "150");
    assert.match(u.searchParams.get("auto") || "", /format/);
  });

  it("leaves relative and non-CDN URLs alone", () => {
    const { thumbUrl } = loadThumb();
    assert.equal(thumbUrl("assets/images/logo-og.png"), "assets/images/logo-og.png");
    assert.equal(thumbUrl(""), "");
  });
});

describe("category grids request thumbs and lazy-decode", () => {
  it("homepage preconnects Cloudinary and Unsplash", () => {
    assert.match(INDEX, /rel="preconnect" href="https:\/\/res\.cloudinary\.com"/);
    assert.match(INDEX, /rel="preconnect" href="https:\/\/images\.unsplash\.com"/);
    assert.match(INDEX, /src="assets\/js\/browse-thumb\.js"/);
  });

  it("category img tags set loading=lazy and decoding=async", () => {
    assert.match(MEGA, /loading="lazy"/);
    assert.match(MEGA, /decoding="async"/);
    assert.match(CATALOG_NAV, /loading="lazy"/);
    assert.match(CATALOG_NAV, /decoding="async"/);
    assert.match(TRADE, /loading="lazy"/);
    assert.match(TRADE, /decoding="async"/);
    assert.match(APP, /decoding="async"/);
    assert.match(MEGA, /SokoniBrowseThumb/);
    assert.match(CATALOG_NAV, /SokoniBrowseThumb/);
    assert.match(TRADE, /SokoniBrowseThumb/);
  });

  it("sets long-term Cache-Control on static images and browse JSON", () => {
    assert.match(HEADERS, /\/assets\/images\/\*/);
    assert.match(HEADERS, /max-age=31536000/);
    assert.match(HEADERS, /\/data\/\*/);
    assert.match(HEADERS, /s-maxage=86400/);
    assert.match(SERVER, /Cache-Control", "public, max-age=604800"/);
  });
});
