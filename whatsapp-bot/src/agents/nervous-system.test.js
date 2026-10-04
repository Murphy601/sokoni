/**
 * The enriched bus and chat-control agent.
 *
 * A blocked message has to be recorded and reported without the phone number
 * riding along into the admin alert, and a context lookup that fails has to
 * leave the webhook that published the event standing.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentBus, AGENT_EVENTS } from "./event-bus.js";
import { publishEnriched, pickEventData } from "./enrich.js";
import {
  startChatControlAgent,
  stopChatControlAgent,
} from "./chat-control.js";
import { MainSokoniAgent } from "./main-agent.js";
import { normalizeResolveAction } from "./flagged-store.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

beforeEach(() => {
  agentBus.resetForTests();
  stopChatControlAgent();
});

describe("what an agent is allowed to see", () => {
  it("drops contact numbers and unknown fields", () => {
    const data = pickEventData({
      senderUserId: 12,
      receiverUserId: "nope",
      phone: "254712345678",
      text: "Can I pay KES 1000?",
      extra: "secret",
    });
    assert.equal(data.senderUserId, 12);
    assert.equal(data.receiverUserId, undefined);
    assert.equal(data.phone, undefined);
    assert.equal(data.extra, undefined);
    assert.equal(data.text, "Can I pay KES 1000?");
  });

  it("caps a long message", () => {
    assert.equal(pickEventData({ text: "a".repeat(900) }).text.length, 400);
  });

  it("publishes with an empty context when the lookup throws", async () => {
    const seen = [];
    agentBus.subscribe("Watcher", AGENT_EVENTS.FLAGGED_MESSAGE, (event) => seen.push(event));
    const event = await publishEnriched(
      AGENT_EVENTS.FLAGGED_MESSAGE,
      { senderUserId: 4, violationType: "PHONE_NUMBER", phone: "0712345678" },
      async () => {
        throw new Error("db down");
      }
    );
    assert.equal(seen.length, 1);
    assert.equal(event.context.sender, undefined);
    assert.equal(typeof event.context.global.activeUsers, "number");
    assert.equal(event.data.senderUserId, 4);
    assert.equal(event.data.phone, undefined);
    assert.equal(event.data.text, undefined);
    assert.equal(event.eventType, "FLAGGED_MESSAGE");
    const recorder = src("./chat-control.js");
    const flagPublish = recorder.slice(
      recorder.indexOf("publishEnriched(AGENT_EVENTS.FLAGGED_MESSAGE"),
      recorder.indexOf("return row;")
    );
    assert.doesNotMatch(flagPublish, /\btext\b/);
  });

  it("skips the lookup when the event has no people on it", async () => {
    let calls = 0;
    const event = await publishEnriched(
      AGENT_EVENTS.PAYMENT_LOCKED,
      { orderId: "SKN-9", amountKes: 1400, escrowStatus: "held", phone: "254700000000" },
      async () => {
        calls += 1;
        return { sender: { id: 1 } };
      }
    );
    assert.equal(calls, 0);
    assert.equal(event.context.sender, undefined);
    assert.equal(typeof event.context.global.pendingEscrows, "number");
    assert.equal(event.data.orderId, "SKN-9");
    assert.equal(event.data.amountKes, 1400);
    assert.equal(event.data.phone, undefined);
  });

  it("returns before the lookup runs", async () => {
    let started = false;
    const pending = publishEnriched(AGENT_EVENTS.CHAT_MESSAGE_CREATED, { senderUserId: 2 }, async () => {
      started = true;
      return { sender: { id: 2 } };
    });
    assert.equal(started, false);
    const event = await pending;
    assert.equal(started, true);
    assert.equal(event.context.sender.id, 2);
  });
});

describe("chat control reports upward without quoting the message", () => {
  it("sends one high alert and leaves the body out", async () => {
    const sent = [];
    const agent = new MainSokoniAgent({
      notify: async (text) => {
        sent.push(text);
      },
    });
    agent.start();
    startChatControlAgent();
    agentBus.publish(AGENT_EVENTS.FLAGGED_MESSAGE, {
      data: {
        flaggedId: 9,
        senderUserId: 4,
        receiverUserId: 5,
        violationType: "PHONE_NUMBER",
        text: "call me on 0712345678",
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /PHONE_NUMBER/);
    assert.match(sent[0], /Flag #9/);
    assert.doesNotMatch(sent[0], /0712345678/);
    assert.doesNotMatch(sent[0], /call me/);
  });

  it("does not subscribe twice", () => {
    startChatControlAgent();
    startChatControlAgent();
    assert.equal(agentBus.listenerCount(AGENT_EVENTS.FLAGGED_MESSAGE), 1);
  });
});

describe("resolve actions stay inside what the schema can store", () => {
  it("maps warn and dismiss, and refuses a fake suspension", () => {
    assert.equal(normalizeResolveAction("warn"), "WARNED");
    assert.equal(normalizeResolveAction("DISMISS"), "DISMISSED");
    assert.equal(normalizeResolveAction("SUSPEND"), null);
  });
});

describe("the wiring matches the real schema", () => {
  const schema = src("../../db/schema-phase40-flagged-messages.sql");
  const social = src("../db/repositories/social.js");
  const migrate = src("../db/migrate.js");
  const server = src("../server.js");
  const enrich = src("./enrich.js");
  const store = src("./flagged-store.js");
  const escrow = src("../services/escrow-automation.js");

  it("audits flags against users, not a conversation or escrow table", () => {
    assert.match(schema, /sender_user_id\s+INT REFERENCES users/);
    assert.match(schema, /phase40_flagged_messages/);
    assert.doesNotMatch(schema, /trust_score/);
    assert.doesNotMatch(schema, /user_flags/);
    assert.doesNotMatch(schema, /\bchats\b/);
    assert.doesNotMatch(schema, /\bescrows\b/);
    assert.doesNotMatch(schema, /\bitems\b/);
    assert.match(migrate, /schema-phase40-flagged-messages\.sql/);
  });

  it("does not put contact numbers on the context query or the public list", () => {
    assert.doesNotMatch(enrich, /\bphone\b/);
    const list = store.slice(store.indexOf("export async function listFlaggedMessages"));
    assert.doesNotMatch(list.slice(0, 900), /\bphone\b/);
  });

  it("records a block before the message insert, and still screens first", () => {
    const fn = social.slice(social.indexOf("export async function sendDirectMessage"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    assert.ok(body.indexOf("screenMessage(") < body.indexOf("recordBlockedChat("));
    assert.ok(body.indexOf("recordBlockedChat(") < body.indexOf("INSERT INTO messages"));
    assert.ok(body.indexOf("INSERT INTO messages") < body.indexOf("publishChatMessage("));
  });

  it("starts chat control next to the main agent", () => {
    const start = server.slice(server.indexOf("function startAgentLayer"));
    assert.match(start.slice(0, 1200), /startChatControlAgent/);
    assert.match(start.slice(0, 1200), /startPlatformAgents/);
  });

  it("announces a held payment without sitting in front of the duplicate guard", () => {
    const guard = escrow.indexOf('reason: "already_paid"');
    const call = escrow.indexOf("\n  publishEscrowHeld(order);");
    assert.ok(guard !== -1 && call > guard);
  });
});
