import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../website/inbox.html", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url), "utf8");

describe("icebreaker chips", () => {
  it("offers the questions thrift buyers actually ask", () => {
    for (const q of ["negotiable", "flaws", "dispatch", "photos"]) {
      assert.match(JS, new RegExp(q, "i"), `no opener about ${q}`);
    }
  });

  it("only appears on a genuinely empty thread", () => {
    // Once two people are talking, a row of canned questions is clutter.
    const fn = JS.slice(JS.indexOf("function renderIcebreakers"));
    assert.match(fn.slice(0, 900), /messages\.length === 0/);
    assert.match(fn.slice(0, 900), /slot\.classList\.add\("hidden"\)/);
  });

  it("needs both sides of the thread before showing anything", () => {
    const fn = JS.slice(JS.indexOf("function renderIcebreakers"));
    assert.match(fn.slice(0, 900), /!state\.viewerId \|\| !state\.peerId/);
  });

  it("escapes the text it renders", () => {
    const fn = JS.slice(JS.indexOf("function renderIcebreakers"));
    assert.match(fn.slice(0, 1400), /escapeHtml\(q\)/);
  });
});

describe("tapping a chip", () => {
  it("uses one delegated listener, not one per chip", () => {
    // The row is re-rendered on every thread load; per-chip handlers would
    // pile up behind it.
    const fn = JS.slice(JS.indexOf("function wireIcebreakers"));
    assert.match(fn.slice(0, 900), /slot\.addEventListener\("click"/);
    assert.match(fn.slice(0, 900), /closest\("\[data-chip\]"\)/);
  });

  it("wires itself only once", () => {
    const fn = JS.slice(JS.indexOf("function wireIcebreakers"));
    assert.match(fn.slice(0, 400), /dataset\.wired === "1"/);
  });

  it("hides the row before sending, so it cannot double send", () => {
    const fn = JS.slice(JS.indexOf("function wireIcebreakers"));
    const body = fn.slice(0, 1200);
    assert.ok(body.indexOf('slot.classList.add("hidden")') < body.indexOf("requestSubmit"));
  });

  it("submits the real form, so it goes through the same path as typing", () => {
    // Not a separate send: moderation, auth and the WhatsApp ping all hang
    // off the form submit.
    const fn = JS.slice(JS.indexOf("function wireIcebreakers"));
    assert.match(fn.slice(0, 1200), /requestSubmit/);
  });
});

describe("the markup and styles", () => {
  it("has a slot above the composer", () => {
    const chips = HTML.indexOf('id="chat-icebreakers"');
    const form = HTML.indexOf('id="chat-form"');
    assert.ok(chips !== -1 && form !== -1);
    assert.ok(chips < form, "chips render below the composer");
  });

  it("starts hidden, so nothing flashes before the thread loads", () => {
    const tag = HTML.slice(HTML.indexOf('id="chat-icebreakers"') - 40, HTML.indexOf('id="chat-icebreakers"') + 90);
    assert.match(tag, /class="hidden"/);
  });

  it("scrolls sideways on a phone without showing a scrollbar", () => {
    assert.match(CSS, /#chat-icebreakers \{[\s\S]*overflow-x: auto/);
    assert.match(CSS, /#chat-icebreakers::-webkit-scrollbar/);
  });

  it("is reachable by keyboard", () => {
    assert.match(CSS, /\.inbox-chip:hover,\s*\n\.inbox-chip:focus-visible/);
  });
});
