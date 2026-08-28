/**
 * Static checks for AI latency routing, grounding prompt, RAG chunks, thread_id.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildChatProviderChain,
  chatTemperature,
  llmRouterMeta,
} from "../src/services/llm-router.js";
import {
  buildGroundedSystemPrompt,
  SOKONI_MASTER_RULES,
} from "../src/services/ai-prompts.js";
import { retrieveKnowledge, formatKnowledgeForPrompt } from "../src/services/agent-specialists.js";
import { threadIdFromPhone } from "../src/services/commerce-ops.js";
import { resolveThreadId } from "../src/services/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..", "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Temperature locked low
assert(chatTemperature() <= 0.35, "chat temperature must stay low");
assert(chatTemperature(0.55) <= 0.35, "override capped");

// Grounding prompt
const grounded = buildGroundedSystemPrompt({
  channel: "whatsapp",
  contextBlocks: ["KNOWLEDGE: Prepaid escrow only."],
  threadId: "254700000000",
});
assert(grounded.includes("CONTEXT DATA"), "has context block");
assert(grounded.includes("254700000000"), "has thread id");
assert(grounded.includes("ONLY use factual data") || SOKONI_MASTER_RULES.includes("ONLY use factual data"), "strict grounding");
assert(grounded.includes("escalate") || grounded.includes("escalate this to support") || SOKONI_MASTER_RULES.includes("escalate"), "escalation wording");

// Thread id = phone digits
assert(threadIdFromPhone("+254 700 000 000") === "254700000000", "threadIdFromPhone digits");
assert(resolveThreadId("254712345678") === "254712345678", "resolveThreadId");

// RAG chunks exist for escrow
const chunks = retrieveKnowledge("escrow prepaid m-pesa", { limit: 2, specialist: "buyer" });
assert(chunks.length >= 1, "knowledge retrieves escrow policy");
const block = formatKnowledgeForPrompt(chunks);
assert(block.includes("EXCLUSIVELY") || block.includes("KNOWLEDGE"), "knowledge format grounded");

// Router meta
const meta = llmRouterMeta();
assert(meta.avoid?.includes("ollama_local_cpu_queue"), "documents avoid ollama");
assert(Array.isArray(meta.providers), "providers listed");
assert(typeof meta.temperature === "number", "temperature in meta");

// Provider chain builds without throwing (may be empty without keys)
const chain = buildChatProviderChain();
assert(Array.isArray(chain), "provider chain is array");

// File markers
const agent = readFileSync(path.join(root, "whatsapp-bot/src/services/ai-agent.js"), "utf8");
assert(agent.includes("routedChatCompletion"), "ai-agent uses router");
assert(agent.includes("buildGroundedSystemPrompt"), "ai-agent uses grounded prompt");
assert(!agent.includes("temperature: conversational ? 0.55"), "no high conversational temp");

const schema = readFileSync(
  path.join(root, "whatsapp-bot/db/schema-phase16-pgvector-knowledge.sql"),
  "utf8"
);
assert(schema.includes("platform_knowledge"), "platform_knowledge table");

const migrate = readFileSync(path.join(root, "whatsapp-bot/src/db/migrate.js"), "utf8");
assert(migrate.includes("phase16"), "migrate includes phase16");

console.log("ai latency / grounding / RAG checks OK");
console.log("providers:", meta.providers.map((p) => p.name).join(",") || "(none — set GROQ/GEMINI/OPENAI keys)");
console.log("temperature:", meta.temperature);
