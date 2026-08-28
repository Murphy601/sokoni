/**
 * LiteLLM-style multi-provider chat routing for Sokoni Plug.
 * Prefer fast managed APIs (Groq → Gemini Flash) then OpenRouter free fallbacks.
 * Never use Ollama for multi-user WhatsApp (serial queue / 30–60s latency).
 *
 * Env:
 *   AI_CHAT_PROVIDER=auto|groq|gemini|openrouter
 *   GROQ_API_KEY + GROQ_MODEL (default llama-3.1-8b-instant)
 *   GEMINI_API_KEY + GEMINI_CHAT_MODEL (default gemini-2.0-flash)
 *   OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL (OpenRouter)
 *   AI_CHAT_TEMPERATURE (default 0.15)
 */
import OpenAI from "openai";
import { config } from "../config.js";

const OPENROUTER_FREE = ["openrouter/free", "google/gemma-4-26b-a4b-it:free"];

/** Deterministic answers — never use high temp for Plug chat. */
export function chatTemperature(override) {
  if (override != null && Number.isFinite(Number(override))) {
    return Math.min(0.35, Math.max(0, Number(override)));
  }
  const t = Number(config.aiChat?.temperature);
  return Number.isFinite(t) ? Math.min(0.35, Math.max(0, t)) : 0.15;
}

function providerPreference() {
  const raw = String(config.aiChat?.provider || "auto").trim().toLowerCase();
  if (["groq", "gemini", "openrouter"].includes(raw)) return raw;
  return "auto";
}

/**
 * Ordered provider attempts: { name, client, models[] }
 */
export function buildChatProviderChain() {
  const pref = providerPreference();
  const chain = [];

  const groqKey = config.groq?.apiKey;
  const geminiKey = config.gemini?.apiKey;
  const openrouterKey = config.openai?.apiKey;

  const pushGroq = () => {
    if (!groqKey) return;
    chain.push({
      name: "groq",
      client: new OpenAI({
        apiKey: groqKey,
        baseURL: config.groq.baseUrl || "https://api.groq.com/openai/v1",
        timeout: 20_000,
      }),
      models: [config.groq.model || "llama-3.1-8b-instant"].filter(Boolean),
    });
  };

  const pushGemini = () => {
    if (!geminiKey) return;
    chain.push({
      name: "gemini",
      client: new OpenAI({
        apiKey: geminiKey,
        baseURL:
          config.gemini.chatBaseUrl ||
          "https://generativelanguage.googleapis.com/v1beta/openai/",
        timeout: 25_000,
      }),
      models: [
        config.gemini.chatModel || "gemini-2.0-flash",
        "gemini-1.5-flash",
      ].filter(Boolean),
    });
  };

  const pushOpenRouter = () => {
    if (!openrouterKey) return;
    const models = [
      ...new Set(
        [config.openai.model, ...(config.openai.modelFallbacks || []), ...OPENROUTER_FREE].filter(
          Boolean
        )
      ),
    ];
    chain.push({
      name: "openrouter",
      client: new OpenAI({
        apiKey: openrouterKey,
        baseURL: config.openai.baseUrl || "https://openrouter.ai/api/v1",
        timeout: 35_000,
        defaultHeaders: {
          "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
          "X-Title": config.brand.name,
        },
      }),
      models,
    });
  };

  if (pref === "groq") {
    pushGroq();
    pushGemini();
    pushOpenRouter();
  } else if (pref === "gemini") {
    pushGemini();
    pushGroq();
    pushOpenRouter();
  } else if (pref === "openrouter") {
    pushOpenRouter();
  } else {
    // auto: fastest managed APIs first
    pushGroq();
    pushGemini();
    pushOpenRouter();
  }

  return chain;
}

/** @deprecated use buildChatProviderChain — kept for meta/tests */
export function litellmModelChain() {
  return buildChatProviderChain().flatMap((p) => p.models.map((m) => `${p.name}:${m}`));
}

export function getLitellmClient() {
  const chain = buildChatProviderChain();
  return chain[0]?.client || null;
}

/**
 * Chat completion with multi-provider failover (Groq → Gemini → OpenRouter).
 * Default temperature 0.15 for consistent WhatsApp replies.
 */
export async function routedChatCompletion(
  messages,
  { maxTokens = 180, temperature = chatTemperature() } = {}
) {
  const chain = buildChatProviderChain();
  if (!chain.length) throw new Error("No API key (set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY)");

  let lastError = null;
  for (const provider of chain) {
    for (const model of provider.models) {
      try {
        const response = await provider.client.chat.completions.create({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: chatTemperature(temperature),
        });
        const content = response.choices[0]?.message?.content;
        if (content && String(content).trim()) {
          return {
            content: String(content).trim(),
            model,
            provider: provider.name,
            temperature: chatTemperature(temperature),
          };
        }
      } catch (err) {
        lastError = err;
        console.warn(
          `[llm-router] ${provider.name}/${model} failed:`,
          err.error?.message || err.message
        );
      }
    }
  }
  throw lastError || new Error("All chat providers failed");
}

export function llmRouterMeta() {
  const chain = buildChatProviderChain();
  return {
    style: "litellm-compatible-multi-provider",
    providerPreference: providerPreference(),
    providers: chain.map((p) => ({ name: p.name, models: p.models })),
    temperature: chatTemperature(),
    costTarget: "fast_managed_then_free",
    avoid: ["ollama_local_cpu_queue"],
    note: "Prefer GROQ_API_KEY or GEMINI_API_KEY for sub-second WhatsApp replies under load.",
  };
}
