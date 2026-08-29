import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOverrideCommand,
  isMasterCommand,
  normalizeMasterCommand,
  stripOverridePrefix,
  adminRecognitionDirective,
  executeMasterAdminCommand,
  PUBLIC_ESCROW_GUARDRAIL,
} from "./admin-override.js";
import { buildGroundedSystemPrompt } from "./ai-prompts.js";
import { containsAdminCommand } from "./admin.js";
import { isAdminTokenValid, isMasterAdminToken } from "../lib/admin-auth.js";

describe("admin multi-layer obedience", () => {
  it("detects OVERRIDE: and bang short-codes", () => {
    assert.equal(isOverrideCommand("OVERRIDE: RELEASE SKN-8820"), true);
    assert.equal(isMasterCommand("!force-release SKN-8820"), true);
    assert.equal(isMasterCommand("FORCE_PAYOUT SKN-1001"), true);
    assert.equal(containsAdminCommand("!agent-mode MUTE 254712345678"), true);
    assert.equal(containsAdminCommand("hello"), false);
  });

  it("normalizes bang palette to internal verbs", () => {
    assert.equal(normalizeMasterCommand("!force-release SKN-8820"), "RELEASE SKN-8820");
    assert.equal(normalizeMasterCommand("FORCE_PAYOUT SKN-1049"), "RELEASE SKN-1049");
    assert.equal(normalizeMasterCommand("!system-pause"), "SYSTEM PAUSE");
    assert.equal(normalizeMasterCommand("!override-state SKN-1 completed"), "STATE SKN-1 completed");
    assert.equal(stripOverridePrefix("OVERRIDE: HELP"), "HELP");
  });

  it("returns help for !help", async () => {
    const r = await executeMasterAdminCommand("!help");
    assert.equal(r.ok, true);
    assert.match(r.reply, /force-release/i);
    assert.match(r.reply, /agent-mode/i);
  });

  it("rejects unknown bang with help hint", async () => {
    const r = await executeMasterAdminCommand("!launch-nukes");
    assert.equal(r.ok, false);
    assert.match(r.reply, /not recognized/i);
  });

  it("dual prompts: admin vs public escrow guardrail", () => {
    const d = adminRecognitionDirective({ founderName: "Test Founder" });
    assert.match(d, /EXECUTIVE ROLE DIRECTIVE/);
    assert.match(d, /CODE INTERCEPTOR/);
    assert.match(PUBLIC_ESCROW_GUARDRAIL, /strict escrow/i);

    const boss = buildGroundedSystemPrompt({ channel: "whatsapp", isAdmin: true });
    assert.match(boss, /EXECUTIVE ROLE DIRECTIVE/);
    assert.doesNotMatch(boss, /PUBLIC ESCROW GUARDRAIL/);

    const shopper = buildGroundedSystemPrompt({ channel: "whatsapp", isAdmin: false });
    assert.match(shopper, /PUBLIC ESCROW GUARDRAIL/);
    assert.doesNotMatch(shopper, /EXECUTIVE ROLE DIRECTIVE/);
  });

  it("MASTER_ADMIN_SECRET is accepted as admin token", () => {
    const prevM = process.env.MASTER_ADMIN_SECRET;
    const prevA = process.env.ADMIN_SETUP_TOKEN;
    process.env.MASTER_ADMIN_SECRET = "master-secret-test-xyz";
    process.env.ADMIN_SETUP_TOKEN = "setup-token-test-xyz";
    try {
      assert.equal(isMasterAdminToken("master-secret-test-xyz"), true);
      assert.equal(isAdminTokenValid("master-secret-test-xyz"), true);
      assert.equal(isAdminTokenValid("setup-token-test-xyz"), true);
      assert.equal(isAdminTokenValid("wrong"), false);
    } finally {
      if (prevM == null) delete process.env.MASTER_ADMIN_SECRET;
      else process.env.MASTER_ADMIN_SECRET = prevM;
      if (prevA == null) delete process.env.ADMIN_SETUP_TOKEN;
      else process.env.ADMIN_SETUP_TOKEN = prevA;
    }
  });
});
