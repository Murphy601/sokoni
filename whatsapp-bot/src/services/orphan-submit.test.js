/**
 * "Submit" when nothing is open.
 *
 * A rider finished fourteen steps, replied *submit*, and was told the
 * catalogue had no product called "Submit". The onboarding flow was gone by
 * then, so the word fell all the way through to the shopping agent.
 *
 * Why the draft was lost is a separate question. Answering a confirmation
 * word with a product search is wrong regardless of the reason.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isOrphanSubmitWord, isSubmitWord } from "../lib/confirm-words.js";

const HANDLER = readFileSync(new URL("../handlers/webhookHandler.js", import.meta.url), "utf8");

describe("which words get intercepted", () => {
  it("catches the two that only ever mean finish this", () => {
    for (const t of ["submit", "Submit", "  SUBMIT ", "confirm", "Confirm"]) {
      assert.equal(isOrphanSubmitWord(t), true, t);
    }
  });

  it("leaves the conversational ones alone", () => {
    // isSubmitWord accepts these because a flow has already asked a question.
    // With no flow open they are just someone talking, and answering "there
    // is nothing to submit" would be worse than the bug being fixed.
    for (const t of ["yes", "ok", "okay", "sawa", "ndio", "send"]) {
      assert.equal(isOrphanSubmitWord(t), false, t);
      assert.equal(isSubmitWord(t), true, `${t} should still work inside a flow`);
    }
  });

  it("does not catch a real search that starts with the word", () => {
    for (const t of ["submit order", "confirm my order", "shoes"]) {
      assert.equal(isOrphanSubmitWord(t), false, t);
    }
  });
});

describe("where the guard sits", () => {
  it("runs after the flows that legitimately own the word", () => {
    // Inside an application, submit has to reach the flow. The guard is the
    // fallback for when none claimed it.
    const guard = HANDLER.indexOf("isOrphanSubmitWord(text)");
    assert.ok(guard !== -1, "guard missing");
    for (const earlier of [
      "isInRiderOnboarding(customerKey)",
      "isInSellerOnboarding(customerKey)",
    ]) {
      assert.ok(
        HANDLER.indexOf(earlier) < guard,
        `${earlier} must be checked before the guard`
      );
    }
  });

  it("runs before the shopping agent ever sees it", () => {
    const guard = HANDLER.indexOf("isOrphanSubmitWord(text)");
    const roleMenu = HANDLER.indexOf("tryRoleMenu(customerKey");
    assert.ok(roleMenu === -1 || guard < roleMenu, "guard must come before the fallthrough");
  });

  it("ignores it when a document is attached", () => {
    // Document steps caption their uploads; a photo with "submit" on it is
    // part of an application, not an orphan.
    const at = HANDLER.indexOf("isOrphanSubmitWord(text)");
    assert.match(HANDLER.slice(at, at + 60), /&& !hasMedia/);
  });

  it("names both ways back in rather than just apologising", () => {
    const at = HANDLER.indexOf("isOrphanSubmitWord(text)");
    const body = HANDLER.slice(at, at + 700);
    assert.match(body, /RIDER APPLY/);
    assert.match(body, /SELL/);
    assert.match(body, /boda\/apply\.html/);
  });
});
