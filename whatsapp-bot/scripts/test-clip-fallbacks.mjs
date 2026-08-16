#!/usr/bin/env node
/** Unit checks for HyperFrames / Remotion clip fallbacks (no real network). */
import {
  listConfiguredClipFallbacks,
  isClipFallbackConfigured,
  isHyperframesConfigured,
  isRemotionConfigured,
  zipStoreFiles,
  buildHyperframesCompositionHtml,
  tryClipFallbacks,
  renderWithHyperframes,
  renderWithRemotion,
} from "../src/services/clip-fallbacks.js";
import { getStudioMeta } from "../src/services/listing-studio.js";

const ENV_KEYS = [
  "STUDIO_CLIP_ENABLED",
  "STUDIO_CLIP_FALLBACKS",
  "HEYGEN_API_KEY",
  "HYPERFRAMES_API_KEY",
  "HYPERFRAMES_PROJECT_ASSET_ID",
  "HYPERFRAMES_PROJECT_URL",
  "REMOTION_RENDER_URL",
  "REMOTION_RENDER_KEY",
  "REMOTION_SERVE_URL",
  "REMOTION_FUNCTION_NAME",
  "REMOTION_REGION",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];

const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

clearEnv();

assert(!isClipFallbackConfigured(), "no keys → not configured");
assert(!isHyperframesConfigured(), "hyperframes off");
assert(!isRemotionConfigured(), "remotion off");
assert(listConfiguredClipFallbacks().length === 0, "empty list");

process.env.HEYGEN_API_KEY = "hg_test";
assert(isHyperframesConfigured(), "heygen key enables hyperframes");
assert(listConfiguredClipFallbacks().join(",") === "hyperframes", "default order with heygen only");

process.env.REMOTION_RENDER_URL = "https://example.com/render";
assert(isRemotionConfigured(), "render url enables remotion");
assert(
  listConfiguredClipFallbacks().join(",") === "hyperframes,remotion",
  "default order both"
);

process.env.STUDIO_CLIP_FALLBACKS = "remotion,hyperframes";
assert(
  listConfiguredClipFallbacks().join(",") === "remotion,hyperframes",
  "custom order"
);

const html = buildHyperframesCompositionHtml([
  "https://res.cloudinary.com/demo/image/upload/sample.jpg",
]);
assert(html.includes("data-composition-id"), "composition id");
assert(html.includes("FFF8F0"), "cream stage");
assert(html.includes("sample.jpg"), "image url embedded");

const zip = zipStoreFiles({ "index.html": html });
assert(zip[0] === 0x50 && zip[1] === 0x4b, "zip magic");
assert(zip.length > 100, "zip has content");

// tryClipFallbacks with STUDIO_CLIP_ENABLED=false → null
process.env.STUDIO_CLIP_ENABLED = "false";
const skipped = await tryClipFallbacks([
  "https://res.cloudinary.com/demo/image/upload/sample.jpg",
]);
assert(skipped === null, "clip disabled skips fallbacks");
delete process.env.STUDIO_CLIP_ENABLED;

// Mock HyperFrames submit + poll + Cloudinary rehost
const origFetch = globalThis.fetch;
let fetchCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  fetchCalls.push({ u, method: opts.method || "GET" });
  if (u.includes("api.heygen.com/v3/hyperframes/renders") && (opts.method || "GET") === "POST") {
    return new Response(JSON.stringify({ data: { render_id: "hfr_test" } }), { status: 202 });
  }
  if (u.includes("api.heygen.com/v3/hyperframes/renders/hfr_test")) {
    return new Response(
      JSON.stringify({
        data: {
          status: "completed",
          video_url: "https://cdn.example.com/ephemeral.mp4",
        },
      }),
      { status: 200 }
    );
  }
  if (u.includes("api.cloudinary.com") && u.includes("/video/upload")) {
    return new Response(
      JSON.stringify({
        secure_url: "https://res.cloudinary.com/demo/video/upload/v1/fallback_test.mp4",
      }),
      { status: 200 }
    );
  }
  return new Response("nope", { status: 404 });
};

clearEnv();
process.env.HEYGEN_API_KEY = "hg_test";
process.env.CLOUDINARY_CLOUD_NAME = "demo";
process.env.CLOUDINARY_API_KEY = "key";
process.env.CLOUDINARY_API_SECRET = "secret";
process.env.HYPERFRAMES_TIMEOUT_MS = "5000";
process.env.HYPERFRAMES_POLL_MS = "10";

const hf = await renderWithHyperframes([
  "https://res.cloudinary.com/demo/image/upload/a.jpg",
]);
assert(hf?.provider === "hyperframes", "hyperframes provider");
assert(hf?.videoUrl?.includes("ephemeral.mp4"), "hyperframes video url");

fetchCalls = [];
const viaTry = await tryClipFallbacks([
  "https://res.cloudinary.com/demo/image/upload/a.jpg",
]);
assert(viaTry?.provider === "hyperframes", "tryClipFallbacks hyperframes");
assert(viaTry?.videoUrl?.includes("res.cloudinary.com"), "rehosted to cloudinary");

// Remotion HTTP
clearEnv();
process.env.REMOTION_RENDER_URL = "https://remotion.example/render";
process.env.CLOUDINARY_CLOUD_NAME = "demo";
process.env.CLOUDINARY_API_KEY = "key";
process.env.CLOUDINARY_API_SECRET = "secret";
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("remotion.example/render")) {
    return new Response(
      JSON.stringify({ videoUrl: "https://remotion.example/out.mp4" }),
      { status: 200 }
    );
  }
  if (u.includes("api.cloudinary.com") && u.includes("/video/upload")) {
    return new Response(
      JSON.stringify({
        secure_url: "https://res.cloudinary.com/demo/video/upload/v1/remotion_hosted.mp4",
      }),
      { status: 200 }
    );
  }
  return new Response("nope", { status: 404 });
};

const rem = await renderWithRemotion([
  "https://res.cloudinary.com/demo/image/upload/a.jpg",
]);
assert(rem?.provider === "remotion", "remotion provider");
const remTry = await tryClipFallbacks([
  "https://res.cloudinary.com/demo/image/upload/a.jpg",
]);
assert(remTry?.videoUrl?.includes("remotion_hosted"), "remotion rehosted");

globalThis.fetch = origFetch;
clearEnv();
const meta = getStudioMeta();
assert(Array.isArray(meta.studioClipFallbacks), "meta exposes fallbacks");
assert(meta.studioClipFallbackConfigured === false, "meta false when unset");

restoreEnv();
console.log("clip-fallbacks tests OK");
