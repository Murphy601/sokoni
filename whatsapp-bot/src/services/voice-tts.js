/**
 * WhatsApp voice-note TTS chain:
 *   ElevenLabs (existing) → Groq Orpheus (.wav) → Grok / xAI
 */
import { generateVoiceNote, isElevenLabsTtsReady, elevenLabsHealth } from "./elevenlabs-tts.js";
import { generateGroqVoiceNotes, isGroqTtsReady, groqTtsSettings } from "./groq-tts.js";
import { generateGrokVoiceNote, isGrokVoiceReady, grokVoiceSettings } from "./grok-voice.js";
import { config } from "../config.js";

const DEFAULT_ORDER = ["elevenlabs", "groq", "grok"];

export function ttsProviderOrder() {
  const raw = String(config.voice?.ttsOrder || process.env.VOICE_TTS_ORDER || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((n) => DEFAULT_ORDER.includes(n));
  return raw.length ? raw : DEFAULT_ORDER.slice();
}

export function isAnyTtsReady() {
  return isElevenLabsTtsReady() || isGroqTtsReady() || isGrokVoiceReady();
}

export function voiceTtsHealth() {
  const groq = groqTtsSettings();
  const grok = grokVoiceSettings();
  return {
    ready: isAnyTtsReady(),
    order: ttsProviderOrder(),
    elevenlabs: elevenLabsHealth(),
    groq: { configured: groq.configured, model: groq.model, voice: groq.voice },
    grok: { configured: grok.configured, voice: grok.ttsVoice, sttModel: grok.sttModel },
  };
}

/**
 * @returns {Promise<{ ok: boolean, provider?: string, filepaths?: string[], error?: string }>}
 */
export async function synthesizeVoiceNote(text, extras = {}) {
  const spoken = String(text || "").trim();
  if (!spoken) return { ok: false, error: "empty" };

  const order = extras.order || ttsProviderOrder();
  for (const name of order) {
    try {
      if (name === "elevenlabs") {
        const fp = await generateVoiceNote(spoken, extras.elevenlabs || {});
        if (fp) return { ok: true, provider: "elevenlabs", filepaths: [fp] };
      } else if (name === "groq") {
        const files = await generateGroqVoiceNotes(spoken, extras.groq || {});
        if (files?.length) return { ok: true, provider: "groq", filepaths: files };
      } else if (name === "grok") {
        const fp = await generateGrokVoiceNote(spoken, extras.grok || {});
        if (fp) return { ok: true, provider: "grok", filepaths: [fp] };
      }
    } catch (err) {
      console.warn(`[voice-tts] ${name} failed:`, err.message);
    }
  }
  return { ok: false, error: "tts_unavailable" };
}
