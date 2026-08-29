import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SOKONI_MASTER_RULES,
  SOKONI_MVP_LOGISTICS_FACTS,
  buildGroundedSystemPrompt,
  WHATSAPP_SYSTEM_PROMPT,
} from "./ai-prompts.js";

describe("ai-prompts MVP training", () => {
  it("teaches command handoff and never-execute rule", () => {
    assert.match(SOKONI_MASTER_RULES, /COMMANDS ARE NOT YOURS/);
    assert.match(SOKONI_MASTER_RULES, /ACCEPT SKN-1234/);
    assert.match(SOKONI_MASTER_RULES, /PICKUP SKN-1234/);
    assert.match(SOKONI_MASTER_RULES, /CONFIRM SKN-1234/);
  });

  it("includes MVP logistics stable facts", () => {
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /auto-pins riders/i);
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /Vendor\/Pickup OTP/);
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /WAYBILL/);
    assert.match(SOKONI_MVP_LOGISTICS_FACTS, /Always KES/);
    assert.match(WHATSAPP_SYSTEM_PROMPT, /MVP logistics/);
  });

  it("buildGroundedSystemPrompt injects context and Layer 2 instructions", () => {
    const prompt = buildGroundedSystemPrompt({
      channel: "whatsapp",
      contextBlocks: ["Active orders: [SKN-1001]"],
      threadId: "254700000000@c.us",
    });
    assert.match(prompt, /Active orders: \[SKN-1001\]/);
    assert.match(prompt, /254700000000@c\.us/);
    assert.match(prompt, /Layer 2/);
    assert.match(prompt, /exact command format/);
  });
});
