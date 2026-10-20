import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_KINDS,
  ESCROW_STATES,
  isKnownKind,
  isSystemKind,
  validatePayload,
  fallbackText,
} from "./message-kinds.js";

describe("what counts as a message kind", () => {
  it("knows every kind it defines", () => {
    for (const k of Object.values(MESSAGE_KINDS)) {
      assert.equal(isKnownKind(k), true, k);
    }
  });

  it("refuses anything else rather than storing it", () => {
    for (const k of ["", null, undefined, "sql", "TEXT", "offer"]) {
      assert.equal(isKnownKind(k), false, String(k));
    }
  });

  it("marks the cards only the system may send", () => {
    assert.equal(isSystemKind(MESSAGE_KINDS.ESCROW_STATUS), true);
    assert.equal(isSystemKind(MESSAGE_KINDS.DEAL_LEDGER), true);
    assert.equal(isSystemKind(MESSAGE_KINDS.TEXT), false);
    assert.equal(isSystemKind(MESSAGE_KINDS.SWAP_OFFER), false);
  });
});

describe("payload validation", () => {
  it("lets plain text through with nothing attached", () => {
    assert.equal(validatePayload(MESSAGE_KINDS.TEXT, {}).ok, true);
  });

  it("names the fields a card is missing", () => {
    const r = validatePayload(MESSAGE_KINDS.BUNDLE, {});
    assert.equal(r.ok, false);
    assert.match(r.message, /productIds/);
  });

  it("accepts media by the name the reader actually uses", () => {
    // getMessageMedia reads payload.mediaUrl. Requiring "url" here meant every
    // voice note failed validation while looking right everywhere else.
    assert.equal(validatePayload(MESSAGE_KINDS.VOICE, { mediaUrl: "/a.ogg" }).ok, true);
    assert.equal(validatePayload(MESSAGE_KINDS.IMAGE, { mediaUrl: "/a.jpg" }).ok, true);
    assert.equal(validatePayload(MESSAGE_KINDS.VOICE, { url: "/a.ogg" }).ok, false);
  });

  it("does not demand a duration WAHA may never report", () => {
    assert.equal(validatePayload(MESSAGE_KINDS.VOICE, { mediaUrl: "/a.ogg" }).ok, true);
  });

  it("treats an empty array as missing", () => {
    // A bundle of nothing is a bug, not a bundle.
    assert.equal(validatePayload(MESSAGE_KINDS.BUNDLE, { productIds: [] }).ok, false);
    assert.equal(validatePayload(MESSAGE_KINDS.BUNDLE, { productIds: ["p1"] }).ok, true);
  });

  it("keeps extra fields, so an older row still renders when a card grows", () => {
    const r = validatePayload(MESSAGE_KINDS.IMAGE, { mediaUrl: "/x.jpg", width: 800, caption: "hi" });
    assert.equal(r.ok, true);
    assert.equal(r.payload.width, 800);
  });

  it("only accepts escrow states that exist", () => {
    for (const state of ESCROW_STATES) {
      assert.equal(validatePayload(MESSAGE_KINDS.ESCROW_STATUS, { orderRef: "SKN-1", state }).ok, true, state);
    }
    const bad = validatePayload(MESSAGE_KINDS.ESCROW_STATUS, { orderRef: "SKN-1", state: "paid" });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /state must be one of/);
  });

  it("rejects a payload that is not an object", () => {
    for (const p of [null, [], "x", 5]) {
      assert.equal(validatePayload(MESSAGE_KINDS.TEXT, p).ok, false, JSON.stringify(p));
    }
  });

  it("rejects an unknown kind before it reaches the database", () => {
    assert.equal(validatePayload("drop_table", {}).ok, false);
  });
});

describe("fallback text", () => {
  it("gives every card something to show without rendering it", () => {
    // This is what an older client, the thread preview, and WhatsApp all use.
    for (const k of Object.values(MESSAGE_KINDS)) {
      if (k === MESSAGE_KINDS.TEXT) continue;
      assert.ok(fallbackText(k, {}).length > 0, `${k} has no fallback`);
    }
  });

  it("puts the numbers people care about into it", () => {
    assert.match(fallbackText(MESSAGE_KINDS.OFFER_CARD, { amountKes: 1200 }), /KES 1,200/);
    assert.match(fallbackText(MESSAGE_KINDS.SWAP_OFFER, { topUpKes: 500 }), /KES 500/);
    assert.match(fallbackText(MESSAGE_KINDS.BUNDLE, { productIds: ["a", "b"] }), /2 items/);
    assert.match(
      fallbackText(MESSAGE_KINDS.ESCROW_STATUS, { orderRef: "SKN-1042", state: "awaiting_payment" }),
      /SKN-1042: awaiting payment/
    );
  });

  it("returns empty for plain text, which already has its own", () => {
    assert.equal(fallbackText(MESSAGE_KINDS.TEXT, {}), "");
    assert.equal(fallbackText("nonsense", {}), "");
  });
});
