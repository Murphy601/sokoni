/**
 * The bus and the main agent.
 *
 * These two sit under everything else, so the tests are mostly about what
 * happens when something goes wrong: a sub-agent with a bug, a malformed
 * report, an alert storm, a WhatsApp send that fails. A monitoring layer that
 * can break a sale, or that floods the admin until they mute it, is worse
 * than no monitoring layer.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentBus, AGENT_EVENTS, SEVERITY, normalizeReport, atLeastSevere } from "./event-bus.js";
import {
  MainSokoniAgent,
  reportToMainAgent,
  BUFFER_LIMIT,
  DEDUPE_WINDOW_MS,
  MAX_ALERTS_PER_HOUR,
} from "./main-agent.js";

beforeEach(() => agentBus.resetForTests());

describe("a broken sub-agent cannot break the caller", () => {
  it("swallows a handler that throws", () => {
    agentBus.subscribe("Broken", AGENT_EVENTS.SUBAGENT_REPORT, () => {
      throw new Error("agent blew up");
    });
    // If this propagated, the webhook that published it would 500.
    assert.doesNotThrow(() => agentBus.publish(AGENT_EVENTS.SUBAGENT_REPORT, { summary: "x" }));
    assert.equal(agentBus.failureReport()["Broken:SUBAGENT_REPORT"], 1);
  });

  it("swallows a handler that rejects", async () => {
    agentBus.subscribe("Async", AGENT_EVENTS.SUBAGENT_REPORT, async () => {
      throw new Error("later");
    });
    agentBus.publish(AGENT_EVENTS.SUBAGENT_REPORT, { summary: "x" });
    await new Promise((r) => setImmediate(r));
    assert.equal(agentBus.failureReport()["Async:SUBAGENT_REPORT"], 1);
  });

  it("keeps delivering to the agents that work", () => {
    const seen = [];
    agentBus.subscribe("Bad", AGENT_EVENTS.SUBAGENT_REPORT, () => {
      throw new Error("nope");
    });
    agentBus.subscribe("Good", AGENT_EVENTS.SUBAGENT_REPORT, (p) => seen.push(p.summary));
    agentBus.publish(AGENT_EVENTS.SUBAGENT_REPORT, { summary: "still arrives" });
    assert.deepEqual(seen, ["still arrives"]);
  });

  it("does not die on an error event with nobody listening", () => {
    // Plain EventEmitter terminates the process here.
    assert.doesNotThrow(() => agentBus.publish("error", new Error("boom")));
  });

  it("refuses a subscription with no handler, loudly", () => {
    assert.throws(() => agentBus.subscribe("X", AGENT_EVENTS.SUBAGENT_REPORT, null), TypeError);
  });

  it("allows enough listeners for a dozen agents", () => {
    assert.ok(agentBus.getMaxListeners() >= 32);
  });
});

describe("a malformed report cannot poison the buffer", () => {
  it("drops anything without a summary", () => {
    for (const bad of [null, undefined, 42, "text", {}, { summary: "   " }, []]) {
      assert.equal(normalizeReport(bad), null, JSON.stringify(bad));
    }
  });

  it("falls back to INFO for an unknown severity", () => {
    assert.equal(normalizeReport({ summary: "x", severity: "SUPER_URGENT" }).severity, "INFO");
  });

  it("never lets data be an array or a scalar", () => {
    assert.deepEqual(normalizeReport({ summary: "x", data: [1, 2] }).data, {});
    assert.deepEqual(normalizeReport({ summary: "x", data: 7 }).data, {});
  });

  it("caps the summary so one agent cannot fill the buffer", () => {
    assert.equal(normalizeReport({ summary: "a".repeat(5000) }).summary.length, 400);
  });

  it("ranks severities in the right order", () => {
    assert.equal(atLeastSevere(SEVERITY.CRITICAL, SEVERITY.HIGH), true);
    assert.equal(atLeastSevere(SEVERITY.INFO, SEVERITY.HIGH), false);
  });
});

/** A main agent with a fake clock and a fake notifier. */
function makeAgent() {
  const sent = [];
  let t = 1000000;
  const agent = new MainSokoniAgent({
    notify: async (text) => {
      sent.push(text);
    },
    now: () => t,
  });
  return { agent, sent, advance: (ms) => (t += ms) };
}

