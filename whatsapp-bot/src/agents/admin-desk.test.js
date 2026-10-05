/**
 * Admin desk: socket token, WhatsApp alerts, and commands that read real rows.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminTokenFromHandshake } from "./ops-desk.js";
import {
  HIGH_VALUE_KES,
  notifyMemorySpike,
  notifyProposedAction,
  notifySecurityFlag,
  resetNotifierForTests,
} from "./admin-notifier.js";
import { adminCommandIndex, handleAdminDispatch, matchAdminDispatch } from "./admin-dispatch.js";
import { parseAgentActionOutput, sanitizeOutboundAgentText } from "./output-guard.js";
import { isUnauthorizedAdminProbe, PUBLIC_HELP_REPLY } from "../services/admin.js";

const src = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the ops socket", () => {
  it("reads the admin token from the handshake header, not the query string", () => {
    const handshake = {
      query: { token: "from-query" },
      auth: {},
      headers: { "x-admin-token": "from-header" },
    };
    assert.equal(adminTokenFromHandshake(handshake), "from-header");
    assert.equal(adminTokenFromHandshake({ query: { token: "from-query" }, headers: {} }), "");
  });

  it("attaches the namespace on the existing socket server", () => {
    assert.match(src("../services/rider-tracking.js"), /attachOpsNamespace/);
    assert.match(src("./ops-desk.js"), /io\.of\("\/ops"\)/);
    const tokenFn = src("./ops-desk.js");
    const body = tokenFn.slice(tokenFn.indexOf("export function adminTokenFromHandshake"));
    assert.doesNotMatch(body.slice(0, body.indexOf("export function emitOpsEvent")), /query/);
  });
});

describe("urgent WhatsApp", () => {
  it("pages a high-value approval and stays quiet under the line", async () => {
    resetNotifierForTests();
    const sent = [];
    const high = await notifyProposedAction(
      { id: 12, actionType: "RELEASE_ESCROW", orderId: "SKN-9", reason: "inspection ended" },
      { amountKes: HIGH_VALUE_KES, send: async (_phone, text) => sent.push(text) }
    );
    assert.equal(high.whatsapp, true);
    assert.match(sent[0], /A 12/);
    assert.match(sent[0], /SKN-9/);
    assert.doesNotMatch(sent[0], /2547/);
    const low = await notifyProposedAction(
      { id: 13, actionType: "PROMPT_STK", orderId: "SKN-8", reason: "retry" },
      { amountKes: HIGH_VALUE_KES - 1, send: async () => sent.push("nope") }
    );
    assert.equal(low.whatsapp, false);
    assert.equal(sent.length, 1);
  });

  it("sends one memory alert inside the quiet period", async () => {
    resetNotifierForTests();
    const sent = [];
    const send = async (_phone, text) => sent.push(text);
    const first = await notifyMemorySpike(382, { send, now: () => 1_000 });
    const second = await notifyMemorySpike(390, { send, now: () => 2_000 });
    assert.equal(first.whatsapp, true);
    assert.equal(second.whatsapp, false);
    assert.equal(second.reason, "rate_limited");
    assert.match(sent[0], /382MB/);
  });

  it("does not page the same blocked chat twice", async () => {
    resetNotifierForTests();
    let calls = 0;
    const send = async () => {
      calls += 1;
    };
    await notifySecurityFlag(
      { flaggedId: 4, violationType: "PHONE_NUMBER", senderUserId: 9, snippet: "call me" },
      { send }
    );
    const again = await notifySecurityFlag(
      { flaggedId: 4, violationType: "PHONE_NUMBER", senderUserId: 9, snippet: "call me" },
      { send }
    );
    assert.equal(calls, 1);
    assert.equal(again.reason, "duplicate");
  });

  it("keeps the main agent from paging those same events again", () => {
    const chat = src("./chat-control.js");
    const flagged = chat.slice(chat.indexOf("function onFlagged"));
    assert.match(flagged, /SEVERITY\.INFO/);
    assert.doesNotMatch(flagged, /SEVERITY\.HIGH/);
    assert.match(chat, /notifySecurityFlag/);
    const heap = src("./platform-agents.js");
    const guard = heap.slice(heap.indexOf("VM_MEMORY_SPIKE"));
    assert.match(guard, /SEVERITY\.INFO/);
    assert.match(guard, /notifyMemorySpike/);
    assert.match(src("./agent-actions.js"), /notifyProposedAction/);
  });
});

describe("admin commands", () => {
  it("recognises the desk verbs and leaves a shop message alone", () => {
    assert.equal(matchAdminDispatch("stats")?.kind, "stats");
    assert.equal(matchAdminDispatch("how are we doing today?")?.kind, "stats");
    assert.equal(matchAdminDispatch("A 12")?.approve, true);
    assert.equal(matchAdminDispatch("R 12")?.approve, false);
    assert.equal(matchAdminDispatch("menu"), null);
    assert.equal(matchAdminDispatch("please approve the red dress"), null);
  });

  it("answers stats from the snapshot", async () => {
    const reply = await handleAdminDispatch("stats", {
      snapshot: () => ({ activeUsers: 3, pendingEscrows: 2, todayVolumeKes: 4500 }),
      query: async () => ({ rows: [{ pending_approvals: 1 }] }),
    });
    assert.match(reply, /Active users: 3/);
    assert.match(reply, /KES 4,500/);
    assert.match(reply, /Pending approvals: 1/);
    assert.doesNotMatch(reply, /I can't help/);
  });

  it("approves through the claim, and says when the row is missing", async () => {
    let decision = null;
    const approved = await handleAdminDispatch("A 12", {
      canResolveLevel2: async () => true,
      resolve: async (id, choice) => {
        decision = { id, choice };
        return { ok: true, action: { orderId: "SKN-9", status: "APPROVED" } };
      },
    });
    assert.deepEqual(decision, { id: 12, choice: "APPROVE" });
    assert.match(approved, /APPROVED/);
    assert.doesNotMatch(approved, /QA12BC3456/);

    const missing = await handleAdminDispatch("user 0712345678", {
      lookupUser: async () => null,
    });
    assert.match(missing, /I do not have that record available/);
  });

  it("refuses to approve unless the sender is a super admin", async () => {
    let called = false;
    const reply = await handleAdminDispatch("A 12", {
      actorPhone: "254700000000",
      canResolveLevel2: async () => false,
      resolve: async () => {
        called = true;
        return { ok: true };
      },
    });
    assert.equal(called, false);
    assert.match(reply, /super admin/i);
    const body = src("./admin-dispatch.js");
    assert.match(body, /ADMIN_PHONE/);
    assert.match(body, /isSuperAdmin/);
  });

  it("shows the command list instead of a failure", async () => {
    const reply = await handleAdminDispatch("admin something odd");
    assert.match(reply, /stats/);
    assert.match(reply, /pending/);
    assert.equal(reply.includes("I can't help"), false);
    assert.match(adminCommandIndex(), /escrow <id>/);
  });

  it("does not call a model", () => {
    const body = src("./admin-dispatch.js");
    assert.doesNotMatch(body, /openai|anthropic|generateContent|chat\.completions/i);
    assert.match(body, /resolveAgentAction/);
    const fn = body.slice(body.indexOf("export async function handleAdminDispatch"));
    assert.doesNotMatch(fn, /err\.message/);
  });
});

describe("a non-admin who types admin", () => {
  it("is offered ordinary help", () => {
    assert.equal(isUnauthorizedAdminProbe("admin"), true);
    assert.equal(isUnauthorizedAdminProbe("/admin"), true);
    assert.equal(isUnauthorizedAdminProbe("#ops"), true);
    assert.equal(isUnauthorizedAdminProbe("A 12"), true);
    assert.equal(isUnauthorizedAdminProbe("please approve the colour"), false);
    assert.equal(isUnauthorizedAdminProbe("order SKN-1042"), false);
    assert.equal(isUnauthorizedAdminProbe("orders"), false);
    assert.equal(isUnauthorizedAdminProbe("1"), false);
    assert.doesNotMatch(PUBLIC_HELP_REPLY, /admin/i);
    assert.match(src("../handlers/webhookHandler.js"), /PUBLIC_HELP_REPLY/);
  });
});

describe("hallucinated output", () => {
  it("strips a receipt that was not in the verified context", () => {
    const dirty = sanitizeOutboundAgentText("Paid with QA12BC3456 for SKN-1042, KES 2500.");
    assert.match(dirty, /Transaction Code Pending/);
    assert.match(dirty, /SKN-1042/);
    assert.match(dirty, /KES 2500/);
    const kept = sanitizeOutboundAgentText("Paid with QA12BC3456.", { mpesaReceipts: ["QA12BC3456"] });
    assert.match(kept, /QA12BC3456/);
    const lower = sanitizeOutboundAgentText("Paid with qa12bc3456 for SKN-1042.");
    assert.match(lower, /Transaction Code Pending/);
    assert.doesNotMatch(lower, /qa12bc3456/i);
    assert.match(lower, /SKN-1042/);
    const phone = sanitizeOutboundAgentText("Blocked text mentioned 0712345678 and +254712345678.");
    assert.doesNotMatch(phone, /0712345678|254712345678/);
    assert.match(phone, /REDACTED_PHONE/);
    assert.match(sanitizeOutboundAgentText("Order SKN-1042 is KES 2500."), /SKN-1042/);
  });

  it("rejects an action outside the schema", () => {
    assert.equal(
      parseAgentActionOutput({
        actionType: "RELEASE_EVERYTHING",
        targetId: "1",
        reason: "now",
      }),
      null
    );
    const ok = parseAgentActionOutput(
      JSON.stringify({
        actionType: "QUEUE_LEVEL2_APPROVAL",
        targetId: "SKN-9",
        reason: "inspection ended",
        suggestedAmount: 2500,
      })
    );
    assert.equal(ok.actionType, "QUEUE_LEVEL2_APPROVAL");
    assert.equal(
      parseAgentActionOutput({
        actionType: "NOTIFY_SELLER",
        targetId: "1",
        reason: "ok",
        phone: "254700000000",
      }),
      null
    );
  });
});
