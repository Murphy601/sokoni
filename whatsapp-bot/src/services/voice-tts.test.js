import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkOrpheusInput, voiceAudioFilename, GROQ_ORPHEUS_MAX_CHARS } from "../lib/voice-audio.js";
import { synthesizeVoiceNote, ttsProviderOrder } from "./voice-tts.js";
import { groqTtsEligible } from "./groq-tts.js";
import { transcribeWithGrok, generateGrokVoiceNote } from "./grok-voice.js";
import { generateGroqVoiceNotes } from "./groq-tts.js";
import { withVoiceReply, recordVoiceReplyText, flushVoiceReply } from "./voice-reply.js";

describe("WhatsApp audio filenames", () => {
  it("keeps ogg and m4a so Groq/Grok need no conversion", () => {
    assert.equal(voiceAudioFilename("audio/ogg; codecs=opus"), "voice.ogg");
    assert.equal(voiceAudioFilename("audio/mp4"), "voice.m4a");
    assert.equal(voiceAudioFilename("audio/m4a"), "voice.m4a");
    assert.equal(voiceAudioFilename("audio/aac"), "voice.m4a");
    assert.equal(voiceAudioFilename("audio/wav"), "voice.wav");
  });
});

describe("Groq Orpheus chunking", () => {
  it("splits at 200 characters on sentence or word boundaries", () => {
    assert.deepEqual(chunkOrpheusInput("Short hello."), ["Short hello."]);
    const long = `${"Thanks for shopping on Sokoni. ".repeat(10)}Please reply YES.`;
    const parts = chunkOrpheusInput(long);
    assert.ok(parts.length >= 2);
    assert.ok(parts.every((p) => p.length <= GROQ_ORPHEUS_MAX_CHARS));
    assert.match(parts.join(" "), /Sokoni/);
  });

  it("skips Orpheus for Kiswahili scripts", () => {
    assert.equal(groqTtsEligible("Karibu Sokoni, asante."), false);
    assert.equal(groqTtsEligible("The jacket is still in stock."), true);
  });
});

describe("TTS provider chain", () => {
  it("defaults to ElevenLabs then Groq then Grok", () => {
    const order = ttsProviderOrder();
    assert.deepEqual(order.slice(0, 3), ["elevenlabs", "groq", "grok"]);
  });

  it("falls through ElevenLabs → Groq → Grok", async () => {
    const groqCalls = [];
    const grokCalls = [];
    const result = await synthesizeVoiceNote("The denim jacket is still available today.", {
      order: ["elevenlabs", "groq", "grok"],
      elevenlabs: {
        fetchAudio: async () => {
          throw new Error("elevenlabs_down");
        },
      },
      groq: {
        skipCache: true,
        fetchAudio: async ({ text }) => {
          groqCalls.push(text);
          return Buffer.from("RIFF-fake-wav");
        },
      },
      grok: {
        skipCache: true,
        fetchAudio: async ({ text }) => {
          grokCalls.push(text);
          return { buffer: Buffer.from("fake-mp3"), ext: "mp3" };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "groq");
    assert.ok(result.filepaths?.length >= 1);
    assert.ok(groqCalls.length >= 1);
    assert.equal(grokCalls.length, 0);
  });

  it("uses Grok when Groq also fails", async () => {
    const result = await synthesizeVoiceNote("Escrow holds your M-Pesa until you confirm delivery.", {
      order: ["groq", "grok"],
      groq: {
        skipCache: true,
        fetchAudio: async () => {
          throw new Error("groq_down");
        },
      },
      grok: {
        skipCache: true,
        fetchAudio: async () => ({ buffer: Buffer.from("grok-mp3"), ext: "mp3" }),
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "grok");
  });
});

describe("Grok STT fallback", () => {
  it("posts the original WhatsApp filename", async () => {
    let seen = null;
    const result = await transcribeWithGrok({
      buffer: Buffer.from("ogg-bytes"),
      mimetype: "audio/ogg; codecs=opus",
      extras: {
        fetchStt: async (args) => {
          seen = args;
          return { text: "bei ngapi jacket", language: "sw" };
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "grok");
    assert.equal(result.text, "bei ngapi jacket");
    assert.equal(seen.filename, "voice.ogg");
  });
});

describe("voice-reply flush uses the chain", () => {
  it("sends Groq WAV when ElevenLabs is skipped", async () => {
    const wavDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "audio-cache");
    mkdirSync(wavDir, { recursive: true });
    const wavPath = path.join(wavDir, "orpheus-test.wav");
    writeFileSync(wavPath, "RIFF");
    const result = await withVoiceReply(true, async () => {
      recordVoiceReplyText("Hello! Welcome to Sokoni, how can I help you today?");
      return flushVoiceReply("254700000000@c.us", {
        synthesize: async () => ({
          ok: true,
          provider: "groq",
          filepaths: [wavPath],
        }),
      });
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "groq");
    assert.match(result.filepath, /orpheus-test\.wav/);
  });
});

describe("WAHA accepts wav from Groq", () => {
  it("maps .wav in sendVoice payload", () => {
    const src = readFileSync(new URL("./whatsapp.js", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("function voiceFilePayload"));
    assert.match(fn.slice(0, 800), /audio\/wav/);
    assert.match(fn.slice(0, 800), /\.m4a/);
  });
});

describe("Grok TTS helper", () => {
  it("writes a cached file from a stubbed fetch", async () => {
    const fp = await generateGrokVoiceNote(`grok-cache-${Date.now()}`, {
      skipCache: true,
      fetchAudio: async () => ({ buffer: Buffer.from("id3-fake"), ext: "mp3" }),
    });
    assert.ok(fp);
    assert.match(fp, /\.mp3$/);
  });
});

describe("Groq TTS helper", () => {
  it("writes wav chunks from a stubbed fetch", async () => {
    const files = await generateGroqVoiceNotes("The prepaid escrow is still holding your payment.", {
      skipCache: true,
      allowKiswahili: true,
      fetchAudio: async () => Buffer.from("RIFF-stub"),
    });
    assert.ok(files.length >= 1);
    assert.ok(files[0].endsWith(".wav"));
  });
});
