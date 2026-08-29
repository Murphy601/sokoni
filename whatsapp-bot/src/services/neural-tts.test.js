import test from "node:test";
import assert from "node:assert/strict";
import {
  neuralTtsMeta,
  _clampTextForTest as clampText,
  _resolveProviderOrderForTest as resolveProviderOrder,
} from "./neural-tts.js";

test("clampText strips WA markdown and truncates at sentence", () => {
  const raw = "*Hello* Sokoni. _Your_ escrow is safe. More text that should not all fit if we clamp hard.";
  const out = clampText(raw, 40);
  assert.ok(out.length <= 40);
  assert.equal(out.includes("*"), false);
  assert.equal(out.includes("_"), false);
  assert.match(out, /Hello Sokoni/i);
});

test("clampText returns empty for blank", () => {
  assert.equal(clampText("   "), "");
  assert.equal(clampText(null), "");
});

test("resolveProviderOrder prefers configured provider", () => {
  const tts = {
    preferred: "cartesia",
    elevenLabs: { apiKey: "el" },
    cartesia: { apiKey: "ca" },
    huggingface: { apiKey: "" },
  };
  assert.deepEqual(resolveProviderOrder(tts), ["cartesia", "elevenlabs"]);
});

test("resolveProviderOrder auto lists available only", () => {
  const tts = {
    preferred: "auto",
    elevenLabs: { apiKey: "" },
    cartesia: { apiKey: "" },
    huggingface: { url: "https://example.com/kokoro" },
  };
  assert.deepEqual(resolveProviderOrder(tts), ["huggingface"]);
});

test("neuralTtsMeta reports configured false without keys", () => {
  const meta = neuralTtsMeta();
  assert.equal(typeof meta.maxChars, "number");
  assert.ok(Array.isArray(meta.providers));
  // In CI without keys, configured should be false
  if (!process.env.ELEVENLABS_API_KEY && !process.env.CARTESIA_API_KEY && !process.env.NEURAL_TTS_HF_URL) {
    assert.equal(meta.configured, false);
  }
});
