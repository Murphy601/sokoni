/**
 * WhatsApp voice bytes → filename Groq / Grok accept without conversion.
 * WAHA hands us .ogg (opus) or .m4a; pass that extension through.
 */
export function voiceAudioFilename(mimetype = "audio/ogg") {
  const mime = String(mimetype || "").toLowerCase();
  if (mime.includes("m4a") || mime.includes("mp4") || mime.includes("aac")) return "voice.m4a";
  if (mime.includes("wav") || mime.includes("wave")) return "voice.wav";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "voice.mp3";
  return "voice.ogg";
}

export function voiceAudioMimetype(filenameOrMime = "") {
  const raw = String(filenameOrMime || "").toLowerCase();
  if (raw.includes("m4a") || raw.includes("mp4") || raw.includes("aac")) return "audio/mp4";
  if (raw.includes("wav")) return "audio/wav";
  if (raw.includes("mp3") || raw.includes("mpeg")) return "audio/mpeg";
  if (raw.startsWith("audio/")) return raw.split(";")[0];
  return "audio/ogg";
}

/** Groq Orpheus input cap is 200 characters. */
export const GROQ_ORPHEUS_MAX_CHARS = 200;

export function chunkOrpheusInput(text, max = GROQ_ORPHEUS_MAX_CHARS) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const parts = [];
  let rest = clean;
  while (rest.length) {
    if (rest.length <= max) {
      parts.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(". ", max);
    if (cut < 40) cut = rest.lastIndexOf(" ", max);
    if (cut < 40) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return parts.filter(Boolean);
}
