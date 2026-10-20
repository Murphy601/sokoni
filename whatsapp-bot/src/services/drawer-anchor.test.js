/**
 * The in-panel sheets have something to anchor to.
 *
 * #bundle-drawer and #seller-tools-drawer are position:absolute with
 * `inset: auto 0 0 0`. If no ancestor is positioned they resolve against the
 * page instead of the chat panel and open hundreds of pixels further down,
 * past the fold. Measured before the fix: the bundle sheet landed at y=1635
 * while the panel ended at y=985, so tapping the button looked like it did
 * nothing at all.
 *
 * This was invisible for as long as the drawer was permanently on screen --
 * the id-vs-.hidden bug fixed in #402 was masking it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(
  new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url),
  "utf8"
);
const HTML = readFileSync(new URL("../../../website/inbox.html", import.meta.url), "utf8");

/** The declaration block for a selector, or null. */
function ruleFor(selector) {
  const at = CSS.indexOf(`\n${selector} {`);
  if (at === -1) return null;
  const open = CSS.indexOf("{", at);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

describe("sheets anchor to the chat panel", () => {
  it("positions the panel they live in", () => {
    const rule = ruleFor(".inbox-messenger");
    assert.ok(rule, ".inbox-messenger rule missing");
    assert.match(rule, /position:\s*relative/);
  });

  it("keeps both sheets inside that panel in the markup", () => {
    // A sheet moved out of .inbox-messenger would anchor to the page again
    // even with the rule above.
    const panel = HTML.slice(HTML.indexOf('class="inbox-messenger'), HTML.indexOf("</main>"));
    for (const id of ["bundle-drawer", "seller-tools-drawer"]) {
      assert.ok(panel.includes(`id="${id}"`), `${id} is outside .inbox-messenger`);
    }
  });

  it("leaves no absolutely-positioned sheet without an anchor", () => {
    // Any future sheet gets the same check rather than the same bug.
    const absoluteIds = [];
    for (const m of CSS.matchAll(/\n#([a-z0-9-]+) \{([^}]*)\}/g)) {
      if (/position:\s*absolute/.test(m[2])) absoluteIds.push(m[1]);
    }
    assert.ok(absoluteIds.length > 0, "expected at least the two sheets");
    const panel = HTML.slice(HTML.indexOf('class="inbox-messenger'), HTML.indexOf("</main>"));
    for (const id of absoluteIds) {
      if (!HTML.includes(`id="${id}"`)) continue; // not on this page
      assert.ok(
        panel.includes(`id="${id}"`),
        `#${id} is absolutely positioned but sits outside the positioned panel`
      );
    }
  });
});
