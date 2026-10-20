/**
 * Provider adapters for MAS routes. Fail-soft; never throw to callers.
 * Does not replace primary Cloudinary / Groq / listing-generator paths.
 */
import OpenAI from "openai";
import { config } from "../../config.js";
import { runHeuristic } from "./heuristics.js";

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("mas_timeout")), ms)),
  ]);
}

function nvidiaClient() {
  const key = config.nvidia?.apiKey?.trim();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: config.nvidia.baseUrl || "https://integrate.api.nvidia.com/v1",
    timeout: 15_000,
  });
}

function openrouterClient() {
  const key = config.openai?.apiKey?.trim();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: config.openai.baseUrl || "https://openrouter.ai/api/v1",
    timeout: 15_000,
    defaultHeaders: {
      "HTTP-Referer": config.publicSiteUrl || "http://localhost:3001",
      "X-Title": `${config.brand?.name || "Sokoni"} MAS`,
    },
  });
}

function groqClient() {
  const key = config.groq?.apiKey?.trim();
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: config.groq.baseUrl || "https://api.groq.com/openai/v1",
    timeout: 12_000,
  });
}

async function chatComplete(client, model, messages, { maxTokens = 400, temperature = 0.1 } = {}) {
  const res = await client.chat.completions.create({
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  });
  const content = res.choices?.[0]?.message?.content;
  if (!content) throw new Error("empty_completion");
  return String(content).trim();
}

function visionMessages(payload, instruction) {
  const text = String(payload.text || payload.prompt || instruction).slice(0, 4000);
  const imageUrl = payload.imageUrl || payload.url || null;
  const content = [{ type: "text", text }];
  if (imageUrl) {
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  return [{ role: "user", content }];
}

export async function callProviderRoute(route, task, payload, { timeoutMs = 2000 } = {}) {
  const provider = String(route.provider || "").toLowerCase();
  const model = route.model || "";

  if (provider === "stub") {
    return {
      ok: false,
      degraded: true,
      stub: true,
      provider: "stub",
      model,
      task,
      message: `Capability ${task} not live on this host (stub:${model}). Primary Sokoni path unchanged.`,
    };
  }

  if (provider === "heuristic") {
    return { ...runHeuristic(model, payload), task };
  }

  if (provider === "nvidia") {
    const client = nvidiaClient();
    if (!client) throw new Error("nvidia_key_missing");
    const instruction =
      payload.systemHint ||
      `Sokoni MAS task ${task}. Reply briefly with JSON when possible. Kenya marketplace context.`;
    const messages = payload.imageUrl
      ? visionMessages(payload, instruction)
      : [
          { role: "system", content: instruction },
          { role: "user", content: String(payload.text || payload.content || JSON.stringify(payload)).slice(0, 6000) },
        ];
    const content = await withTimeout(
      chatComplete(client, model, messages, { maxTokens: payload.maxTokens || 400 }),
      timeoutMs
    );
    return { ok: true, provider: "nvidia", model, task, content };
  }

  if (provider === "openrouter") {
    const client = openrouterClient();
    if (!client) throw new Error("openrouter_key_missing");

    // Embeddings path
    if (/embed/i.test(model) || task === "TEXT_EMBED") {
      const input = String(payload.text || "").slice(0, 8000);
      if (!input) throw new Error("embed_empty");
      const emb = await withTimeout(
        client.embeddings.create({ model, input }),
        timeoutMs
      );
      const vector = emb.data?.[0]?.embedding;
      if (!vector?.length) throw new Error("embed_empty_result");
      return { ok: true, provider: "openrouter", model, task, embedding: vector, dims: vector.length };
    }

    // Audio STT — OpenAI-compatible audio transcription when buffer present
    if (payload.audioBuffer && /whisper/i.test(model)) {
      const file = new File([payload.audioBuffer], payload.filename || "audio.ogg", {
        type: payload.mimeType || "audio/ogg",
      });
      const tr = await withTimeout(
        client.audio.transcriptions.create({ model, file }),
        Math.max(timeoutMs, 15_000)
      );
      const text = String(tr.text || "").trim();
      if (!text) throw new Error("stt_empty");
      return { ok: true, provider: "openrouter", model, task, text };
    }

    const instruction = payload.systemHint || `Sokoni MAS task ${task}. Be brief.`;
    const messages = payload.imageUrl
      ? visionMessages(payload, instruction)
      : [
          { role: "system", content: instruction },
          { role: "user", content: String(payload.text || payload.content || "").slice(0, 6000) },
        ];
    const content = await withTimeout(
      chatComplete(client, model, messages, { maxTokens: payload.maxTokens || 400 }),
      timeoutMs
    );
    return { ok: true, provider: "openrouter", model, task, content };
  }

  if (provider === "groq") {
    const client = groqClient();
    if (!client) throw new Error("groq_key_missing");

    if (payload.audioBuffer && /whisper/i.test(model)) {
      const file = new File([payload.audioBuffer], payload.filename || "audio.ogg", {
        type: payload.mimeType || "audio/ogg",
      });
      const tr = await withTimeout(
        client.audio.transcriptions.create({ model, file }),
        Math.max(timeoutMs, 12_000)
      );
      const text = String(tr.text || "").trim();
      if (!text) throw new Error("stt_empty");
      return { ok: true, provider: "groq", model, task, text };
    }

    const instruction = payload.systemHint || `Sokoni MAS task ${task}. Brief JSON/text only.`;
    const content = await withTimeout(
      chatComplete(
        client,
        model,
        [
          { role: "system", content: instruction },
          { role: "user", content: String(payload.text || payload.content || "").slice(0, 6000) },
        ],
        { maxTokens: payload.maxTokens || 400 }
      ),
      timeoutMs
    );
    return { ok: true, provider: "groq", model, task, content };
  }

  throw new Error(`unknown_provider:${provider}`);
}
