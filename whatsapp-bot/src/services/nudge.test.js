import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NUDGE_COOLDOWN_MS } from "./inbox-nudge.js";

const SRC = readFileSync(new URL("./inbox-nudge.js", import.meta.url), "utf8");
const JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const CSS = readFileSync(new URL("../../../website/assets/css/depop-surfaces.css", import.meta.url), "utf8");

describe("the rate limit is the feature", () => {
  it("allows one an hour", () => {
    assert.equal(NUDGE_COOLDOWN_MS, 60 * 60 * 1000);
  });

  it("counts on the server, not in the browser", () => {
    // A client-side cooldown is a suggestion to anyone with a network tab.
    assert.match(SRC, /SELECT created_at FROM messages/);
    assert.match(SRC, /nudge_cooldown/);
  });

  it("is scoped to one direction of one conversation", () => {
    assert.match(SRC, /sender_user_id = \$2 AND receiver_user_id = \$3/);
  });

  it("blocks rather than allows when the check itself fails", () => {
    // A missed nudge is nothing. An unmetered one is the whole failure mode.
    const fn = SRC.slice(SRC.indexOf("export async function nudgeCooldown"));
    assert.match(fn, /catch \(err\)[\s\S]*blocked: true/);
  });

  it("refuses nudging yourself", () => {
    assert.match(SRC, /from === to/);
  });

  it("says when they can try again", () => {
    assert.match(SRC, /minutesLeft/);
  });
});

describe("the shake", () => {
  it("does not replay on every poll", () => {
    // Re-shaking for historical nudges on each reload reads as a fault.
    assert.match(JS, /at <= lastNudgeSeen/);
    assert.match(JS, /const first = lastNudgeSeen === 0/);
  });

  it("ignores your own nudges", () => {
    assert.match(JS, /Number\(m\.senderUserId\) !== state\.viewerId/);
  });

  it("forces a reflow so a second nudge restarts it", () => {
    assert.match(JS, /void shell\.offsetWidth/);
  });

  it("is short and small", () => {
    // A big shake on a phone reads as a crash.
    assert.match(CSS, /@keyframes inbox-shake/);
    assert.match(CSS, /animation: inbox-shake 0\.6s/);
  });

  it("still acknowledges the nudge with reduced motion on", () => {
    const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)", CSS.indexOf("inbox-shake")));
    assert.match(block.slice(0, 400), /animation: none/);
    assert.match(block.slice(0, 400), /outline/);
  });
});

describe("being on cooldown is not an error", () => {
  it("is not shown as a failure", () => {
    assert.match(JS, /data\?\.error !== "nudge_cooldown"/);
  });

  it("re-enables the button either way", () => {
    const fn = JS.slice(JS.indexOf("async function sendNudge"));
    assert.match(fn.slice(0, 1400), /finally \{/);
  });
});
