/**
 * ElevenLabs TTS with local MP3 cache.
 * Fastest low-cost model: eleven_flash_v2_5.
 * No API call when ELEVENLABS_API_KEY is unset (text-only until keys are added).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { config } from "../config.js";
import {
  DEFAULT_ELEVENLABS_MODEL_ID,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "../lib/voice-text-first.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Durable VM path — inside gitignored whatsapp-bot/data/ */
export const AUDIO_CACHE_DIR = path.join(__dirname, "..", "..", "data", "audio-cache");

export function elevenLabsSettings() {
  const el = config.elevenlabs || {};
  const apiKey = String(el.apiKey || "").trim();
  const enabled = el.enabled !== false;
  return {
    apiKey,
    voiceId: String(el.voiceId || "").trim() || DEFAULT_ELEVENLABS_VOICE_ID,
    modelId: String(el.modelId || "").trim() || DEFAULT_ELEVENLABS_MODEL_ID,
    outputFormat: String(el.outputFormat || "").trim() || DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    enabled,
    configured: Boolean(apiKey) && enabled,
  };
}

export function isElevenLabsTtsReady() {
  return elevenLabsSettings().configured;
}

export function elevenLabsHealth() {
  const s = elevenLabsSettings();
  return {
    configured: s.configured,
    ttsEnabled: s.enabled,
    keyPresent: Boolean(s.apiKey),
    voiceIdSet: Boolean(s.voiceId),
    model: s.modelId,
    outputFormat: s.outputFormat,
    cacheDir: AUDIO_CACHE_DIR,
  };
}

export function getTextHash(text, { voiceId, modelId } = {}) {
  const s = elevenLabsSettings();
  const key = `${voiceId || s.voiceId}|${modelId || s.modelId}|${String(text || "").trim().toLowerCase()}`;
  return createHash("md5").update(key, "utf8").digest("hex");
}

export function cachedVoicePath(text, opts = {}) {
  return path.join(AUDIO_CACHE_DIR, `${getTextHash(text, opts)}.mp3`);
}

async function ensureCacheDir() {
  await mkdir(AUDIO_CACHE_DIR, { recursive: true });
}

/**
 * @param {string} text spoken script
 * @param {{ fetchAudio?: Function }} [opts] test seam
 * @returns {Promise<string|null>} absolute MP3 path
 */
export async function generateVoiceNote(text, opts = {}) {
  const spoken = String(text || "").trim();
  if (!spoken) return null;

  await ensureCacheDir();
  const cachedFilepath = cachedVoicePath(spoken);
  if (existsSync(cachedFilepath)) {
    console.log("[CACHE HIT] Reusing cached audio:", cachedFilepath);
    return cachedFilepath;
  }

  const s = elevenLabsSettings();
  if (!s.configured) {
    console.log("[elevenlabs] skip API — no ELEVENLABS_API_KEY (text-only)");
    return null;
  }

  console.log(`[API CALL] Requesting ElevenLabs audio for: '${spoken.slice(0, 30)}...'`);
  try {
    const fetchAudio = opts.fetchAudio || defaultFetchAudio;
    const buffer = await fetchAudio({
      text: spoken,
      voiceId: s.voiceId,
      modelId: s.modelId,
      outputFormat: s.outputFormat,
      apiKey: s.apiKey,
    });
    if (!buffer?.length) {
      console.warn("[elevenlabs] empty audio body");
      return null;
    }
    await writeFile(cachedFilepath, buffer);
    return cachedFilepath;
  } catch (err) {
    console.error("[ERROR] ElevenLabs Generation Failed:", err.message);
    return null;
  }
}

async function defaultFetchAudio({ text, voiceId, modelId, outputFormat, apiKey }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  const { data } = await axios.post(
    url,
    {
      text,
      model_id: modelId,
    },
    {
      params: { output_format: outputFormat },
      headers: {
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
      timeout: 20_000,
      validateStatus: (st) => st === 200,
    }
  );
  return Buffer.from(data);
}
