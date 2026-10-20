/**
 * Groq Orpheus TTS — OpenAI-compatible /audio/speech → WAV for WAHA.
 * English model; skip when the script looks like Kiswahili (use ElevenLabs / Grok).
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { chunkOrpheusInput, GROQ_ORPHEUS_MAX_CHARS } from "../lib/voice-audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GROQ_TTS_CACHE_DIR = path.join(__dirname, "..", "..", "data", "audio-cache");

const KISWAHILI_RE =
  /\b(habari|sasa|asante|karibu|nataka|niletee|bei|pesa|sauti|tafadhali|nisaidie|poa|mambo)\b/i;

export function isGroqTtsReady() {
  return Boolean(String(config.groq?.apiKey || "").trim());
}

export function groqTtsSettings() {
  return {
    apiKey: String(config.groq?.apiKey || "").trim(),
    baseUrl: (config.groq?.baseUrl || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    model: config.groq?.ttsModel || process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english",
    voice: config.groq?.ttsVoice || process.env.GROQ_TTS_VOICE || "autumn",
    configured: isGroqTtsReady(),
  };
}

export function groqTtsEligible(text) {
  return !KISWAHILI_RE.test(String(text || ""));
}

function cachePath(text, voice, model, index) {
  const key = `groq|${model}|${voice}|${index}|${String(text || "").trim().toLowerCase()}`;
  const hash = createHash("md5").update(key, "utf8").digest("hex");
  return path.join(GROQ_TTS_CACHE_DIR, `${hash}.wav`);
}

async function fetchOrpheusWav({ text, voice, model, apiKey, baseUrl }) {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const response = await client.audio.speech.create({
    model,
    voice,
    input: String(text).slice(0, GROQ_ORPHEUS_MAX_CHARS),
    response_format: "wav",
  });
  const buf = Buffer.from(await response.arrayBuffer());
  if (!buf.length) throw new Error("groq_tts_empty");
  return buf;
}

/**
 * @returns {Promise<string[]>} WAV file paths (one per 200-char chunk)
 */
export async function generateGroqVoiceNotes(text, extras = {}) {
  const spoken = String(text || "").trim();
  if (!spoken) return [];
  const s = groqTtsSettings();
  if (!s.configured && !extras.fetchAudio) return [];
  if (!groqTtsEligible(spoken) && extras.allowKiswahili !== true) {
    console.log("[groq-tts] skip Orpheus — Kiswahili script, use ElevenLabs/Grok");
    return [];
  }

  await mkdir(GROQ_TTS_CACHE_DIR, { recursive: true });
  const chunks = chunkOrpheusInput(spoken);
  const fetchAudio = extras.fetchAudio || fetchOrpheusWav;
  const files = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const dest = cachePath(chunks[i], s.voice, s.model, i);
    if (existsSync(dest) && !extras.skipCache) {
      files.push(dest);
      continue;
    }
    const buffer = await fetchAudio({
      text: chunks[i],
      voice: s.voice,
      model: s.model,
      apiKey: s.apiKey,
      baseUrl: s.baseUrl,
    });
    if (!buffer?.length) throw new Error("groq_tts_empty");
    await writeFile(dest, buffer);
    files.push(dest);
  }
  return files;
}
