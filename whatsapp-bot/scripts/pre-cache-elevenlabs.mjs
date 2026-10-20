#!/usr/bin/env node
/**
 * Pre-cache static Sokoni voice clips so greetings do not burn ElevenLabs
 * characters on every repeat. Requires ELEVENLABS_API_KEY on the VM.
 *
 *   cd whatsapp-bot && npm run tts:precache
 */
import { generateVoiceNote } from "../src/services/elevenlabs-tts.js";
import { isElevenLabsTtsReady } from "../src/services/elevenlabs-tts.js";
import { STATIC_VOICE_MESSAGES } from "../src/lib/voice-text-first.js";

if (!isElevenLabsTtsReady()) {
  console.error("ELEVENLABS_API_KEY is not set — nothing to cache. Add keys to whatsapp-bot/.env first.");
  process.exit(1);
}

console.log("Pre-caching static bot messages...");
let ok = 0;
for (const msg of STATIC_VOICE_MESSAGES) {
  const filepath = await generateVoiceNote(msg);
  if (filepath) {
    ok += 1;
    console.log(`Cached: ${msg} -> ${filepath}`);
  } else {
    console.warn(`Failed: ${msg}`);
  }
}
console.log(`Done. ${ok}/${STATIC_VOICE_MESSAGES.length} clips in data/audio-cache/`);
if (ok === 0) process.exit(1);
