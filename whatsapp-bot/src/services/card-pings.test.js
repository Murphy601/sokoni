/**
 * Every card sent between two people reaches WhatsApp.
 *
 * The inbox is not where most sellers live. A nudge, a voice note or a bundle
 * that only lands on the site is a message nobody reads, and that is exactly
 * what shipped: only /chat/send pinged, so the five newer card kinds went out
 * silently.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

const REPO = src("../db/repositories/social.js");
const API = src("../routes/socialApi.js");
const NOTIFY = src("./social-notifications.js");

const CARD_SERVICES = {
  "inbox-nudge.js": "nudge",
  "scratch-cards.js": "scratch card",
  "locked-drops.js": "locked drop",
  "bundle-cards.js": "bundle",
};

describe("the ping sits at the choke point", () => {
  it("fires from sendDirectMessage, not from one route", () => {
    const fn = REPO.slice(REPO.indexOf("export async function sendDirectMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /social-notifications\.js/);
    assert.match(body, /notifyNewDirectMessage/);
  });

  it("does not ping twice for a plain text message", () => {
    // The route used to do this itself. Leaving both in place would send the
    // seller two WhatsApps for one message.
    assert.doesNotMatch(API, /notifyNewDirectMessage/);
  });

  it("stays out of the way when the write fails", () => {
    // The ping is fired after the insert returns, so a refused message never
    // produces a WhatsApp saying it arrived.
    const fn = REPO.slice(REPO.indexOf("export async function sendDirectMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.ok(
      body.indexOf("INSERT INTO messages") < body.indexOf("notifyNewDirectMessage"),
      "ping must come after the insert"
    );
  });

  it("never blocks the reply on WhatsApp being up", () => {
    // WAHA runs in its own container and can be restarting. A buyer pressing
    // send should not wait on it, and a failed ping must not fail the message.
    const fn = REPO.slice(REPO.indexOf("export async function sendDirectMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /void import\(/);
    assert.match(body, /\.catch\(/);
  });
});

describe("what does and does not ping", () => {
  it("skips system cards so a payment does not ping twice", () => {
    // Escrow and ledger cards are posted by flows that already message both
    // parties over WhatsApp.
    const fn = REPO.slice(REPO.indexOf("export async function sendDirectMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.match(body, /if \(!isSystem\) \{/);
  });

  it("routes every card service through the choke point", () => {
    for (const [file, label] of Object.entries(CARD_SERVICES)) {
      assert.match(src(`./${file}`), /sendDirectMessage\(/, `${label} bypasses the ping`);
    }
  });

  it("sends voice notes through it too", () => {
    const route = API.slice(API.indexOf('router.post("/chat/voice"'));
    assert.match(route.slice(0, 4000), /sendDirectMessage\(/);
  });
});

describe("what the receiver actually reads", () => {
  it("describes the card rather than showing an empty message", () => {
    // A card carries no prose of its own, so the stored content falls back to
    // a human sentence per kind -- that is what the WhatsApp preview quotes.
    const fn = REPO.slice(REPO.indexOf("export async function sendDirectMessage"));
    assert.match(fn.slice(0, 2000), /fallbackText\(messageKind/);
    assert.match(NOTIFY, /message\?\.content/);
  });

  it("gives them a way back into the thread", () => {
    assert.match(NOTIFY, /inboxPath\(/);
    assert.match(NOTIFY, /rememberInboxPing/);
  });
});
