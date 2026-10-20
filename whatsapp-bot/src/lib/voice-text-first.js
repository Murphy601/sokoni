/**
 * Text-first voice routing for WhatsApp.
 * Incoming text → text reply (0 ElevenLabs credits).
 * Incoming voice note, or an explicit "send voice / tuma sauti" ask → TTS.
 */

/**
 * Free-tier API voices — ElevenLabs premade only.
 * Voice Library / community IDs (e.g. Hope) return HTTP 402 on free plans.
 */
export const ELEVENLABS_PREMADE_VOICES = {
  rachel: {
    id: "21m00Tcm4TlvDq8ikWAM",
    label: "Rachel",
    note: "Professional, warm female — default shop assistant",
  },
  adam: {
    id: "pNInz6obpgDQGcFmaJgB",
    label: "Adam",
    note: "Deep, clear male — system announcements",
  },
  antoni: {
    id: "ErXwobaYiN019PkySvjV",
    label: "Antoni",
    note: "Conversational young male",
  },
  bella: {
    id: "hpp4J3VqNfWAUOO0d1Us",
    label: "Bella",
    note: "Account Bella — free-tier My Voices",
  },
  josh: {
    id: "TxGEqnHWrfWFTfGW9XjX",
    label: "Josh",
    note: "Natural, casual young male",
  },
  elli: {
    id: "MF3mGyEYCl7XYWbV9V6O",
    label: "Elli",
    note: "Soft-spoken female",
  },
  domini: {
    id: "AZnzlk1XvdvUeBnXmlld",
    label: "Domini",
    note: "Strong, direct female",
  },
};

export const DEFAULT_ELEVENLABS_VOICE_SLUG = "rachel";
export const DEFAULT_ELEVENLABS_VOICE_ID = ELEVENLABS_PREMADE_VOICES.rachel.id;
export const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";
export const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
export const DEFAULT_TTS_MAX_CHARS = 800;

const PREMADE_BY_ID = new Map(
  Object.entries(ELEVENLABS_PREMADE_VOICES).map(([slug, v]) => [v.id, { slug, ...v }])
);
/** Extra IDs that resolve to a slug (classic premade Bella still maps here). */
PREMADE_BY_ID.set("EXAVITQu4vr4xnSDxMaL", {
  slug: "bella",
  ...ELEVENLABS_PREMADE_VOICES.bella,
});

/**
 * Prefer an explicit voice ID when it is a known premade / account voice.
 * Name (ELEVENLABS_VOICE=bella) is used when the ID is empty or unknown.
 * Unknown library IDs fall back to Rachel.
 */
export function resolvePremadeVoice(rawId = "", rawName = "") {
  const id = String(rawId || "").trim();
  const name = String(rawName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");

  if (id && PREMADE_BY_ID.has(id)) {
    const hit = PREMADE_BY_ID.get(id);
    return { ...hit, id: hit.id, fallback: false };
  }
  if (name && ELEVENLABS_PREMADE_VOICES[name]) {
    return { slug: name, ...ELEVENLABS_PREMADE_VOICES[name], fallback: false };
  }
  if (id) {
    return {
      slug: DEFAULT_ELEVENLABS_VOICE_SLUG,
      ...ELEVENLABS_PREMADE_VOICES.rachel,
      fallback: true,
      rejectedId: id,
    };
  }
  return {
    slug: DEFAULT_ELEVENLABS_VOICE_SLUG,
    ...ELEVENLABS_PREMADE_VOICES.rachel,
    fallback: false,
  };
}

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
