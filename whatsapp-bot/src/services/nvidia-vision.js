/**
 * NVIDIA NIM vision — OpenAI-compatible API (build.nvidia.com).
 * Fallback for seller listing photo → JSON when OpenRouter is out of tokens/quota.
 * Picks randomly from a free VLM pool and tries a few until one returns JSON.
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { normalizeGeminiListingJson } from "./gemini-vision.js";

/** Curated free VLMs that accept image_url on integrate.api.nvidia.com */
const DEFAULT_NVIDIA_VLMS = [
  "meta/llama-3.2-11b-vision-instruct",
  "meta/llama-3.2-90b-vision-instruct",
  "microsoft/phi-3.5-vision-instruct",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
  "nvidia/neva-22b",
];

let nvidiaClient = null;
let cachedModelIds = null;
let cachedModelAt = 0;

export function nvidiaVisionAvailable() {
  return Boolean(config.nvidia?.apiKey?.trim());
}

function getNvidiaClient() {
  const apiKey = config.nvidia?.apiKey?.trim();
  if (!apiKey) return null;
  if (!nvidiaClient) {
    nvidiaClient = new OpenAI({
      apiKey,
      baseURL: config.nvidia.baseUrl || "https://integrate.api.nvidia.com/v1",
    });
  }
  return nvidiaClient;
}

function configuredPool() {
  const fromEnv = config.nvidia?.visionModels || [];
  if (fromEnv.length) return fromEnv;
  return DEFAULT_NVIDIA_VLMS;
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function looksLikeVisionModel(id) {
  const s = String(id || "").toLowerCase();
  // Skip embeddings / OCR / audio — we need chat VLMs that accept image_url.
  if (/embed|retriever|parse|rerank|tts|asr|guard|whisper/.test(s)) return false;
  return /vision|vlm|(^|\/)vl-|neva|paligemma|vila|nemotron-nano-vl|phi-3\.5-vision|phi-3-vision|llava|qwen2\.5-vl|qwen2-vl/.test(
    s
  );
}

/** Optionally refresh pool from NVIDIA /models (vision-ish ids only). */
async function resolveModelPool(client) {
  const maxAgeMs = 30 * 60 * 1000;
  if (cachedModelIds && Date.now() - cachedModelAt < maxAgeMs) {
    return cachedModelIds;
  }

  const base = configuredPool();
  try {
    const listed = await client.models.list();
    const ids = (listed?.data || [])
      .map((m) => m.id)
      .filter((id) => typeof id === "string" && looksLikeVisionModel(id));
    if (ids.length >= 2) {
      // Prefer overlap with curated list, then other vision ids.
      const preferred = base.filter((id) => ids.includes(id));
      const extras = ids.filter((id) => !preferred.includes(id));
      cachedModelIds = [...preferred, ...extras].slice(0, 40);
      cachedModelAt = Date.now();
      return cachedModelIds;
    }
  } catch (err) {
    console.warn("[nvidia-vision] models.list failed — using curated pool:", err.message);
  }

  cachedModelIds = base;
  cachedModelAt = Date.now();
  return cachedModelIds;
}

/**
 * Try a few random free NVIDIA VLMs until one returns listing JSON.
 * @param {{ prompt: string, imageBuffer: Buffer, mimeType?: string }} opts
 */
export async function nvidiaVisionListingJson({ prompt, imageBuffer, mimeType }) {
  const client = getNvidiaClient();
  if (!client) throw new Error("NVIDIA_API_KEY not set");

  const pool = await resolveModelPool(client);
  const maxAttempts = Math.min(
    Number(config.nvidia?.maxAttempts) || 4,
    pool.length || 1
  );
  const order = shuffle(pool).slice(0, maxAttempts);
  const dataUrl = `data:${mimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;
  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  let lastError = null;
  for (const model of order) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 1200,
        temperature: 0.1,
      });
      const raw = response.choices[0]?.message?.content?.trim() || "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("no JSON in response");
      const parsed = normalizeGeminiListingJson(JSON.parse(jsonMatch[0]));
      return { parsed, model };
    } catch (err) {
      lastError = err;
      console.warn(`[nvidia-vision] ${model} failed:`, err.message);
    }
  }

  throw lastError || new Error("NVIDIA vision: all models failed");
}
