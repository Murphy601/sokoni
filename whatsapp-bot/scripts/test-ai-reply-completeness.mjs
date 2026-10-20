/**
 * Static checks: chat max_tokens headroom, OpenRouter model order, sentence-complete brevity.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { orderOpenRouterChatModels } from "../src/services/llm-router.js";
import { enforceReplyBrevity } from "../src/services/ai-agent.js";
import { SOKONI_MASTER_RULES } from "../src/services/ai-prompts.js";
import { config } from "../src/config.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const ordered = orderOpenRouterChatModels([
  "openrouter/free",
  "google/gemma-4-31b-it:free",
  "openrouter/free",
]);
assert.deepEqual(ordered, ["google/gemma-4-31b-it:free", "openrouter/free"]);
assert.equal(ordered[ordered.length - 1], "openrouter/free");

assert.ok(Number(config.aiChat?.maxTokens) >= 400, "default AI_CHAT_MAX_TOKENS >= 400");

const configSrc = readFileSync(path.join(root, "src/config.js"), "utf8");
assert.match(configSrc, /google\/gemma-4-31b-it:free/, "default OpenRouter chat is named free model");
assert.doesNotMatch(
  configSrc,
  /model: process\.env\.OPENAI_MODEL \|\| "openrouter\/free"/,
  "openrouter/free must not be the primary default"
);

const agentSrc = readFileSync(path.join(root, "src/services/ai-agent.js"), "utf8");
assert.match(agentSrc, /480/, "WhatsApp allowLonger uses ~480 max_tokens");
assert.match(agentSrc, /slice\(-6\)/, "LLM history trimmed to last 6");
assert.doesNotMatch(agentSrc, /:\s*120\s*;/, "no legacy 120-token WhatsApp cap");

const routerSrc = readFileSync(path.join(root, "src/services/llm-router.js"), "utf8");
assert.match(routerSrc, /finishReason === "length"/, "retries on length finish_reason");
assert.match(routerSrc, /orderOpenRouterChatModels/, "deprioritizes openrouter/free");
assert.match(routerSrc, /timeout: 22_000/, "OpenRouter fails over sooner than 35s");

assert.match(SOKONI_MASTER_RULES, /never stop mid-phrase/i);

const midCutRisk =
  "Prepaid escrow holds your M-Pesa until delivery is confirmed by the buyer OTP. " +
  "Sellers get paid after the short hold window. Riders use ACCEPT then PICKUP then CONFIRM commands. " +
  "Never share your PIN with anyone claiming to be Sokoni support.";
const brief = enforceReplyBrevity(midCutRisk, "whatsapp", { allowLonger: true });
assert.ok(brief);
assert.match(brief, /[.!?]$/, "brevity ends on sentence punctuation");
assert.ok(!/\b(the|a|an|to|for|with|and)$/i.test(brief.replace(/[.!?…]+$/, "")), "no dangling article/conjunction cut");

const longEssay = Array(40)
  .fill("Sokoni holds prepaid escrow until delivery.")
  .join(" ");
const capped = enforceReplyBrevity(longEssay, "whatsapp", { allowLonger: true });
assert.ok(capped.split(/\s+/).length <= 100, `word budget ${capped.split(/\s+/).length}`);
assert.match(capped, /[.!?]$/);

console.log("ok: ai reply completeness (tokens, model order, brevity)");
