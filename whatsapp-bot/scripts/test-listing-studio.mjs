#!/usr/bin/env node
/** Unit checks for listing studio providers (no real Photoroom/rembg network). */
import {
  isStudioConfigured,
  resolveStudioProvider,
  removeBackground,
  previewStudioClean,
  getStudioMeta,
} from "../src/services/listing-studio.js";
import { _resetMediaJobsForTests } from "../src/services/media-jobs.js";

const prev = {
  PHOTOROOM_API_KEY: process.env.PHOTOROOM_API_KEY,
  REMBG_URL: process.env.REMBG_URL,
  STUDIO_PROVIDER: process.env.STUDIO_PROVIDER,
  STUDIO_FALLBACK_REMBG: process.env.STUDIO_FALLBACK_REMBG,
  STUDIO_CLIP_ENABLED: process.env.STUDIO_CLIP_ENABLED,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function main() {
  _resetMediaJobsForTests();
  delete process.env.PHOTOROOM_API_KEY;
  delete process.env.REMBG_URL;
  process.env.STUDIO_PROVIDER = "auto";

  if (resolveStudioProvider() !== "none") {
    throw new Error(`expected none, got ${resolveStudioProvider()}`);
  }
  if (isStudioConfigured()) throw new Error("isStudioConfigured should be false without providers");

  const tiny = Buffer.from("fake-jpeg");
  const skipped = await removeBackground(tiny, "image/jpeg");
  if (skipped.studioApplied || skipped.reason !== "not_configured") {
    throw new Error(`removeBackground without provider failed: ${JSON.stringify(skipped)}`);
  }

  const preview = await previewStudioClean(tiny, "image/jpeg");
  if (preview.studioApplied || !preview.message || preview.cleanImageBase64) {
    throw new Error(`previewStudioClean without provider failed: ${JSON.stringify(preview)}`);
  }

  process.env.PHOTOROOM_API_KEY = "test-key";
  if (resolveStudioProvider() !== "photoroom") {
    throw new Error(`expected photoroom auto, got ${resolveStudioProvider()}`);
  }
  if (!isStudioConfigured()) throw new Error("isStudioConfigured should be true with Photoroom key");

  const missing = await removeBackground(Buffer.alloc(0), "image/jpeg");
  if (missing.studioApplied || missing.reason !== "missing_image") {
    throw new Error(`missing image with key: ${JSON.stringify(missing)}`);
  }

  const cleanPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("photoroom")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("/health")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/api/remove")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return new Response("nope", { status: 500 });
  };

  try {
    _resetMediaJobsForTests();
    const ok = await removeBackground(tiny, "image/jpeg");
    if (!ok.studioApplied || ok.mimeType !== "image/png" || !ok.buffer.equals(cleanPng)) {
      throw new Error(`removeBackground Photoroom mock failed: ${JSON.stringify(ok)}`);
    }
    if (ok.provider !== "photoroom") throw new Error(`provider ${ok.provider}`);

    globalThis.fetch = async () => new Response("nope", { status: 500 });
    _resetMediaJobsForTests();
    const failed = await removeBackground(tiny, "image/jpeg");
    if (failed.studioApplied || failed.reason !== "api_failed") {
      throw new Error(`removeBackground api_failed: ${JSON.stringify(failed)}`);
    }

    // rembg provider
    delete process.env.PHOTOROOM_API_KEY;
    process.env.REMBG_URL = "http://127.0.0.1:7000";
    process.env.STUDIO_PROVIDER = "rembg";
    if (resolveStudioProvider() !== "rembg") {
      throw new Error(`expected rembg, got ${resolveStudioProvider()}`);
    }

    globalThis.fetch = async (url) => {
      if (String(url).includes("/api/remove")) {
        return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
      }
      return new Response("nope", { status: 404 });
    };
    _resetMediaJobsForTests();
    const rembgOk = await removeBackground(tiny, "image/jpeg");
    if (!rembgOk.studioApplied || rembgOk.provider !== "rembg") {
      throw new Error(`rembg mock failed: ${JSON.stringify(rembgOk)}`);
    }

    // worker down
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    _resetMediaJobsForTests();
    const down = await removeBackground(tiny, "image/jpeg");
    if (down.studioApplied || down.reason !== "worker_down") {
      throw new Error(`worker_down expected: ${JSON.stringify(down)}`);
    }

    const meta = getStudioMeta();
    if (!meta.rembgUrlConfigured) throw new Error("meta rembgUrlConfigured");
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log("OK: listing-studio providers (photoroom + rembg + worker_down)");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(() => {
    restoreEnv();
    _resetMediaJobsForTests();
  });
