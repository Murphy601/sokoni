import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isMasterCommand,
  normalizeMasterCommand,
  softMapSpokenToMasterCommand,
  adminRecognitionDirective,
  executeMasterAdminCommand,
} from "./admin-override.js";
import { staffCan, staffToneDirective } from "./staff-roles.js";
import { formatDisputeActionCard } from "./dispute-admin-actions.js";
import { buildGroundedSystemPrompt } from "./ai-prompts.js";

describe("executive AI OS", () => {
  it("maps bang + spoken Boss phrases to interceptor commands", () => {
    assert.equal(normalizeMasterCommand("!brief"), "BRIEF");
    assert.equal(isMasterCommand("!brief"), true);
    assert.equal(
      softMapSpokenToMasterCommand("Hey, override escrow for order SKN-8820 and pay the seller"),
      "!force-release SKN-8820"
    );
    assert.equal(softMapSpokenToMasterCommand("system pause please"), "!system-pause");
    assert.equal(softMapSpokenToMasterCommand("give me the morning briefing"), "!brief");
  });

  it("RBAC: SUPER_ADMIN unlimited; DISPUTE_MANAGER capped; SUPPORT blocked on release", () => {
    assert.equal(staffCan("release", { role: "SUPER_ADMIN" }, { amountKes: 999999 }), true);
    assert.equal(staffCan("release", { role: "DISPUTE_MANAGER" }, { amountKes: 8500 }), true);
    assert.equal(staffCan("release", { role: "DISPUTE_MANAGER" }, { amountKes: 50000 }), false);
    assert.equal(staffCan("system_pause", { role: "SUPPORT_AGENT" }), false);
    assert.equal(staffCan("agent_mode", { role: "SUPPORT_AGENT" }), true);
    assert.equal(staffCan("brief", { role: "LOGISTICS_LEAD" }), true);
  });

  it("executive directive mentions role verification", () => {
    const d = adminRecognitionDirective({
      staff: { role: "SUPER_ADMIN", displayName: "Boss" },
      senderPhone: "254757764009",
    });
    assert.match(d, /CRITICAL EXECUTIVE DIRECTIVE|EXECUTIVE DIRECTIVE/);
    assert.match(d, /Yes, Boss/i);
    assert.match(d, /254757764009/);
    assert.match(staffToneDirective({ role: "DISPUTE_MANAGER" }), /DISPUTE_MANAGER/);
  });

  it("dispute action card is numbered 1–4", () => {
    const card = formatDisputeActionCard({
      orderId: "SKN-9912",
      amountKes: 8500,
      buyerPhone: "+254712…",
      sellerPhone: "+254722…",
      issueType: "damaged screen",
    });
    assert.match(card, /DISPUTE ALERT: SKN-9912/);
    assert.match(card, /\*1\* Refund Buyer/);
    assert.match(card, /\*2\* Release to Seller/);
    assert.match(card, /\*3\* Split/);
  });

  it("!help still returns palette including brief", async () => {
    const r = await executeMasterAdminCommand("!help", { actorPhone: "254700000000" });
    assert.equal(r.ok, true);
    assert.match(r.reply, /brief/i);
  });

  it("shopper prompt keeps escrow guardrail; admin gets executive directive", () => {
    const shopper = buildGroundedSystemPrompt({ channel: "whatsapp", isAdmin: false });
    assert.match(shopper, /PUBLIC ESCROW GUARDRAIL/);
    const boss = buildGroundedSystemPrompt({
      channel: "whatsapp",
      isAdmin: true,
      staff: { role: "SUPER_ADMIN", displayName: "Boss" },
      senderPhone: "254757764009",
    });
    assert.match(boss, /CRITICAL EXECUTIVE DIRECTIVE|EXECUTIVE DIRECTIVE/);
    assert.match(boss, /Yes, Boss/i);
  });
});
