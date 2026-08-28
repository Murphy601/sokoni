/**
 * LiteLLM-style model routing for Sokoni Plug.
 * Uses OpenRouter (OpenAI-compatible) with a free-tier-first chain — no separate LiteLLM process required.
 * Env: OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_MODEL_FALLBACKS
 */
import OpenAI from "openai";
import { config } from "../config.js";

const FREE_FALLBACKS = ["google/gemma-4-26b-a4b-it:free", "openrouter/free"];

let client = null;

export function litellmModelChain() {
  const primary = config.openai.model?.trim();
  const configured = config.openai.modelFallbacks || [];
  return [...new Set([primary, ...configured, ...FREE_FALLBACKS].filter(Boolean))];
}

export function getLitellmClient() {
  if (!config.openai.apiKey) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl,
      timeout: 35_000,
      defaultHeaders: {
        "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
        "X-Title": config.brand.name,
      },
    });
  }
  return client;
}

/**
 * Chat completion with sequential failover across the model chain (LiteLLM routing pattern).
 */
export async function routedChatCompletion(messages, { maxTokens = 180, temperature = 0.2 } = {}) {
  const openai = getLitellmClient();
  if (!openai) throw new Error("No API key");

  let lastError = null;
  for (const model of litellmModelChain()) {
    try {
      const response = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
      });
      const content = response.choices[0]?.message?.content;
      if (content && String(content).trim()) {
        return { content: String(content).trim(), model, provider: "openrouter-litellm-style" };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[llm-router] ${model} failed:`, err.error?.message || err.message);
    }
  }
  throw lastError || new Error("All models failed");
}

export function llmRouterMeta() {
  return {
    style: "litellm-compatible",
    provider: "openrouter",
    baseUrl: config.openai.baseUrl,
    models: litellmModelChain(),
    costTarget: "free_tier_first",
  };
}
