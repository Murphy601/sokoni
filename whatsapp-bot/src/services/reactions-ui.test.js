import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALLOWED_REACTIONS } from "../db/repositories/social.js";

const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../../../website/inbox.html", import.meta.url), "utf8");

describe("the emoji set", () => {
  it("matches the server exactly", () => {
    // A client offering an emoji the server refuses is a tap that silently
    // does nothing.
    const listed = JS.slice(JS.indexOf("const REACTIONS = ["), JS.indexOf("const REACTIONS = [") + 200);
    for (const e of ALLOWED_REACTIONS) {
      assert.ok(listed.includes(e), `client is missing ${e}`);
    }
  });

  it("has a tone for every one of them", () => {
    const tones = JS.slice(JS.indexOf("const REACTION_TONES"), JS.indexOf("let audioCtx"));
    for (const e of ALLOWED_REACTIONS) {
      assert.ok(tones.includes(e), `no tone for ${e}`);
    }
  });
});

describe("double tap, not single", () => {
  it("counts two taps inside 300ms by hand", () => {
    // dblclick does not fire reliably on touch, which is most of the traffic.
    assert.match(JS, /now - lastTap < 300/);
    assert.match(JS, /wrap\.addEventListener\("dblclick"/);
  });

  it("does not open the picker on a first tap", () => {
    assert.match(JS, /lastTap = now;\s*\n\s*lastTarget = bubble;/);
  });

  it("closes the picker when the tap lands outside a bubble", () => {
    assert.match(JS, /if \(!bubble\) closeReactionPicker\(\)/);
  });

  it("uses one delegated listener on the thread", () => {
    assert.match(JS, /wrap\.dataset\.reactWired === "1"/);
  });
});

describe("the sound", () => {
  it("is generated, not downloaded", () => {
    // A soundboard of files would be the heaviest thing on the page for half
    // a second of noise.
    assert.match(JS, /createOscillator/);
    assert.doesNotMatch(JS, /new Audio\(|\.mp3|\.ogg"/);
  });

  it("can be turned off, and the choice sticks", () => {
    assert.ok(HTML.includes('id="chat-sound-btn"'));
    assert.match(JS, /localStorage\.setItem\("sokoni:inbox:sound"/);
  });

  it("survives blocked storage rather than failing the tap", () => {
    // Private windows throw on localStorage.
    const fn = JS.slice(JS.indexOf("function readSoundPref"));
    assert.match(fn.slice(0, 600), /catch \{/);
  });

  it("never lets audio break a reaction", () => {
    const fn = JS.slice(JS.indexOf("function playReactionTone"));
    assert.match(fn.slice(0, 1600), /catch \{/);
  });

  it("fades each note, because a square edge clicks on a phone speaker", () => {
    assert.match(JS, /exponentialRampToValueAtTime/);
  });
});

describe("the chips", () => {
  it("marks the viewer's own reaction", () => {
    assert.match(JS, /\(r\.userIds \|\| \[\]\)\.includes\(state\.viewerId\)/);
    assert.match(CSS, /\.inbox-react\.is-mine/);
  });

  it("is a toggle, not an add", () => {
    // A second tap of the same emoji removes it, which is what the server does.
    assert.match(JS, /async function toggleReaction/);
  });

  it("escapes the emoji and ids it renders", () => {
    assert.match(JS, /escapeHtml\(r\.emoji\)/);
    assert.match(JS, /escapeHtml\(String\(msg\.id\)\)/);
  });

  it("anchors the picker to its bubble", () => {
    // Absolute against the thread would drift as the conversation scrolls.
    assert.match(CSS, /\[data-msg-id\] \{\s*\n\s*position: relative/);
    assert.match(CSS, /\.inbox-react-picker \{[\s\S]*position: absolute/);
  });
});