describe("what interrupts the admin", () => {
  it("buffers INFO without sending anything", async () => {
    const { agent, sent } = makeAgent();
    await agent.handleReport({ type: "FIN", severity: "INFO", summary: "KES 500 locked" });
    assert.equal(sent.length, 0);
    assert.equal(agent.stats().total, 1);
  });

  it("sends HIGH straight away", async () => {
    const { agent, sent } = makeAgent();
    await agent.handleReport({ type: "ESCROW", severity: "HIGH", summary: "not dispatched" });
    assert.equal(sent.length, 1);
    assert.match(sent[0], /not dispatched/);
  });

  it("collapses the same alert repeated in a loop", async () => {
    const { agent, sent } = makeAgent();
    for (let i = 0; i < 25; i += 1) {
      await agent.handleReport({ type: "ESCROW", severity: "HIGH", summary: "same thing" });
    }
    assert.equal(sent.length, 1, "a stuck agent must not send 25 WhatsApps");
    assert.equal(agent.stats().suppressed, 24);
  });

  it("lets the same alert through again once the window passes", async () => {
    const { agent, sent, advance } = makeAgent();
    await agent.handleReport({ type: "E", severity: "HIGH", summary: "again" });
    advance(DEDUPE_WINDOW_MS + 1);
    await agent.handleReport({ type: "E", severity: "HIGH", summary: "again" });
    assert.equal(sent.length, 2);
  });

  it("caps distinct alerts per hour", async () => {
    const { agent, sent } = makeAgent();
    for (let i = 0; i < MAX_ALERTS_PER_HOUR + 8; i += 1) {
      await agent.handleReport({ type: "E", severity: "HIGH", summary: `distinct ${i}` });
    }
    assert.equal(sent.length, MAX_ALERTS_PER_HOUR);
  });

  it("still lets CRITICAL through when the cap is reached", async () => {
    // A cap that hides fraud is the wrong trade. Dedupe still applies, so a
    // loop cannot use CRITICAL to spam.
    const { agent, sent } = makeAgent();
    for (let i = 0; i < MAX_ALERTS_PER_HOUR + 3; i += 1) {
      await agent.handleReport({ type: "E", severity: "HIGH", summary: `d ${i}` });
    }
    const before = sent.length;
    await agent.handleReport({ type: "FRAUD", severity: "CRITICAL", summary: "seller fraud" });
    assert.equal(sent.length, before + 1);
  });

  it("does not throw when the notifier fails", async () => {
    const agent = new MainSokoniAgent({
      notify: async () => {
        throw new Error("WAHA down");
      },
    });
    const r = await agent.handleReport({ type: "E", severity: "HIGH", summary: "x" });
    assert.equal(r.alerted, false);
    assert.equal(r.buffered, true, "the event is still recorded even if the ping fails");
  });
});

describe("memory stays bounded", () => {
  it("caps the buffer", async () => {
    const { agent } = makeAgent();
    for (let i = 0; i < BUFFER_LIMIT + 60; i += 1) {
      await agent.handleReport({ type: "T", severity: "INFO", summary: `e${i}` });
    }
    assert.equal(agent.buffer.length, BUFFER_LIMIT);
    assert.equal(agent.buffer.at(-1).summary, `e${BUFFER_LIMIT + 59}`, "keeps the newest");
  });

  it("prunes the dedupe map", async () => {
    const { agent, advance } = makeAgent();
    for (let i = 0; i < 260; i += 1) {
      await agent.handleReport({ type: "T", severity: "CRITICAL", summary: `k${i}` });
    }
    advance(DEDUPE_WINDOW_MS + 1);
    await agent.handleReport({ type: "T", severity: "CRITICAL", summary: "flush" });
    assert.ok(agent.recentAlerts.size < 260);
  });
});

