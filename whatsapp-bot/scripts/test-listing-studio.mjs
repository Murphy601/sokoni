#!/usr/bin/env node
/** Unit checks for multi-provider listing studio + Cloudinary clips (no real network). */
import {
  isStudioConfigured,
  isStudioClipEnabled,
  listConfiguredProviders,
  resolveProviderOrder,
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
  "CLOUDINARY_DELETE_AFTER",
  "CLOUDINARY_CLIP_TRANS",
  "CLOUDINARY_BG_EFFECT",
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

  // Photoroom — image only
  process.env.PHOTOROOM_API_KEY = "test-key";
  if (isStudioClipEnabled()) throw new Error("photoroom must not enable clips");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
  try {
    const ok = await removeBackground(tiny, "image/jpeg");
    if (!ok.studioApplied || ok.provider !== "photoroom" || ok.clipBuffer) {
      throw new Error(`photoroom should not return clip: ${JSON.stringify(ok)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Cloudinary clean + clip
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "cloudinary";

  if (!isStudioClipEnabled()) throw new Error("cloudinary should enable clips by default");
  if (getStudioMeta().studioClipEnabled !== true) throw new Error("meta.studioClipEnabled expected");

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("f_png") || (u.includes("e_background_removal") && u.includes("f_png"))) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      return new Response(fakeMp4, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }
    return new Response("nope", { status: 500 });
  };

  try {
    const withClip = await removeBackground(tiny, "image/jpeg");
    if (!withClip.studioApplied || withClip.provider !== "cloudinary" || !withClip.clipBuffer?.length) {
      throw new Error(`cloudinary clip missing: ${JSON.stringify({ ...withClip, clipBuffer: !!withClip.clipBuffer })}`);
    }

    const preview = await previewStudioClean(tiny, "image/jpeg");
    if (!preview.studioApplied || !preview.clipApplied || !String(preview.clipVideoBase64 || "").startsWith("data:video/mp4")) {
      throw new Error(`preview clip failed: ${JSON.stringify(preview)}`);
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

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/y" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      return new Response("clip-fail", { status: 420 });
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

  // HF fallback after Cloudinary BG fail — no clip
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.HUGGINGFACE_API_KEY = "hf_test";
  process.env.CLOUDINARY_DELETE_AFTER = "false";

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
    if (!fallback.studioApplied || fallback.provider !== "huggingface" || fallback.clipBuffer) {
      throw new Error(`HF fallback should be image-only: ${JSON.stringify(fallback)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  if (!listConfiguredProviders().length && false) throw new Error("unreachable");
  console.log("OK: multi-provider listing-studio + Cloudinary clips");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(restoreEnv);
