#!/usr/bin/env node
/** Unit checks for multi-provider listing studio (no real network). */
import {
  isStudioConfigured,
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
  "CLOUDINARY_DELETE_AFTER",
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
const tiny = Buffer.from("fake-jpeg");

async function main() {
  clearStudioEnv();
  if (isStudioConfigured()) throw new Error("isStudioConfigured should be false without keys");
  if (listConfiguredProviders().length) throw new Error("no providers expected");

  const skipped = await removeBackground(tiny, "image/jpeg");
  if (skipped.studioApplied || skipped.reason !== "not_configured") {
    throw new Error(`removeBackground without key failed: ${JSON.stringify(skipped)}`);
  }

  // Photoroom path
  process.env.PHOTOROOM_API_KEY = "test-key";
  if (!isStudioConfigured()) throw new Error("photoroom should enable studio");
  if (getStudioMeta().studioProvider !== "photoroom") {
    throw new Error(`expected photoroom primary, got ${getStudioMeta().studioProvider}`);
  }

  const missing = await removeBackground(Buffer.alloc(0), "image/jpeg");
  if (missing.studioApplied || missing.reason !== "missing_image") {
    throw new Error(`missing image: ${JSON.stringify(missing)}`);
  }

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });

  try {
    const ok = await removeBackground(tiny, "image/jpeg");
    if (!ok.studioApplied || ok.provider !== "photoroom" || !ok.buffer.equals(cleanPng)) {
      throw new Error(`photoroom success failed: ${JSON.stringify(ok)}`);
    }

    globalThis.fetch = async () => new Response("nope", { status: 500 });
    const failed = await removeBackground(tiny, "image/jpeg");
    if (failed.studioApplied || failed.reason !== "api_failed") {
      throw new Error(`photoroom api_failed: ${JSON.stringify(failed)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Cloudinary → Hugging Face fallback chain
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.HUGGINGFACE_API_KEY = "hf_test";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "auto";

  const order = resolveProviderOrder();
  if (order[0] !== "cloudinary" || !order.includes("huggingface")) {
    throw new Error(`auto order wrong: ${order.join(",")}`);
  }

  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const u = String(url);
    if (u.includes("api.cloudinary.com") && u.includes("/upload")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/listing_1" }), {
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
    if (!fallback.studioApplied || fallback.provider !== "huggingface") {
      throw new Error(`expected HF fallback: ${JSON.stringify(fallback)} calls=${calls}`);
    }

    const preview = await previewStudioClean(tiny, "image/jpeg");
    if (!preview.studioApplied || preview.provider !== "huggingface") {
      throw new Error(`preview fallback failed: ${JSON.stringify(preview)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Pin Cloudinary success
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.PHOTOROOM_API_KEY = "pr";
  process.env.STUDIO_PROVIDER = "cloudinary";
  process.env.CLOUDINARY_DELETE_AFTER = "false";

  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/image/upload")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/x" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("e_background_removal")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("photoroom")) throw new Error("should not call photoroom when pinned");
    return new Response("nope", { status: 500 });
  };

  try {
    const pinned = await removeBackground(tiny, "image/jpeg");
    if (!pinned.studioApplied || pinned.provider !== "cloudinary") {
      throw new Error(`pinned cloudinary failed: ${JSON.stringify(pinned)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log("OK: multi-provider listing-studio helpers");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(restoreEnv);