describe("the digest", () => {
  it("says so when nothing happened", () => {
    const { agent } = makeAgent();
    assert.match(agent.composeDigest(), /Nothing reported/);
  });

  it("counts what came in", async () => {
    const { agent } = makeAgent();
    await agent.handleReport({ type: "FIN", severity: "INFO", summary: "a" });
    await agent.handleReport({ type: "FIN", severity: "INFO", summary: "b" });
    await agent.handleReport({ type: "ESCROW", severity: "HIGH", summary: "c" });
    const text = agent.composeDigest();
    assert.match(text, /Events: 3/);
    assert.match(text, /Needs attention: 1/);
    assert.match(text, /FIN 2/);
  });

  it("admits how much it held back", async () => {
    // A quiet digest hiding forty suppressed warnings is a lie.
    const { agent } = makeAgent();
    for (let i = 0; i < 6; i += 1) {
      await agent.handleReport({ type: "E", severity: "HIGH", summary: "same" });
    }
    assert.match(agent.composeDigest(), /Held back to avoid flooding you: 5/);
  });

  it("reports agent handler failures rather than claiming health", () => {
    const { agent } = makeAgent();
    agentBus.subscribe("Broken", AGENT_EVENTS.SUBAGENT_REPORT, () => {
      throw new Error("x");
    });
    agentBus.publish(AGENT_EVENTS.SUBAGENT_REPORT, { summary: "y" });
    assert.match(agent.composeDigest(), /handler failures: 1/);
  });

  it("stays silent when nothing happened", async () => {
    // "Nothing reported" every six hours is how a channel stops being read,
    // and the alerts share that channel.
    const { agent, sent } = makeAgent();
    assert.equal(await agent.sendDigest(), false);
    assert.equal(sent.length, 0);
    assert.equal(agent.isQuiet(), true);
  });

  it("still sends a quiet digest when explicitly asked", async () => {
    const { agent, sent } = makeAgent();
    assert.equal(await agent.sendDigest({ skipIfQuiet: false }), true);
    assert.match(sent[0], /Nothing reported/);
  });

  it("clears the window after sending", async () => {
    const { agent } = makeAgent();
    await agent.handleReport({ type: "T", severity: "INFO", summary: "a" });
    assert.equal(await agent.sendDigest(), true);
    assert.equal(agent.stats().total, 0);
  });

  it("keeps the buffer if the digest could not be delivered", async () => {
    const agent = new MainSokoniAgent({
      notify: async () => {
        throw new Error("down");
      },
    });
    await agent.handleReport({ type: "T", severity: "INFO", summary: "a" });
    assert.equal(await agent.sendDigest(), false);
    assert.equal(agent.stats().total, 1, "an undelivered digest must not lose the events");
  });
});

describe("wiring", () => {
  it("receives what a sub-agent reports", async () => {
    const { agent } = makeAgent();
    agent.start();
    reportToMainAgent({ type: "FIN", severity: "INFO", summary: "from a sub-agent" });
    await new Promise((r) => setImmediate(r));
    assert.equal(agent.buffer.at(-1)?.summary, "from a sub-agent");
    agent.stop();
  });

  it("start twice does not double-subscribe", async () => {
    const { agent } = makeAgent();
    agent.start();
    agent.start();
    agentBus.publish(AGENT_EVENTS.SUBAGENT_REPORT, { type: "T", severity: "INFO", summary: "once" });
    await new Promise((r) => setImmediate(r));
    assert.equal(agent.buffer.length, 1);
    agent.stop();
  });
});

describe("how it is started", () => {
  const SERVER = readFileSync(new URL("../server.js", import.meta.url), "utf8");

  it("starts from the server", () => {
    assert.match(SERVER, /function startAgentLayer/);
    assert.match(SERVER, /startAgentLayer\(\);/);
  });

  it("can be turned off without a deploy", () => {
    // If the layer ever misbehaves in production, it has to be switchable
    // without shipping code.
    assert.match(SERVER, /SOKONI_AGENTS_ENABLED/);
  });

  it("cannot take the server down on start", () => {
    const fn = SERVER.slice(SERVER.indexOf("function startAgentLayer"));
    const body = fn.slice(0, fn.indexOf("\nfunction "));
    assert.match(body, /\.catch\(/);
    assert.match(body, /unref/);
  });
});
