/**
 * Scratch cards and locked drops, from the seller's side.
 *
 * Both were built, routed, and tested, and then had no button. The API
 * accepted them, the thread rendered them, and there was no way on the site to
 * send one -- which is why the inbox looked like it had three features.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const INBOX = src("../../../website/assets/js/inbox.js");
const HTML = src("../../../website/inbox.html");
const CSS = src("../../../website/assets/css/depop-surfaces.css");
const API = src("../routes/socialApi.js");

describe("every card kind can be sent from somewhere", () => {
  const CALLS = [
    ["POST /chat/scratch-card", /fetch\(`\$\{SOCIAL_API\}\/chat\/scratch-card`/],
    ["GET /chat/scratch-card/options", /chat\/scratch-card\/options\?/],
    ["POST /drops", /fetch\(`\$\{SOCIAL_API\}\/drops`/],
    ["GET /drops/recipients", /drops\/recipients\?/],
  ];

  for (const [name, pattern] of CALLS) {
    it(`${name} has a caller`, () => {
      assert.match(INBOX, pattern);
    });
  }

  it("leaves no seller route without one", () => {
    // Anything the server accepts from a seller should be reachable. A route
    // with no caller is a feature nobody can use.
    const sellerRoutes = ["/chat/scratch-card", "/drops"];
    for (const route of sellerRoutes) {
      assert.ok(API.includes(`router.post("${route}"`), `${route} route missing`);
      assert.ok(INBOX.includes(route), `${route} has no caller`);
    }
  });
});

describe("who sees the button", () => {
  it("starts hidden in the markup", () => {
    const btn = HTML.slice(HTML.indexOf('id="chat-seller-tools-btn"'));
    assert.match(btn.slice(0, 200), /class="inbox-seller-tools-btn hidden"/);
  });

  it("shows only for a signed-in seller in a thread", () => {
    const fn = INBOX.slice(INBOX.indexOf("function sellerToolsAvailable"));
    assert.match(fn.slice(0, 400), /state\.sellerAuthRequired/);
    assert.match(fn.slice(0, 400), /sessionToken/);
    const sync = INBOX.slice(INBOX.indexOf("function syncSellerToolsButton"));
    assert.match(sync.slice(0, 400), /Boolean\(state\.peerId\)/);
  });

  it("does not treat hiding it as the control", () => {
    // The server refuses a non-seller with 403 either way. The class is
    // courtesy, so the test records that the route is the real gate.
    const scratch = API.slice(API.indexOf('router.post("/chat/scratch-card"'));
    assert.match(scratch.slice(0, 900), /resolveAuthenticatedSellerSocialContext/);
    const drops = API.slice(API.indexOf('router.post("/drops"'));
    assert.match(drops.slice(0, 900), /resolveAuthenticatedSellerSocialContext/);
  });

  it("cannot be left visible by stylesheet order", () => {
    // .hidden and the component class are both 0-1-0, and Tailwind arrives
    // from a CDN, so whichever loads last would otherwise win.
    assert.match(CSS, /\.inbox-seller-tools-btn:not\(\.hidden\)/);
    assert.match(CSS, /#seller-tools-drawer\.hidden \{\s*display: none/);
  });
});

describe("sending one", () => {
  it("sends the seller session with the request", () => {
    const fn = INBOX.slice(INBOX.indexOf("async function sendScratchCardFromSheet"));
    assert.match(fn.slice(0, 1200), /withAuthBody\(/);
    const drop = INBOX.slice(INBOX.indexOf("async function sendDropFromSheet"));
    assert.match(drop.slice(0, 1200), /withAuthBody\(/);
  });

  it("never sends a drop to nobody", () => {
    const fn = INBOX.slice(INBOX.indexOf("async function sendDropFromSheet"));
    assert.match(fn.slice(0, 700), /if \(!buyerUserIds\.length\)/);
  });

  it("shows the server's own refusal rather than a generic one", () => {
    // "not_past_buyers" and "below_floor" are the useful messages here.
    const fn = INBOX.slice(INBOX.indexOf("async function sendScratchCardFromSheet"));
    assert.match(fn.slice(0, 1400), /data\.message \|\|/);
  });

  it("re-enables the button when a send is refused", () => {
    // Otherwise one rejected attempt ends the session for that seller.
    for (const name of ["sendScratchCardFromSheet", "sendDropFromSheet"]) {
      const fn = INBOX.slice(INBOX.indexOf(`async function ${name}`));
      const body = fn.slice(0, 1600);
      assert.ok(
        (body.match(/btn\.disabled = false/g) || []).length >= 2,
        `${name} leaves the button dead after a failure`
      );
    }
  });

  it("redraws the thread so the card appears without a reload", () => {
    for (const name of ["sendScratchCardFromSheet", "sendDropFromSheet"]) {
      const fn = INBOX.slice(INBOX.indexOf(`async function ${name}`));
      assert.match(fn.slice(0, 1600), /loadThread\(\)/);
    }
  });
});

describe("the sheet itself", () => {
  it("is wired once, not once per thread opened", () => {
    const fn = INBOX.slice(INBOX.indexOf("function wireSellerToolsButton"));
    assert.match(fn.slice(0, 600), /dataset\.wired === "1"/);
  });

  it("says why a list is empty instead of showing nothing", () => {
    const fn = INBOX.slice(INBOX.indexOf("async function renderSellerTools"));
    const body = fn.slice(0, 3500);
    assert.match(body, /bought from you before/);
    assert.match(body, /Open this chat from/);
  });

  it("survives a failed lookup", () => {
    for (const name of ["loadPerkOptions", "loadDropRecipients"]) {
      const fn = INBOX.slice(INBOX.indexOf(`async function ${name}`));
      assert.match(fn.slice(0, 700), /catch \{\s*return \[\];/);
    }
  });
});
