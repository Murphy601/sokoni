/**
 * LiteLLM-style multi-provider chat routing for Sokoni Plug.
 * Prefer fast managed APIs (Groq → OpenRouter free). Gemini chat is opt-in only.
 * Never use Ollama for multi-user WhatsApp (serial queue / 30–60s latency).
 *
 * Env:
 *   AI_CHAT_PROVIDER=auto|groq|gemini|openrouter
 *   GROQ_API_KEY + GROQ_MODEL (default openai/gpt-oss-20b)
 *   AI_CHAT_USE_GEMINI=true + GEMINI_API_KEY to include Gemini in chat failover
 *   OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL (OpenRouter)
 *   AI_CHAT_TEMPERATURE (default 0.15)
 */
import OpenAI from "openai";
import { config } from "../config.js";

const OPENROUTER_FREE = ["openrouter/free", "google/gemma-4-31b-it:free"];
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

/** gpt-oss on Groq may emit built-in browser_search — steer + tool_choice none.
 * Do NOT use tool_choice=auto: Sokoni runs lookups server-side and never sends tools
 * to the LLM; auto would enable Groq browser_search and break grounding.
 */
const GROQ_PLAIN_TEXT_NUDGE =
  "OUTPUT RULE: Reply with plain customer-facing text only. Do not call browser_search, code_interpreter, functions, or any API tools — lookups already ran server-side.";

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

/** Vision GEMINI_API_KEY alone must not enter the chat chain (causes 400 noise). */
function shouldUseGeminiForChat() {
  const pref = providerPreference();
  if (pref === "gemini") return true;
  return Boolean(config.aiChat?.useGemini);
}

function groqModels() {
  const primary = config.groq?.model || DEFAULT_GROQ_MODEL;
  const fallbacks = Array.isArray(config.groq?.modelFallbacks)
    ? config.groq.modelFallbacks
    : [];
  return [...new Set([primary, ...fallbacks].filter(Boolean))];
}

function isGptOssModel(model) {
  return /gpt-oss/i.test(String(model || ""));
}

export function isToolUseFailedError(err) {
  const code = err?.error?.code || err?.code;
  const msg = String(err?.error?.message || err?.message || "");
  return (
    code === "tool_use_failed" ||
    /tool_use_failed/i.test(msg) ||
    /tool choice is none.*called a tool/i.test(msg)
  );
}

/** Recover plain text from Groq failed_generation when present (skip tool payloads). */
export function extractFailedGenerationText(err) {
  const raw = err?.error?.failed_generation ?? err?.failed_generation;
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw.trim() : String(raw).trim();
  if (!s) return null;
  if (
    /browser_search|code_interpreter|<function\b|^\s*\{\s*"name"\s*:/i.test(s) ||
    s.startsWith("<")
  ) {
    return null;
  }
  // JSON tool-call blobs are not shopper replies
  if (s.startsWith("{") && /"name"\s*:/.test(s)) return null;
  return s;
}

function withPlainTextNudge(messages, { strong = false } = {}) {
  const nudge = strong
    ? `${GROQ_PLAIN_TEXT_NUDGE} Do not emit tool_calls. Answer now from CONTEXT / LOOKUP RESULTS only.`
    : GROQ_PLAIN_TEXT_NUDGE;
  const msgs = (messages || []).map((m) => ({ ...m }));
  const sysIdx = msgs.findIndex((m) => m.role === "system");
  if (sysIdx >= 0) {
    const prev = String(msgs[sysIdx].content || "");
    if (strong || !prev.includes("browser_search")) {
      msgs[sysIdx] = { ...msgs[sysIdx], content: `${prev}\n\n${nudge}` };
    }
  } else {
    msgs.unshift({ role: "system", content: nudge });
  }
  return msgs;
}

function buildCompletionParams(provider, model, messages, maxTokens, temperature, { strongPlain = false } = {}) {
  const params = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: chatTemperature(temperature),
  };
  if (provider.name === "groq") {
    // gpt-oss may still attempt built-in tools; none + prompt steer reduces 400s
    params.tool_choice = "none";
    if (isGptOssModel(model) || strongPlain) {
      params.messages = withPlainTextNudge(messages, { strong: strongPlain });
    }
  }
  return params;
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
      models: groqModels(),
    });
  };

  const pushGemini = () => {
    if (!geminiKey || !shouldUseGeminiForChat()) return;
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
    pushOpenRouter();
    pushGemini();
  } else if (pref === "gemini") {
    pushGemini();
    pushGroq();
    pushOpenRouter();
  } else if (pref === "openrouter") {
    pushOpenRouter();
  } else {
    // auto: Groq (fast) → OpenRouter (already on VM). Gemini only if explicitly enabled.
    pushGroq();
    pushOpenRouter();
    pushGemini();
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

function successPayload(content, model, provider, temperature) {
  return {
    content: String(content).trim(),
    model,
    provider: provider.name,
    temperature: chatTemperature(temperature),
  };
}

/**
 * Chat completion with multi-provider failover (Groq → OpenRouter; Gemini opt-in).
 * Default temperature 0.15 for consistent WhatsApp replies.
 */
export async function routedChatCompletion(
  messages,
  { maxTokens = 180, temperature = chatTemperature() } = {}
) {
  const chain = buildChatProviderChain();
  if (!chain.length) {
    throw new Error(
      "No API key (set GROQ_API_KEY or OPENAI_API_KEY; Gemini chat needs AI_CHAT_USE_GEMINI=true)"
    );
  }

  let lastError = null;
  for (const provider of chain) {
    for (const model of provider.models) {
      try {
        const response = await provider.client.chat.completions.create(
          buildCompletionParams(provider, model, messages, maxTokens, temperature)
        );
        const content = response.choices[0]?.message?.content;
        if (content && String(content).trim()) {
          return successPayload(content, model, provider, temperature);
        }
      } catch (err) {
        lastError = err;
        const msg = err.error?.message || err.message;
        console.warn(`[llm-router] ${provider.name}/${model} failed:`, msg);

        // gpt-oss sometimes still emits built-in tools under tool_choice=none
        if (provider.name === "groq" && isToolUseFailedError(err)) {
          const recovered = extractFailedGenerationText(err);
          if (recovered) {
            console.warn(
              `[llm-router] ${provider.name}/${model} recovered plain text from failed_generation`
            );
            return successPayload(recovered, model, provider, temperature);
          }
          try {
            console.warn(
              `[llm-router] ${provider.name}/${model} tool_use_failed — retrying with stronger plain-text nudge`
            );
            const retry = await provider.client.chat.completions.create(
              buildCompletionParams(provider, model, messages, maxTokens, temperature, {
                strongPlain: true,
              })
            );
            const content = retry.choices[0]?.message?.content;
            if (content && String(content).trim()) {
              return successPayload(content, model, provider, temperature);
            }
          } catch (retryErr) {
            lastError = retryErr;
            console.warn(
              `[llm-router] ${provider.name}/${model} plain-text retry failed:`,
              retryErr.error?.message || retryErr.message
            );
          }
        }
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
    avoid: ["ollama_local_cpu_queue", "groq_builtin_tools_for_chat"],
    note: "Prefer GROQ_API_KEY (openai/gpt-oss-20b) with tool_choice=none. Gemini chat is opt-in.",
  };
}
