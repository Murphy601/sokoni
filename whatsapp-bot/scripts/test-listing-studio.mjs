#!/usr/bin/env node
/** Unit checks for Photoroom listing studio (no network calls). */
import {
  isStudioConfigured,
  removeBackground,
  previewStudioClean,
} from "../src/services/listing-studio.js";

const prevKey = process.env.PHOTOROOM_API_KEY;

async function main() {
  delete process.env.PHOTOROOM_API_KEY;
  if (isStudioConfigured()) throw new Error("isStudioConfigured should be false without key");

  const tiny = Buffer.from("fake-jpeg");
  const skipped = await removeBackground(tiny, "image/jpeg");
  if (skipped.studioApplied || skipped.reason !== "not_configured") {
    throw new Error(`removeBackground without key failed: ${JSON.stringify(skipped)}`);
  }

  const preview = await previewStudioClean(tiny, "image/jpeg");
  if (preview.studioApplied || !preview.message || preview.cleanImageBase64) {
    throw new Error(`previewStudioClean without key failed: ${JSON.stringify(preview)}`);
  }

  process.env.PHOTOROOM_API_KEY = "test-key";
  if (!isStudioConfigured()) throw new Error("isStudioConfigured should be true with key");

  const missing = await removeBackground(Buffer.alloc(0), "image/jpeg");
  if (missing.studioApplied || missing.reason !== "missing_image") {
    throw new Error(`missing image with key: ${JSON.stringify(missing)}`);
  }

  const cleanPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });

  try {
    const ok = await removeBackground(tiny, "image/jpeg");
    if (!ok.studioApplied || ok.mimeType !== "image/png" || !ok.buffer.equals(cleanPng)) {
      throw new Error(`removeBackground mock success failed: ${JSON.stringify(ok)}`);
    }

    const okPreview = await previewStudioClean(tiny, "image/jpeg");
    if (
      !okPreview.studioApplied ||
      !String(okPreview.cleanImageBase64 || "").startsWith("data:image/png;base64,")
    ) {
      throw new Error(`previewStudioClean mock success failed: ${JSON.stringify(okPreview)}`);
    }

    globalThis.fetch = async () => new Response("nope", { status: 500 });
    const failed = await removeBackground(tiny, "image/jpeg");
    if (failed.studioApplied || failed.reason !== "api_failed") {
      throw new Error(`removeBackground api_failed: ${JSON.stringify(failed)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log("OK: Photoroom listing-studio helpers");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(() => {
    if (prevKey === undefined) delete process.env.PHOTOROOM_API_KEY;
    else process.env.PHOTOROOM_API_KEY = prevKey;
  });
