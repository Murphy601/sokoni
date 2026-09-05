/**
 * Text-first voice routing for WhatsApp.
 * Incoming text → text reply (0 ElevenLabs credits).
 * Incoming voice note, or an explicit "send voice / tuma sauti" ask → TTS.
 */

/** Default Rachel stock voice (Voice Library) — override with ELEVENLABS_VOICE_ID. */
export const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
export const DEFAULT_TTS_MAX_CHARS = 800;

const EXPLICIT_AUDIO_RE =
  /\b(voice\s*note|voice\s*reply|send\s+(?:me\s+)?(?:a\s+)?voice|in\s+voice|as\s+(?:a\s+)?(?:voice|audio)|send\s+audio|audio\s+reply|speak\s+(?:it|this|that|the\s+reply)|read\s+(?:it|this|aloud)|record\s+(?:it|this|a\s+reply)|tuma\s+sauti|note\s+ya\s+sauti|sauti\s+note|sema\s+kwa\s+sauti|niongelee|niongelea)\b/i;

/** Bare "voice" / "speak" / "audio" / "record" as the whole message. */
const BARE_AUDIO_RE = /^(?:please\s+)?(?:voice|speak|audio|record)(?:\s+please)?[.!?]*$/i;

/** Human-handoff phrasing must stay text (do not treat as TTS request). */
const HANDOFF_RE = /\b(speak\s+to|talk\s+to|human|agent|person)\b/i;

export function looksLikeVoiceNoteMime(mediaMimetype) {
  const mime = String(mediaMimetype || "").toLowerCase();
  return mime.startsWith("audio/") || mime.includes("ogg") || mime.includes("ptt");
}

export function isExplicitAudioRequest(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (HANDOFF_RE.test(raw) && !EXPLICIT_AUDIO_RE.test(raw)) return false;
  if (BARE_AUDIO_RE.test(raw)) return true;
  return EXPLICIT_AUDIO_RE.test(raw);
}

export function shouldSkipTtsForText(text) {
  const t = String(text || "");
  if (/^\s*(PICKUP|CONFIRM|ACCEPT)\s+SKN/i.test(t)) return true;
  if (/!force-release|FORCE RELEASE|FORCE_PAYOUT/i.test(t)) return true;
  if (/\b(Vendor\/Pickup OTP|Delivery OTP)\b/i.test(t)) return true;
  return false;
}

/**
 * Strip WhatsApp markdown / URLs so ElevenLabs speaks cleanly.
 * SKN ids stay spoken; tap-able links stay in the text message.
 */
export function toSpeechScript(text, { maxChars = DEFAULT_TTS_MAX_CHARS } = {}) {
  let s = String(text || "");
  s = s.replace(/https?:\/\/\S+/gi, "link in chat");
  s = s.replace(/[*_~`]+/g, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.trim();
  const cap = Number(maxChars) > 0 ? Number(maxChars) : DEFAULT_TTS_MAX_CHARS;
  if (s.length > cap) s = `${s.slice(0, cap).trim()}…`;
  return s;
}

export const STATIC_VOICE_MESSAGES = [
  "Hello! Welcome to Sokoni, how can I help you today?",
  "Thank you for contacting customer support. An agent will be with you shortly.",
  "Please enter your order number to check delivery status.",
  "Karibu Sokoni. Unatafuta nini leo?",
];
