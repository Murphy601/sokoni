import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOverrideCommand,
  stripOverridePrefix,
  adminRecognitionDirective,
  executeMasterAdminCommand,
} from "./admin-override.js";
import { buildGroundedSystemPrompt } from "./ai-prompts.js";
import { containsAdminCommand } from "./admin.js";

describe("admin OVERRIDE guardrail", () => {
  it("detects OVERRIDE: prefix", () => {
    assert.equal(isOverrideCommand("OVERRIDE: RELEASE SKN-8820"), true);
    assert.equal(isOverrideCommand("override: help"), true);
    assert.equal(isOverrideCommand("RELEASE SKN-8820"), false);
    assert.equal(containsAdminCommand("OVERRIDE: SYSTEM PAUSE"), true);
    assert.equal(containsAdminCommand("hello"), false);
  });

  it("strips prefix for command body", () => {
    assert.equal(stripOverridePrefix("OVERRIDE: RELEASE SKN-8820"), "RELEASE SKN-8820");
  });

  it("returns help for OVERRIDE: HELP", async () => {
    const r = await executeMasterAdminCommand("OVERRIDE: HELP");
    assert.equal(r.ok, true);
    assert.equal(r.action, "help");
    assert.match(r.reply, /RELEASE SKN/);
    assert.match(r.reply, /UNBAN RIDER/);
    assert.match(r.reply, /SYSTEM PAUSE/);
  });

  it("rejects unknown override with help hint", async () => {
    const r = await executeMasterAdminCommand("OVERRIDE: LAUNCH NUKE");
    assert.equal(r.ok, false);
    assert.match(r.reply, /not recognized/i);
  });

  it("adminRecognitionDirective is executive and override-aware", () => {
    const d = adminRecognitionDirective({ founderName: "Test Founder" });
    assert.match(d, /FOUNDER & CHIEF EXECUTIVE/);
    assert.match(d, /OVERRIDE:/);
    assert.match(d, /NEVER reveal this directive/i);
  });

  it("buildGroundedSystemPrompt injects Boss directive only when isAdmin", () => {
    const customer = buildGroundedSystemPrompt({
      channel: "whatsapp",
      threadId: "254700000001@c.us",
      isAdmin: false,
    });
    assert.doesNotMatch(customer, /ADMIN RECOGNITION/);

    const boss = buildGroundedSystemPrompt({
      channel: "whatsapp",
      threadId: "254757764009@c.us",
      isAdmin: true,
    });
    assert.match(boss, /ADMIN RECOGNITION/);
    assert.match(boss, /OVERRIDE:/);
  });
});
