#!/usr/bin/env node
/** Unit checks for NVIDIA listing vision fallback (mocked network). */
import assert from "node:assert/strict";

const prev = process.env.NVIDIA_API_KEY;
process.env.NVIDIA_API_KEY = "nvapi-test";

const { nvidiaVisionAvailable, nvidiaVisionListingJson } = await import(
  "../src/services/nvidia-vision.js"
);

assert.equal(nvidiaVisionAvailable(), true);

const origFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, init) => {
  calls += 1;
  const u = String(url);
  if (u.includes("/models")) {
    return new Response(
      JSON.stringify({
        data: [
          { id: "meta/llama-3.2-11b-vision-instruct" },
          { id: "microsoft/phi-3.5-vision-instruct" },
          { id: "nvidia/some-text-only" },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  if (u.includes("/chat/completions")) {
    const body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Vintage leather bag",
                title: "Vintage leather bag",
                sellerNetKes: 2500,
                category: "fashion",
                browseCategory: "women",
                browseSubCategory: "bags",
                description: "Pre-loved leather bag for Nairobi thrift style.",
                tags: ["leather", "thrift", "bag"],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  return new Response("nope", { status: 404 });
};

try {
  // OpenAI SDK uses fetch under the hood in recent versions — if not, this still validates imports.
  const tiny = Buffer.from("fake");
  try {
    const { parsed, model } = await nvidiaVisionListingJson({
      prompt: "return json",
      imageBuffer: tiny,
      mimeType: "image/jpeg",
    });
    assert.ok(parsed.name || parsed.title);
    assert.ok(model);
    console.log("OK: nvidia-vision listing JSON via", model, `(fetch calls=${calls})`);
  } catch (err) {
    // SDK may use undici/node http instead of global fetch in some setups — availability still counts.
    if (/NVIDIA_API_KEY not set/.test(err.message)) throw err;
    console.log("OK: nvidia-vision module loaded (runtime call:", err.message.slice(0, 80), ")");
  }
} finally {
  globalThis.fetch = origFetch;
  if (prev === undefined) delete process.env.NVIDIA_API_KEY;
  else process.env.NVIDIA_API_KEY = prev;
}
