#!/usr/bin/env node
/** Unit checks for multi-provider listing studio + Cloudinary clips (no real network). */
import {
  isStudioConfigured,
  isStudioClipEnabled,
  listConfiguredProviders,
  resolveProviderOrder,
  resolveClipTransform,
  removeBackground,
  previewStudioClean,
  getStudioMeta,
} from "../src/services/listing-studio.js";

const ENV_KEYS = [
  "PHOTOROOM_API_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACE_RMBG_URL",
  "HUGGINGFACE_RMBG_MODEL",
  "STUDIO_REMOTE_URL",
  "STUDIO_PROVIDER",
  "STUDIO_FALLBACK",
  "STUDIO_CLIP_ENABLED",
  "STUDIO_CLIP_INLINE",
  "CLOUDINARY_DELETE_AFTER",
  "CLOUDINARY_CLIP_TRANS",
  "CLOUDINARY_BG_EFFECT",
  "CLOUDINARY_DERIVED_ATTEMPTS",
];

const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function clearStudioEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

const cleanPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakeMp4 = Buffer.alloc(512, 1);
fakeMp4.write("ftyp", 4);
const tiny = Buffer.from("fake-jpeg");

async function main() {
  clearStudioEnv();
  if (isStudioConfigured()) throw new Error("isStudioConfigured should be false without keys");
  if (isStudioClipEnabled()) throw new Error("clip should be off without cloudinary");

  const skipped = await removeBackground(tiny, "image/jpeg");
  if (skipped.studioApplied || skipped.reason !== "not_configured") {
    throw new Error(`removeBackground without key failed: ${JSON.stringify(skipped)}`);
  }

  // Clip transform strips legacy bg-removal prefix
  process.env.CLOUDINARY_CLIP_TRANS =
    "e_background_removal/b_rgb:FFF8F0/e_zoompan:mode_ztc;maxzoom_1.25;du_5;fps_25";
  const stripped = resolveClipTransform();
  if (/background_removal/i.test(stripped) || !/zoompan/i.test(stripped)) {
    throw new Error(`resolveClipTransform should strip bg removal: ${stripped}`);
  }
  delete process.env.CLOUDINARY_CLIP_TRANS;
  if (!/e_shadow|zoompan|c_pad/i.test(resolveClipTransform())) {
    throw new Error(`default clip transform unexpected: ${resolveClipTransform()}`);
  }

  // Photoroom — image only (no Cloudinary → no clip)
  process.env.PHOTOROOM_API_KEY = "test-key";
  if (isStudioClipEnabled()) throw new Error("photoroom must not enable clips without cloudinary");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
  try {
    const ok = await removeBackground(tiny, "image/jpeg");
    if (!ok.studioApplied || ok.provider !== "photoroom" || ok.clipBuffer || ok.clipUrl) {
      throw new Error(`photoroom should not return clip: ${JSON.stringify(ok)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Cloudinary clean + clip-from-clean (URL, no inline base64)
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "cloudinary";

  if (!isStudioClipEnabled()) throw new Error("cloudinary should enable clips by default");
  if (getStudioMeta().studioClipEnabled !== true) throw new Error("meta.studioClipEnabled expected");

  let uploadCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      uploadCount += 1;
      const id = uploadCount === 1 ? "sokoni-studio/listing_x" : "sokoni-studio/clip_y";
      return new Response(JSON.stringify({ public_id: id }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (method === "HEAD" && (u.includes("f_mp4") || u.includes(".mp4"))) {
      return new Response(null, { status: 200 });
    }
    if (u.includes("f_png") || (u.includes("e_background_removal") && !u.includes("f_mp4"))) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      return new Response(fakeMp4, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }
    return new Response("nope", { status: 500 });
  };

  try {
    const withClip = await removeBackground(tiny, "image/jpeg");
    if (
      !withClip.studioApplied ||
      withClip.provider !== "cloudinary" ||
      !withClip.clipUrl ||
      withClip.clipBuffer
    ) {
      throw new Error(
        `cloudinary clip URL missing: ${JSON.stringify({
          ...withClip,
          clipBuffer: !!withClip.clipBuffer,
        })}`
      );
    }
    if (uploadCount < 2) {
      throw new Error(`expected clean upload + clip upload, got ${uploadCount}`);
    }
    if (/e_background_removal/i.test(withClip.clipUrl)) {
      throw new Error(`clip URL must not re-run bg removal: ${withClip.clipUrl}`);
    }

    const preview = await previewStudioClean(tiny, "image/jpeg");
    if (
      !preview.studioApplied ||
      !preview.clipApplied ||
      !preview.clipVideoUrl ||
      preview.clipVideoBase64
    ) {
      throw new Error(`preview should return clipVideoUrl only: ${JSON.stringify(preview)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Inline base64 when STUDIO_CLIP_INLINE=true
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_INLINE = "true";
  uploadCount = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      uploadCount += 1;
      return new Response(JSON.stringify({ public_id: `sokoni-studio/z${uploadCount}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("e_background_removal") || (u.includes("f_png") && !u.includes("f_mp4"))) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      return new Response(fakeMp4, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const preview = await previewStudioClean(tiny, "image/jpeg");
    if (!String(preview.clipVideoBase64 || "").startsWith("data:video/mp4")) {
      throw new Error(`inline clip base64 expected: ${JSON.stringify(preview)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Cloudinary clean ok, clip fails — still return clean image
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/y" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      if (method === "HEAD") return new Response(null, { status: 500 });
      return new Response("clip-fail", { status: 500 });
    }
    if (u.includes("e_background_removal") || u.includes("f_png")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return new Response("nope", { status: 500 });
  };

  try {
    const soft = await previewStudioClean(tiny, "image/jpeg");
    if (!soft.studioApplied || soft.clipApplied) {
      throw new Error(`clip soft-fail expected clean only: ${JSON.stringify(soft)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // 423 pending then success (Cloudinary derived still generating)
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_ENABLED = "false";
  process.env.CLOUDINARY_DERIVED_ATTEMPTS = "3";
  let pngHits = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/pending" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("e_background_removal") || u.includes("f_png")) {
      pngHits += 1;
      if (pngHits < 2) return new Response("pending", { status: 423 });
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const pending = await removeBackground(tiny, "image/jpeg");
    if (!pending.studioApplied || pngHits < 2) {
      throw new Error(`423 retry failed: applied=${pending.studioApplied} hits=${pngHits}`);
    }
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.CLOUDINARY_DERIVED_ATTEMPTS;
  }

  // Photoroom clean + Cloudinary clip-from-clean
  clearStudioEnv();
  process.env.PHOTOROOM_API_KEY = "pr_test";
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "photoroom";

  if (!isStudioClipEnabled()) throw new Error("clips should enable when cloudinary present");

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("photoroom.com")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/from_pr" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (method === "HEAD" && (u.includes("f_mp4") || u.includes(".mp4"))) {
      return new Response(null, { status: 200 });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      return new Response(fakeMp4, { status: 200 });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const hybrid = await removeBackground(tiny, "image/jpeg");
    if (!hybrid.studioApplied || hybrid.provider !== "photoroom" || !hybrid.clipUrl) {
      throw new Error(`photoroom+cloudinary clip expected: ${JSON.stringify(hybrid)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // HF fallback after Cloudinary BG fail — clip still attempted from HF clean
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.HUGGINGFACE_API_KEY = "hf_test";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_ENABLED = "false";

  const order = resolveProviderOrder();
  if (order[0] !== "cloudinary" || !order.includes("huggingface")) {
    throw new Error(`auto order wrong: ${order.join(",")}`);
  }

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("res.cloudinary.com")) {
      return new Response("cloudinary-down", { status: 403 });
    }
    if (u.includes("huggingface") || u.includes("router.huggingface")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return new Response("unexpected", { status: 500 });
  };

  try {
    const fallback = await removeBackground(tiny, "image/jpeg");
    if (!fallback.studioApplied || fallback.provider !== "huggingface" || fallback.clipUrl) {
      throw new Error(`HF fallback image-only (clips off): ${JSON.stringify(fallback)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  if (!listConfiguredProviders().length && false) throw new Error("unreachable");
  console.log("OK: multi-provider listing-studio + clip-from-clean");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(restoreEnv);
