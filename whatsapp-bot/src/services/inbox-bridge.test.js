import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseReply,
  isBareReplyAllowed,
  rememberInboxPing,
  activeInboxThread,
  clearInboxThread,
  REPLY_WINDOW_MS,
} from "./inbox-bridge.js";
import { setCustomerMeta } from "./session.js";

const WEBHOOK = readFileSync(new URL("../handlers/webhookHandler.js", import.meta.url), "utf8");
const NOTIFY = readFileSync(new URL("./social-notifications.js", import.meta.url), "utf8");
const BRIDGE = readFileSync(new URL("./inbox-bridge.js", import.meta.url), "utf8");

describe("reading a reply", () => {
  it("accepts the explicit prefixes", () => {
    for (const raw of ["R hello there", "r hello there", "REPLY hello there", "r: hello there", "R - hello there"]) {
      const p = parseReply(raw);
      assert.ok(p, raw);
      assert.equal(p.explicit, true, raw);
      assert.equal(p.text, "hello there", raw);
    }
  });

  it("treats anything else as a possible bare reply", () => {
    const p = parseReply("is the jacket still available");
    assert.equal(p.explicit, false);
    assert.equal(p.text, "is the jacket still available");
  });

  it("is not fooled by a word starting with r", () => {
    // "ride" must reach the rider flow, not become a chat reply.
    const p = parseReply("ride");
    assert.equal(p.explicit, false);
  });

  it("returns null for nothing", () => {
    for (const raw of ["", "   ", null, undefined, "R", "R   "]) {
      assert.equal(parseReply(raw), null, JSON.stringify(raw));
    }
  });
});

describe("what a bare reply may never be", () => {
  it("refuses the bot's own vocabulary", () => {
    // This module runs after every other handler, so in principle none of
    // these reach it. Checked anyway: "menu" landing silently in a buyer's
    // chat instead of opening the menu would poison trust in the bridge.
    for (const t of ["menu", "MENU", "help", "cancel", "track", "sell", "ride", "boda", "1", "12", "yes", "no", "hi", "niaje"]) {
      assert.equal(isBareReplyAllowed(t), false, t);
    }
  });

  it("refuses fleet and support commands", () => {
    for (const t of [
      "ACCEPT SKN-1042",
      "PICKUP SKN-1042 4821",
      "CONFIRM SKN-1042 7391",
      "AVAILABLE",
      "SET ZONE THIKA",
      "DISPUTE SKN-1042",
      "#done SKN-1042",
    ]) {
      assert.equal(isBareReplyAllowed(t), false, t);
    }
  });

  it("refuses anything naming an order", () => {
    // Talking about an order is order business, not chat.
    assert.equal(isBareReplyAllowed("what about SKN-1042"), false);
    assert.equal(isBareReplyAllowed("is SK-1042 shipped"), false);
  });

  it("allows ordinary conversation", () => {
    for (const t of [
      "yes it is still available",
      "I can do 1200",
      "Meet me at Westlands at 4",
      "the jacket has no stains",
    ]) {
      assert.equal(isBareReplyAllowed(t), true, t);
    }
  });

  it("refuses a single character", () => {
    assert.equal(isBareReplyAllowed("k"), false);
  });
});

describe("the reply window", () => {
  const key = "254700000111@c.us";

  it("remembers a thread we just pinged about", () => {
    clearInboxThread(key);
    rememberInboxPing(key, { viewerUserId: 7, peerUserId: 9, peerLabel: "Adiv" });
    const t = activeInboxThread(key);
    assert.equal(t.viewerUserId, 7);
    assert.equal(t.peerUserId, 9);
    assert.equal(t.peerLabel, "Adiv");
  });

  it("forgets it once the window passes", () => {
    // Tomorrow's "sawa" must not land in yesterday's buyer's chat.
    setCustomerMeta(key, {
      inboxReply: { viewerUserId: 7, peerUserId: 9, at: Date.now() - REPLY_WINDOW_MS - 1000 },
    });
    assert.equal(activeInboxThread(key), null);
  });

  it("ignores a half-written context rather than guessing", () => {
    setCustomerMeta(key, { inboxReply: { viewerUserId: 7, at: Date.now() } });
    assert.equal(activeInboxThread(key), null);
    clearInboxThread(key);
    assert.equal(activeInboxThread(key), null);
  });

  it("refuses to remember an incomplete thread", () => {
    clearInboxThread(key);
    rememberInboxPing(key, { viewerUserId: 7 });
    assert.equal(activeInboxThread(key), null);
  });
});

describe("where the handler sits", () => {
  it("runs after every other flow, just before the agent", () => {
    // Placement is the whole safety argument: if nothing else claimed the
    // message, routing it to a chat cannot steal an order or a command.
    const bridge = WEBHOOK.indexOf("tryHandleInboxReply");
    const agent = WEBHOOK.indexOf("runAiAgent(customerKey, combinedText");
    const rider = WEBHOOK.indexOf("isInRiderOnboarding(customerKey)");
    const pending = WEBHOOK.lastIndexOf("tryHandlePendingOrder(customerKey, combinedText");
    assert.ok(bridge !== -1 && agent !== -1);
    assert.ok(bridge < agent, "the bridge runs after the agent");
    assert.ok(bridge > rider, "the bridge runs before rider onboarding");
    assert.ok(bridge > pending, "the bridge runs before the pending-order handler");
  });

  it("cannot throw into the webhook", () => {
    const block = WEBHOOK.slice(WEBHOOK.indexOf("tryHandleInboxReply") - 400, WEBHOOK.indexOf("tryHandleInboxReply") + 300);
    assert.match(block, /try \{/);
    assert.match(block, /catch \(err\)/);
  });
});

describe("the ping sets up the reply", () => {
  it("tells the seller they can answer in place", () => {
    assert.match(NOTIFY, /Reply right here/);
    assert.match(NOTIFY, /R your message/);
  });

  it("stores the thread against the chat it just messaged", () => {
    assert.match(NOTIFY, /rememberInboxPing\(toChatId\(sent\.phone\)/);
  });

  it("does not fail the notification if the context cannot be stored", () => {
    const block = NOTIFY.slice(NOTIFY.indexOf("rememberInboxPing") - 300, NOTIFY.indexOf("rememberInboxPing") + 500);
    assert.match(block, /catch \(err\)/);
  });
});

describe("an explicit reply is never silently dropped", () => {
  it("answers when there is no thread to attach it to", () => {
    // Typing R and having nothing happen is worse than having no bridge.
    assert.match(BRIDGE, /I don't have a recent Sokoni chat to reply to/);
  });

  it("passes moderation failures back in the seller's words", () => {
    assert.match(BRIDGE, /message_blocked/);
  });

  it("keeps the window open after a successful reply", () => {
    // A conversation is usually more than one line.
    const fn = BRIDGE.slice(BRIDGE.indexOf("export async function tryHandleInboxReply"));
    assert.match(fn, /rememberInboxPing\(customerKey, thread\)/);
  });
});
