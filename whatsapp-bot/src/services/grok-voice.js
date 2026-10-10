/**
 * xAI Grok voice — STT (/v1/stt) and TTS (/v1/tts) fallback.
 * Same key: XAI_API_KEY or GROK_API_KEY.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { voiceAudioFilename, voiceAudioMimetype } from "../lib/voice-audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GROK_TTS_CACHE_DIR = path.join(__dirname, "..", "..", "data", "audio-cache");

export function grokVoiceSettings() {
  const g = config.grok || {};
  const apiKey = String(g.apiKey || process.env.XAI_API_KEY || process.env.GROK_API_KEY || "").trim();
  return {
    apiKey,
    baseUrl: String(g.baseUrl || process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, ""),
    sttModel: g.sttModel || process.env.XAI_STT_MODEL || "grok-voice-transcribe-2.0",
    ttsVoice: g.ttsVoice || process.env.XAI_TTS_VOICE || "eve",
    ttsLanguage: g.ttsLanguage || process.env.XAI_TTS_LANGUAGE || "en",
    configured: Boolean(apiKey),
  };
}

export function isGrokVoiceReady() {
  return grokVoiceSettings().configured;
}

/**
 * Transcribe WhatsApp ogg/m4a bytes via Grok STT. No format conversion.
 */
export async function transcribeWithGrok({
  buffer,
  mimetype = "audio/ogg",
  languageHint,
  extras = {},
} = {}) {
  const s = grokVoiceSettings();
  if (!s.configured && !extras.fetchStt) {
    return { ok: false, error: "grok_key_missing", text: "" };
  }
  if (!buffer?.length) return { ok: false, error: "stt_unavailable", text: "" };

  const filename = voiceAudioFilename(mimetype);
  const mime = voiceAudioMimetype(mimetype);
  const fetchStt = extras.fetchStt || defaultFetchGrokStt;
  const result = await fetchStt({
    buffer,
    filename,
    mime,
    languageHint,
    apiKey: s.apiKey,
    baseUrl: s.baseUrl,
    model: s.sttModel,
  });
  const text = String(result?.text || "").trim();
  if (!text) return { ok: false, error: "stt_empty", text: "", provider: "grok" };
  return {
    ok: true,
    text,
    model: s.sttModel,
    language: result.language || languageHint || null,
    provider: "grok",
  };
}

async function defaultFetchGrokStt({ buffer, filename, mime, languageHint, apiKey, baseUrl, model }) {
  const form = new FormData();
  form.append("model", model);
  if (languageHint === "en") form.append("language", "en");
  form.append("file", new Blob([buffer], { type: mime }), filename);
  const resp = await fetch(`${baseUrl}/stt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`grok_stt_${resp.status} ${errText.slice(0, 180)}`);
  }
  const json = await resp.json();
  return { text: json.text || json.transcript || "", language: json.language || null };
}

export async function generateGrokVoiceNote(text, extras = {}) {
  const spoken = String(text || "").trim();
  if (!spoken) return null;
  const s = grokVoiceSettings();
  if (!s.configured && !extras.fetchAudio) return null;

  await mkdir(GROK_TTS_CACHE_DIR, { recursive: true });
  const key = `grok|${s.ttsVoice}|${s.ttsLanguage}|${spoken.toLowerCase()}`;
  const dest = path.join(
    GROK_TTS_CACHE_DIR,
    `${createHash("md5").update(key, "utf8").digest("hex")}.mp3`
  );
  if (existsSync(dest) && !extras.skipCache) return dest;

  const fetchAudio = extras.fetchAudio || defaultFetchGrokTts;
  const { buffer, ext } = await fetchAudio({
    text: spoken,
    voice: s.ttsVoice,
    language: s.ttsLanguage,
    apiKey: s.apiKey,
    baseUrl: s.baseUrl,
  });
  if (!buffer?.length) return null;
  const out = ext === "wav" ? dest.replace(/\.mp3$/, ".wav") : dest;
  await writeFile(out, buffer);
  return out;
}

async function defaultFetchGrokTts({ text, voice, language, apiKey, baseUrl }) {
  const resp = await fetch(`${baseUrl}/tts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: voice,
      language: language || "en",
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`grok_tts_${resp.status} ${errText.slice(0, 180)}`);
  }
  const ct = String(resp.headers.get("content-type") || "");
  if (ct.includes("application/json")) {
    const json = await resp.json();
    const b64 = json.audio || json.data || "";
    const buffer = Buffer.from(b64, "base64");
    const ext = String(json.content_type || "").includes("wav") ? "wav" : "mp3";
    return { buffer, ext };
  }
  const buffer = Buffer.from(await resp.arrayBuffer());
  const ext = ct.includes("wav") ? "wav" : "mp3";
  return { buffer, ext };
}
