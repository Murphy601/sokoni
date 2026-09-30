/**
 * A caption is a message.
 *
 * The contact-details filter was gated on `kind === "text"`, so a photo
 * captioned "call me on 0712..." went straight through. Photo sending shipped
 * in #408 with a PR note claiming captions were screened. They were not.
 *
 * The filter screens every kind whose content a person typed, and no kind
 * whose content Sokoni wrote -- screening "🎁 A deal to scratch" would only
 * ever produce false positives.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isUserAuthoredKind, USER_AUTHORED_KINDS, MESSAGE_KINDS } from "./message-kinds.js";

const REPO = readFileSync(new URL("../db/repositories/social.js", import.meta.url), "utf8");

describe("which kinds carry typed prose", () => {
  it("screens text, photo captions and video captions", () => {
    for (const k of [MESSAGE_KINDS.TEXT, MESSAGE_KINDS.IMAGE, MESSAGE_KINDS.VIDEO]) {
      assert.equal(isUserAuthoredKind(k), true, k);
    }
  });

  it("leaves the platform's own wording alone", () => {
    for (const k of [
      MESSAGE_KINDS.VOICE,
      MESSAGE_KINDS.SCRATCH_CARD,
      MESSAGE_KINDS.NUDGE,
      MESSAGE_KINDS.BUNDLE,
      MESSAGE_KINDS.LOCKED_DROP,
      MESSAGE_KINDS.FIT_CHECK,
      MESSAGE_KINDS.ESCROW_STATUS,
      MESSAGE_KINDS.DEAL_LEDGER,
      MESSAGE_KINDS.OFFER_CARD,
    ]) {
      assert.equal(isUserAuthoredKind(k), false, k);
    }
  });

  it("says no to anything it does not recognise", () => {
    for (const k of ["", null, undefined, "made_up"]) {
      assert.equal(isUserAuthoredKind(k), false, String(k));
    }
  });

  it("covers every media kind a person can caption", () => {
    // Voice notes are excluded because there is nothing typed to screen.
    assert.ok(USER_AUTHORED_KINDS.includes(MESSAGE_KINDS.IMAGE));
    assert.ok(USER_AUTHORED_KINDS.includes(MESSAGE_KINDS.VIDEO));
    assert.ok(!USER_AUTHORED_KINDS.includes(MESSAGE_KINDS.VOICE));
  });
});

describe("the gate in the repository", () => {
  it("no longer checks for text alone", () => {
    assert.doesNotMatch(REPO, /messageKind === MESSAGE_KINDS\.TEXT && hasForbiddenMessage/);
    assert.match(REPO, /isUserAuthoredKind\(messageKind\) && hasForbiddenMessage/);
  });

  it("still runs before the row is written", () => {
    const fn = REPO.slice(REPO.indexOf("export async function sendDirectMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.ok(
      body.indexOf("hasForbiddenMessage") < body.indexOf("INSERT INTO messages"),
      "a blocked caption must never reach the table"
    );
  });
});
