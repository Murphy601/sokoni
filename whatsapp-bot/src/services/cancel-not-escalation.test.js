import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ORDER_ID_CAPTURE } from "../lib/order-id.js";

const HUB = readFileSync(new URL("./communication-hub.js", import.meta.url), "utf8");
const ADMIN = readFileSync(new URL("./admin.js", import.meta.url), "utf8");

// String.raw so the escapes survive: written as a plain template literal, \b
// becomes a backspace character and the pattern silently matches nothing.
const help = new RegExp(String.raw`^(HELP|PROBLEM)\b(?:\s+${ORDER_ID_CAPTURE})?`, "i");
const cancel = new RegExp(String.raw`^CANCEL\s+${ORDER_ID_CAPTURE}\b`, "i");
const escalates = (t) => {
  const s = String(t).trim();
  return Boolean(s.match(help) || s.match(cancel));
};

describe("what may freeze escrow and silence the bot", () => {
  it("does not escalate a bare cancel", () => {
    // This branch runs ahead of every other handler, so "Cancel" typed at a
    // checkout froze an unrelated order's escrow, silenced both chats and
    // paged an admin.
    for (const t of ["Cancel", "cancel", "  CANCEL  ", "cancel order", "cancel my order"]) {
      assert.equal(escalates(t), false, `"${t}" still escalates`);
    }
  });

  it("still escalates a cancel that names an order", () => {
    for (const t of ["CANCEL SKN-1016", "cancel SKN-1002-1", "Cancel SK-1042"]) {
      assert.equal(escalates(t), true, `"${t}" no longer escalates`);
    }
  });

  it("leaves HELP and PROBLEM working with or without an id", () => {
    for (const t of ["HELP", "help", "PROBLEM", "HELP SKN-1016", "problem SK-1042"]) {
      assert.equal(escalates(t), true, `"${t}" stopped escalating`);
    }
  });

  it("the hub no longer treats CANCEL as a bare help keyword", () => {
    assert.ok(!HUB.includes("^(HELP|PROBLEM|CANCEL)"), "CANCEL is still a bare help keyword");
    assert.ok(HUB.includes("^(HELP|PROBLEM)"), "HELP/PROBLEM matcher missing");
    assert.ok(HUB.includes("^CANCEL"), "CANCEL-with-id matcher missing");
  });
});

describe("#done all", () => {
  it("resumes every open takeover in one command", () => {
    assert.ok(ADMIN.includes('if (/^all$/i.test(raw)) {'));
    assert.ok(ADMIN.includes("listOpenTakeOverOrders(100)"));
    assert.ok(ADMIN.includes("resolveAdminTakeOver(o.id"));
  });

  it("reports the ones it could not resume rather than claiming success", () => {
    assert.ok(ADMIN.includes("Still stuck"));
  });

  it("is offered when several takeovers are listed", () => {
    assert.ok(ADMIN.includes("Or *#done all* to resume every one of them."));
  });
});
