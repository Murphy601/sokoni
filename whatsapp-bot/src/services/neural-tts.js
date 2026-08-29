/**
 * Neural TTS for Ask Voice / Zara-style replies.
 * Provider chain (first success wins):
 *   1. ElevenLabs (ELEVENLABS_API_KEY)
 *   2. Cartesia Sonic (CARTESIA_API_KEY)
 *   3. Hugging Face Inference / custom Kokoro proxy (HUGGINGFACE / NEURAL_TTS_HF_URL)
 * Returns null → client should use browser speechSynthesis.
 * Keys stay server-side only — never expose in static HTML.
 */
import { config } from "../config.js";

const DEFAULT_ELEVEN_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel — warm conversational
const DEFAULT_ELEVEN_MODEL = "eleven_turbo_v2";
const DEFAULT_CARTESIA_MODEL = "sonic-english";
const DEFAULT_CARTESIA_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091"; // soft female

/**
 * @returns {{ providers: string[], maxChars: number, configured: boolean }}
 */
export function neuralTtsMeta() {
  const tts = config.neuralTts || {};
  const providers = [];
  if (tts.elevenLabs?.apiKey) providers.push("elevenlabs");
  if (tts.cartesia?.apiKey) providers.push("cartesia");
  if (tts.huggingface?.apiKey || tts.huggingface?.url) providers.push("huggingface");
  return {
    providers,
    maxChars: tts.maxChars || 400,
    configured: providers.length > 0,
    preferred: tts.preferred || "auto",
  };
}

function clampText(raw, maxChars) {
  const t = String(raw || "")
    .replace(/\*+/g, "")
    .replace(/[_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "";
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (lastStop > 40 ? cut.slice(0, lastStop + 1) : cut).trim();
}

/**
 * @param {string} text
 * @returns {Promise<{ buffer: Buffer, contentType: string, provider: string } | null>}
 */
export async function synthesizeNeuralSpeech(text) {
  const tts = config.neuralTts || {};
  const maxChars = tts.maxChars || 400;
  const cleaned = clampText(text, maxChars);
  if (!cleaned) return null;

  const order = resolveProviderOrder(tts);
  const timeoutMs = tts.timeoutMs || 12_000;

  for (const name of order) {
    try {
      let result = null;
      if (name === "elevenlabs") result = await synthElevenLabs(cleaned, tts.elevenLabs, timeoutMs);
      else if (name === "cartesia") result = await synthCartesia(cleaned, tts.cartesia, timeoutMs);
      else if (name === "huggingface") result = await synthHuggingFace(cleaned, tts.huggingface, timeoutMs);
      if (result?.buffer?.length) return result;
    } catch (err) {
      console.warn(`[neural-tts] ${name} failed:`, err?.message || err);
    }
  }
  return null;
}

function resolveProviderOrder(tts) {
  const available = [];
  if (tts.elevenLabs?.apiKey) available.push("elevenlabs");
  if (tts.cartesia?.apiKey) available.push("cartesia");
  if (tts.huggingface?.apiKey || tts.huggingface?.url) available.push("huggingface");

  const pref = String(tts.preferred || "auto").toLowerCase();
  if (pref === "auto" || !available.includes(pref)) return available;
  return [pref, ...available.filter((p) => p !== pref)];
}

async function synthElevenLabs(text, cfg, timeoutMs) {
  if (!cfg?.apiKey) return null;
  const voiceId = cfg.voiceId || DEFAULT_ELEVEN_VOICE;
  const modelId = cfg.modelId || DEFAULT_ELEVEN_MODEL;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": cfg.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: Number.isFinite(cfg.stability) ? cfg.stability : 0.4,
        similarity_boost: Number.isFinite(cfg.similarityBoost) ? cfg.similarityBoost : 0.85,
        style: Number.isFinite(cfg.style) ? cfg.style : 0.2,
        use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`elevenlabs HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return { buffer: buf, contentType: "audio/mpeg", provider: "elevenlabs" };
}

async function synthCartesia(text, cfg, timeoutMs) {
  if (!cfg?.apiKey) return null;
  const voiceId = cfg.voiceId || DEFAULT_CARTESIA_VOICE;
  const modelId = cfg.modelId || DEFAULT_CARTESIA_MODEL;
  const res = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": cfg.apiKey,
      "Cartesia-Version": "2024-06-10",
    },
    body: JSON.stringify({
      model_id: modelId,
      transcript: text,
      voice: { mode: "id", id: voiceId },
      output_format: {
        container: "mp3",
        bit_rate: 128000,
        sample_rate: 44100,
      },
      language: cfg.language || "en",
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`cartesia HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return { buffer: buf, contentType: "audio/mpeg", provider: "cartesia" };
}

/**
 * Hugging Face Inference or custom Kokoro/StyleTTS proxy.
 * Expects audio bytes (wav/mpeg/ogg) or JSON with base64 audio.
 */
async function synthHuggingFace(text, cfg, timeoutMs) {
  const token = cfg?.apiKey || "";
  const model = cfg?.model || "hexgrad/Kokoro-82M";
  const url =
    cfg?.url ||
    `https://router.huggingface.co/hf-inference/models/${model}`;
  if (!token && !cfg?.url) return null;

  const headers = {
    "Content-Type": "application/json",
    Accept: "audio/wav, audio/mpeg, application/json, */*",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const payload = cfg?.url
    ? { text, inputs: text, voice: cfg.voice || "af_sarah" }
    : { inputs: text };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`huggingface TTS HTTP ${res.status}: ${body.slice(0, 160)}`);
  }

  const ctype = String(res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("application/json")) {
    const json = await res.json();
    const b64 =
      json.audio ||
      json.audio_base64 ||
      json.data?.[0]?.b64_json ||
      json.output?.audio;
    if (!b64 || typeof b64 !== "string") return null;
    const raw = b64.includes(",") ? b64.split(",").pop() : b64;
    const buf = Buffer.from(raw, "base64");
    if (!buf.length) return null;
    return {
      buffer: buf,
      contentType: json.content_type || json.mime || "audio/wav",
      provider: "huggingface",
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  let contentType = "audio/wav";
  if (ctype.includes("mpeg") || ctype.includes("mp3")) contentType = "audio/mpeg";
  else if (ctype.includes("ogg")) contentType = "audio/ogg";
  else if (ctype.includes("wav") || ctype.includes("wave")) contentType = "audio/wav";
  return { buffer: buf, contentType, provider: "huggingface" };
}

export { clampText as _clampTextForTest, resolveProviderOrder as _resolveProviderOrderForTest };
