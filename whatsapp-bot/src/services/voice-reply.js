/**
 * Per-turn voice follow-up: collect sendText bodies, then one cached ElevenLabs clip.
 * Text always goes out first. TTS only when this turn is a voice note / explicit ask.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { isElevenLabsTtsReady, generateVoiceNote } from "./elevenlabs-tts.js";
import { shouldSkipTtsForText, toSpeechScript } from "../lib/voice-text-first.js";

const voiceTurn = new AsyncLocalStorage();

export function withVoiceReply(enabled, fn) {
  return voiceTurn.run({ enabled: Boolean(enabled), texts: [], flushed: false }, fn);
}

export function isVoiceReplyTurn() {
  return Boolean(voiceTurn.getStore()?.enabled);
}

export function recordVoiceReplyText(text) {
  const s = voiceTurn.getStore();
  if (!s?.enabled) return;
  const t = String(text || "").trim();
  if (!t || shouldSkipTtsForText(t)) return;
  s.texts.push(t);
}

export async function flushVoiceReply(to) {
  const s = voiceTurn.getStore();
  if (!s?.enabled || s.flushed) return { skipped: true, reason: "inactive" };
  s.flushed = true;

  if (!isElevenLabsTtsReady()) {
    return { skipped: true, reason: "not_configured" };
  }

  const spoken = toSpeechScript(s.texts.join("\n\n"));
  if (!spoken || spoken.length < 8) {
    return { skipped: true, reason: "empty" };
  }

  const filepath = await generateVoiceNote(spoken);
  if (!filepath) {
    return { skipped: true, reason: "tts_failed" };
  }

  try {
    const { sendVoiceNote } = await import("./whatsapp.js");
    await sendVoiceNote(to, filepath);
    return { ok: true, filepath };
  } catch (err) {
    console.warn("[voice-reply] sendVoice failed (text already sent):", err.message);
    return { skipped: true, reason: "send_failed", error: err.message };
  }
}
