import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isExplicitAudioRequest,
  looksLikeVoiceNoteMime,
  shouldSkipTtsForText,
  toSpeechScript,
  STATIC_VOICE_MESSAGES,
  resolvePremadeVoice,
  ELEVENLABS_PREMADE_VOICES,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./voice-text-first.js";
import { getTextHash, generateVoiceNote, AUDIO_CACHE_DIR } from "../services/elevenlabs-tts.js";
import { withVoiceReply, recordVoiceReplyText, isVoiceReplyTurn, flushVoiceReply } from "../services/voice-reply.js";

describe("text-first voice routing", () => {
  it("incoming text keywords only when shopper asks for audio", () => {
    assert.equal(isExplicitAudioRequest("show me dresses under 2000"), false);
    assert.equal(isExplicitAudioRequest("speakers under 5k"), false);
    assert.equal(isExplicitAudioRequest("speak to a human"), false);
    assert.equal(isExplicitAudioRequest("send voice"), true);
    assert.equal(isExplicitAudioRequest("tuma sauti tafadhali"), true);
    assert.equal(isExplicitAudioRequest("voice"), true);
    assert.equal(isExplicitAudioRequest("read it aloud"), true);
  });

  it("treats WhatsApp PTT / ogg as a voice note", () => {
    assert.equal(looksLikeVoiceNoteMime("audio/ogg; codecs=opus"), true);
    assert.equal(looksLikeVoiceNoteMime("audio/mpeg"), true);
    assert.equal(looksLikeVoiceNoteMime("image/jpeg"), false);
  });

  it("does not speak OTP / rider custody lines", () => {
    assert.equal(shouldSkipTtsForText("PICKUP SKN-1020 1234"), true);
    assert.equal(shouldSkipTtsForText("Karibu — here are 3 dresses under 2,000."), false);
  });

  it("strips markdown and URLs for speech", () => {
    const spoken = toSpeechScript("*Paid* https://sokonimall.com/label.html?order=SKN-1020");
    assert.equal(spoken.includes("*"), false);
    assert.match(spoken, /link in chat/i);
    assert.match(spoken, /Paid/);
  });

  it("has static greeting lines for pre-cache", () => {
    assert.ok(STATIC_VOICE_MESSAGES.length >= 3);
  });

  it("maps premade names and IDs; library IDs fall back to Rachel", () => {
    assert.equal(Object.keys(ELEVENLABS_PREMADE_VOICES).length, 7);
    assert.equal(resolvePremadeVoice("", "adam").id, ELEVENLABS_PREMADE_VOICES.adam.id);
    assert.equal(resolvePremadeVoice("hpp4J3VqNfWAUOO0d1Us", "").slug, "bella");
    assert.equal(resolvePremadeVoice("hpp4J3VqNfWAUOO0d1Us", "rachel").id, "hpp4J3VqNfWAUOO0d1Us");
    assert.equal(resolvePremadeVoice("", "bella").id, "hpp4J3VqNfWAUOO0d1Us");
    assert.equal(resolvePremadeVoice("EXAVITQu4vr4xnSDxMaL", "").slug, "bella");
    const lib = resolvePremadeVoice("tnSpp4vdxKPjI9w0GnoV", "");
    assert.equal(lib.fallback, true);
    assert.equal(lib.id, DEFAULT_ELEVENLABS_VOICE_ID);
    assert.equal(lib.slug, "rachel");
  });
});

describe("ElevenLabs local cache", () => {
  it("hashes normalized text so repeats skip the API", () => {
    const a = getTextHash("Hello Sokoni");
    const b = getTextHash("  HELLO SOKONI  ");
    assert.equal(a, b);
    assert.equal(a.length, 32);
  });

  it("returns cached file without calling fetchAudio", async () => {
    const text = `cache-hit-${Date.now()}`;
    const dest = path.join(AUDIO_CACHE_DIR, `${getTextHash(text)}.mp3`);
    mkdirSync(AUDIO_CACHE_DIR, { recursive: true });
    writeFileSync(dest, Buffer.from("fake-mp3"));
    let called = 0;
    const filepath = await generateVoiceNote(text, {
      fetchAudio: async () => {
        called += 1;
        return Buffer.from("new");
      },
    });
    assert.equal(filepath, dest);
    assert.equal(called, 0);
    rmSync(dest, { force: true });
  });

  it("skips the API when no key is configured", async () => {
    const { isElevenLabsTtsReady } = await import("../services/elevenlabs-tts.js");
    if (isElevenLabsTtsReady()) return;
    const text = `no-key-${Date.now()}-unique-never-cached`;
    const dest = path.join(AUDIO_CACHE_DIR, `${getTextHash(text)}.mp3`);
    rmSync(dest, { force: true });
    let called = 0;
    const filepath = await generateVoiceNote(text, {
      fetchAudio: async () => {
        called += 1;
        return Buffer.from("should-not-run");
      },
    });
    assert.equal(filepath, null);
    assert.equal(called, 0);
    assert.equal(existsSync(dest), false);
  });
});

describe("voice-reply turn store", () => {
  it("does not record texts outside a voice turn", () => {
    recordVoiceReplyText("hello");
    assert.equal(isVoiceReplyTurn(), false);
  });

  it("skips flush when ElevenLabs is not configured", async () => {
    const result = await withVoiceReply(true, async () => {
      recordVoiceReplyText("Hello! Welcome to Sokoni, how can I help you today?");
      return flushVoiceReply("254700000000@c.us");
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "not_configured");
  });
});
