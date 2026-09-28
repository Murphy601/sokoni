/**
 * The inbox as it is actually rendered: the stylesheet, the composer markup,
 * and the two client scripts that decide what a buyer sees.
 *
 * These cover live bugs, not hypotheticals. A drawer stuck over the thread and
 * a carousel advertising a shop that has been deleted both shipped, and both
 * looked correct in the source.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const WEB = (rel) => readFileSync(new URL(`../../../website/${rel}`, import.meta.url), "utf8");

const CSS = WEB("assets/css/depop-surfaces.css");
const HTML = WEB("inbox.html");
const INBOX = WEB("assets/js/inbox.js");
const RECENT = WEB("assets/js/recently-viewed.js");

describe("hiding a panel by id", () => {
  it("hides the bundle sheet and the icebreaker row when .hidden is set", () => {
    // An id selector is 1-0-0 and .hidden is 0-1-0, so `#bundle-drawer {
    // display: flex }` beat it and the sheet sat over the thread on the live
    // site. The fix is a rule at equal specificity, not a reorder.
    assert.match(CSS, /#bundle-drawer\.hidden[\s\S]{0,80}?display:\s*none/);
    assert.match(CSS, /#chat-icebreakers\.hidden[\s\S]{0,80}?display:\s*none/);
  });

  it("leaves no other id rule setting display without a .hidden guard", () => {
    // Same trap, any future panel. Every id that gets a display also needs a
    // hidden counterpart, or it comes back.
    const displayed = new Set();
    for (const m of CSS.matchAll(/^#([a-z0-9-]+)\s*\{([^}]*)\}/gim)) {
      if (/display:\s*(flex|block|grid|inline-flex)/.test(m[2])) displayed.add(m[1]);
    }
    const guarded = new Set(
      [...CSS.matchAll(/#([a-z0-9-]+)\.hidden/g)].map((m) => m[1])
    );
    const unguarded = [...displayed].filter((id) => !guarded.has(id));
    assert.deepEqual(unguarded, [], `ids that .hidden cannot hide: ${unguarded.join(", ")}`);
  });
});

describe("the composer fits on a phone", () => {
  it("keeps the action buttons in their own row", () => {
    assert.match(HTML, /<div class="inbox-composer-actions">/);
    for (const id of ["chat-nudge-btn", "chat-sound-btn", "chat-bundle-btn", "chat-mic-btn", "chat-send-btn"]) {
      const at = HTML.indexOf(id);
      const opens = HTML.lastIndexOf('<div class="inbox-composer-actions">', at);
      assert.ok(opens !== -1, `${id} is outside the actions row`);
    }
  });

  it("lets the input shrink instead of being squeezed to nothing", () => {
    // flex-1 without min-width:0 keeps a textarea at its content width, so
    // five buttons pushed it down to about two characters.
    assert.match(CSS, /#chat-input\s*\{[^}]*min-width:\s*0/);
    assert.match(CSS, /#chat-form\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

describe("a shop that has gone", () => {
  it("checks the handle is still live before leaving the thread open", () => {
    assert.match(INBOX, /async function shopStillExists/);
    assert.match(INBOX, /function showShopClosed/);
  });

  it("treats only a definite answer as gone", () => {
    // A failed fetch or an empty payload means the request went wrong. Closing
    // a live conversation because the network blipped is the worse error.
    const fn = INBOX.slice(INBOX.indexOf("async function shopStillExists"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /if \(!res\.ok\) return true;/);
    assert.match(body, /if \(!products\.length\) return true;/);
    assert.match(body, /catch \{\s*return true;/);
  });

  it("stops the poll timer without calling an undeclared name", () => {
    // stopPolling?.() throws ReferenceError on a bare identifier -- optional
    // call only short-circuits on a property access.
    const code = INBOX.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const bare = [...code.matchAll(/(.)([A-Za-z_$][\w$]*)\?\.\(/g)].filter((m) => m[1] !== ".");
    assert.deepEqual(
      bare.map((m) => m[2]),
      [],
      "optional call on a bare identifier throws instead of short-circuiting"
    );
    assert.match(INBOX, /clearInterval\(state\.pollTimer\);\s*state\.pollTimer = null;/);
  });
});

/** Run recently-viewed.js against a fake browser and report what it stored. */
function runRecent({ stored, fetchImpl }) {
  const store = new Map([["sokoni-recently-viewed", JSON.stringify(stored)]]);
  const node = { innerHTML: "", querySelectorAll: () => [] };
  const win = {
    SOKONI_API_BASE: "",
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    document: { getElementById: () => node },
    fetch: fetchImpl,
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(RECENT, win);
  return {
    api: win.SokoniRecentlyViewed,
    node,
    kept: () => JSON.parse(store.get("sokoni-recently-viewed")),
  };
}

const twoItems = [
  { id: "p1", name: "Cargo pants", shopHandle: "adivs" },
  { id: "p2", name: "Denim jacket", shopHandle: "live-shop" },
];
const jsonRes = (body) => ({ ok: true, json: async () => body });

describe("recently viewed forgets deleted items", () => {
  it("drops what is no longer in the catalogue", async () => {
    const r = runRecent({
      stored: twoItems,
      fetchImpl: async () => jsonRes({ products: [{ id: "p2", inStock: true }] }),
    });
    r.api.renderCarousel(r.node);
    await tick();
    assert.deepEqual(r.kept().map((x) => x.id), ["p2"]);
  });

  it("drops a sold item too", async () => {
    const r = runRecent({
      stored: twoItems,
      fetchImpl: async () =>
        jsonRes({ products: [{ id: "p1", isSold: true }, { id: "p2", inStock: true }] }),
    });
    r.api.renderCarousel(r.node);
    await tick();
    assert.deepEqual(r.kept().map((x) => x.id), ["p2"]);
  });

  it("keeps everything when the catalogue call fails", async () => {
    const r = runRecent({ stored: twoItems, fetchImpl: async () => ({ ok: false }) });
    r.api.renderCarousel(r.node);
    await tick();
    assert.equal(r.kept().length, 2);
  });

  it("keeps everything when the catalogue comes back empty", async () => {
    // An empty list is what a half-broken API returns. Wiping a buyer's
    // history on it would be unrecoverable.
    const r = runRecent({ stored: twoItems, fetchImpl: async () => jsonRes({ products: [] }) });
    r.api.renderCarousel(r.node);
    await tick();
    assert.equal(r.kept().length, 2);
  });

  it("keeps everything when fetch throws", async () => {
    const r = runRecent({
      stored: twoItems,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    r.api.renderCarousel(r.node);
    await tick();
    assert.equal(r.kept().length, 2);
  });

  it("redraws once and only once after pruning", async () => {
    let calls = 0;
    const r = runRecent({
      stored: twoItems,
      fetchImpl: async () => {
        calls += 1;
        return jsonRes({ products: [{ id: "p2", inStock: true }] });
      },
    });
    r.api.renderCarousel(r.node);
    await tick();
    // The redraw passes skipPrune, so the catalogue is hit once per render.
    assert.equal(calls, 1);
    assert.ok(r.node.innerHTML.includes("Denim jacket"));
    assert.ok(!r.node.innerHTML.includes("Cargo pants"));
  });
});

/** Let the prune promise and its redraw settle. */
async function tick() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((res) => setImmediate(res));
}
