import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ledgerText, whatsappFallback } from "./escrow-chat-cards.js";
import { ESCROW_STATES } from "../lib/message-kinds.js";

const SRC = readFileSync(new URL("./escrow-chat-cards.js", import.meta.url), "utf8");
const AUTOMATION = readFileSync(new URL("./escrow-automation.js", import.meta.url), "utf8");
const INBOX_JS = readFileSync(new URL("../../../website/assets/js/inbox.js", import.meta.url), "utf8");
const INBOX_HTML = readFileSync(new URL("../../../website/inbox.html", import.meta.url), "utf8");

describe("the WhatsApp fallback", () => {
  it("marks itself as the platform speaking, not the buyer", () => {
    // A seller must never read "the money is locked" as something the person
    // they are negotiating with typed.
    const text = whatsappFallback("SKN-1042", "locked", 1500);
    assert.match(text, /SOKONI ESCROW/);
    assert.match(text, /KES 1,500/);
    assert.match(text, /SKN-1042/);
  });

  it("covers every escrow state a card can show", () => {
    for (const state of ESCROW_STATES) {
      assert.ok(whatsappFallback("SKN-1", state, 100).length > 0, `${state} has no fallback`);
    }
  });

  it("returns empty for a state it does not know, rather than half a sentence", () => {
    assert.equal(whatsappFallback("SKN-1", "teleported", 100), "");
  });
});

describe("the ledger line", () => {
  const base = {
    orderRef: "SKN-1042",
    state: "locked",
    itemName: "Vintage Nike windbreaker",
    itemKes: 1500,
    shippingKes: 400,
    totalKes: 1900,
  };

  it("states the item, the delivery and the total", () => {
    const line = ledgerText(base);
    assert.match(line, /SKN-1042/);
    assert.match(line, /KES 1,500/);
    assert.match(line, /delivery KES 400/);
    assert.match(line, /total KES 1,900/);
  });

  it("says free delivery rather than KES 0", () => {
    assert.match(ledgerText({ ...base, shippingKes: 0 }), /delivery free/);
  });

  it("spells the escrow state out", () => {
    assert.match(ledgerText({ ...base, state: "awaiting_payment" }), /awaiting payment/);
  });
});

describe("a retried callback cannot post the card twice", () => {
  it("checks for an existing card of the same order and state", () => {
    // Safaricom retries STK callbacks. Three "KES 1,500 locked" cards on the
    // feature whose job is looking bulletproof is the worst possible bug.
    assert.match(SRC, /async function cardAlreadyPosted/);
    assert.match(SRC, /payload->>'orderRef' = \$2/);
    assert.match(SRC, /payload->>'state' = \$3/);
    assert.match(SRC, /already_posted/);
  });

  it("posts anyway if the duplicate check itself fails", () => {
    // A duplicate card beats a payment nobody was told about.
    const fn = SRC.slice(SRC.indexOf("async function cardAlreadyPosted"));
    assert.match(fn.slice(0, 900), /catch \(err\)[\s\S]*return false/);
  });

  it("is only reached on the non-duplicate payment path", () => {
    // applyPostPaymentAutomation returns early on already_paid, so the card
    // call has to sit after that guard, not before it.
    const guard = AUTOMATION.indexOf('reason: "already_paid"');
    const call = AUTOMATION.indexOf("postEscrowCard");
    assert.ok(guard !== -1 && call !== -1);
    assert.ok(call > guard, "the card is posted before the already_paid guard");
  });
});

describe("nothing here can break a payment", () => {
  it("is fired without being awaited by the payment path", () => {
    assert.match(AUTOMATION, /void postEscrowCard\(/);
  });

  it("wraps the import so a missing module cannot throw into the callback", () => {
    const block = AUTOMATION.slice(AUTOMATION.indexOf("postEscrowCard") - 400, AUTOMATION.indexOf("postEscrowCard") + 300);
    assert.match(block, /try \{/);
    assert.match(block, /catch \(err\)/);
  });

  it("does not await the WhatsApp relay either", () => {
    // WAHA runs in its own container and can be restarting.
    assert.match(SRC, /void relayToSellerWhatsApp\(/);
  });

  it("returns a reason instead of throwing when parties cannot be resolved", () => {
    assert.match(SRC, /parties_unresolved/);
  });
});

describe("the ledger is one card, updated in place", () => {
  it("updates an existing row rather than appending a new one", () => {
    // Several cards each claiming to be the agreed terms is the argument the
    // ledger exists to settle.
    assert.match(SRC, /UPDATE messages SET payload = \$2::jsonb/);
    assert.match(SRC, /ORDER BY id DESC\s*\n\s*LIMIT 1/);
  });

  it("names who pays delivery outright", () => {
    assert.match(SRC, /shippingPayer/);
  });
});

describe("the inbox renders them apart from chat", () => {
  it("draws escrow cards with their own renderer", () => {
    assert.match(INBOX_JS, /if \(msg\.kind === "escrow_status"\) return escrowCard\(msg\)/);
  });

  it("keeps the pinned ledger out of the scrolling thread", () => {
    assert.match(INBOX_JS, /list\.filter\(\(m\) => !m\.isPinned\)/);
    assert.match(INBOX_JS, /function renderLedger/);
    assert.ok(INBOX_HTML.includes('id="chat-ledger"'));
  });

  it("falls back to a text bubble for kinds it has never seen", () => {
    // A card shipped after this page was loaded must not blank the thread.
    // Sliced to the end of the function rather than a fixed byte window: the
    // window broke twice just from adding a kind above the fallthrough.
    const fn = INBOX_JS.slice(INBOX_JS.indexOf("function messageBubble(msg) {"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /const mine = Number\(msg\.senderUserId\)/);
    // Every early return is a known kind; anything else reaches the bubble.
    const guarded = [...body.matchAll(/msg\.kind === "(\w+)"/g)].map((m) => m[1]);
    assert.ok(guarded.length >= 5, "expected the kind switch to still be here");
    assert.ok(
      body.indexOf("const mine") > body.lastIndexOf('msg.kind === "'),
      "the text fallthrough has to come after every kind check"
    );
  });

  it("asks the API for the pinned card", () => {
    assert.match(INBOX_JS, /renderLedger\(data\.pinned \|\| \[\]\)/);
  });
});
