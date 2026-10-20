import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url), "utf8");

describe("the foil cannot open by accident", () => {
  it("needs a real rub, not one touch", () => {
    // The first version computed the threshold from a box that had not been
    // laid out yet, got zero, and opened on the first pointerdown.
    assert.match(JS, /const threshold = Math\.max\(12, Math\.round\(\(w \* h\) \/ 2600\)\)/);
    assert.match(JS, /if \(cleared > threshold\)/);
  });

  it("waits for layout before measuring, but not forever", () => {
    // Retrying without a bound meant a zero-width card never armed at all,
    // which is worse than arming with an estimate.
    assert.match(JS, /if \(rect\.width < 8 && attempt < 3\)/);
    assert.match(JS, /armScratchFoil\(foil, attempt \+ 1\)/);
  });

  it("falls back to a usable width rather than a 1px canvas", () => {
    assert.match(JS, /rect\.width \|\| card\.getBoundingClientRect\(\)\.width \|\| 240/);
  });

  it("only ever reveals once", () => {
    assert.match(JS, /if \(!rubbing \|\| done\) return/);
    assert.match(JS, /done = true/);
  });
});

describe("the pixels are the gesture, not the grant", () => {
  it("asks the server to reveal", () => {
    // Clearing a canvas must never be what grants a discount.
    assert.match(JS, /chat\/scratch-card\/\$\{encodeURIComponent\(messageId\)\}\/reveal/);
    assert.match(JS, /method: "POST"/);
  });

  it("reloads the thread so the card redraws from stored state", () => {
    const fn = JS.slice(JS.indexOf("async function revealScratch"));
    assert.match(fn.slice(0, 1400), /await loadThread\(\)/);
  });

  it("tells the buyer how long they have", () => {
    assert.match(JS, /minutesLeft/);
  });

  it("still works where canvas is unavailable", () => {
    // A buyer on an old browser must still be able to reach the perk.
    assert.match(JS, /if \(!ctx\) \{/);
    assert.match(JS, /\{ once: true \}/);
  });
});

describe("what each side sees", () => {
  it("shows the seller what they sent, with no foil", () => {
    assert.match(JS, /class="inbox-scratch is-sent"/);
    assert.match(JS, /not scratched yet/);
  });

  it("shows a revealed card as unlocked", () => {
    assert.match(JS, /class="inbox-scratch is-revealed"/);
    assert.match(JS, /You unlocked/);
  });

  it("escapes the perk label and title", () => {
    assert.match(JS, /escapeHtml\(perk\.label \|\| "Perk"\)/);
    assert.match(JS, /escapeHtml\(p\.productTitle \|\| ""\)/);
  });
});

describe("styles", () => {
  it("stops a rub scrolling the thread", () => {
    assert.match(CSS, /\.inbox-scratch-canvas \{[\s\S]*touch-action: none/);
  });

  it("covers the perk exactly", () => {
    assert.match(CSS, /\.inbox-scratch-foil \{[\s\S]*position: relative/);
    assert.match(CSS, /\.inbox-scratch-canvas \{[\s\S]*position: absolute/);
  });
});
