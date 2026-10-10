/**
 * Per-turn voice follow-up: collect sendText bodies, then TTS.
 * Text always goes out first. Audio only on a voice note / explicit ask.
 * Chain: ElevenLabs → Groq Orpheus → Grok.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { shouldSkipTtsForText, toSpeechScript } from "../lib/voice-text-first.js";
import { isAnyTtsReady, synthesizeVoiceNote } from "./voice-tts.js";

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

export async function flushVoiceReply(to, extras = {}) {
  const s = voiceTurn.getStore();
  if (!s?.enabled || s.flushed) return { skipped: true, reason: "inactive" };
  s.flushed = true;

  if (!isAnyTtsReady() && !extras.synthesize) {
    console.warn("[voice-reply] skip: no TTS provider (ElevenLabs / Groq / Grok)");
    return { skipped: true, reason: "not_configured" };
  }

  const spoken = toSpeechScript(s.texts.join("\n\n"));
  if (!spoken || spoken.length < 8) {
    console.warn("[voice-reply] skip: empty spoken script");
    return { skipped: true, reason: "empty" };
  }

  const synth = extras.synthesize || synthesizeVoiceNote;
  const generated = await synth(spoken, extras);
  const files = generated?.filepaths || (generated?.filepath ? [generated.filepath] : []);
  if (!generated?.ok || !files.length) {
    console.warn("[voice-reply] skip: tts_failed");
    return { skipped: true, reason: "tts_failed" };
  }

  try {
    const { sendVoiceNote } = await import("./whatsapp.js");
    for (const filepath of files) {
      await sendVoiceNote(to, filepath);
    }
    return { ok: true, filepath: files[0], filepaths: files, provider: generated.provider };
  } catch (err) {
    console.warn("[voice-reply] sendVoice failed (text already sent):", err.message);
    return { skipped: true, reason: "send_failed", error: err.message };
  }
}
