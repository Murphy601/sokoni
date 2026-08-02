#!/usr/bin/env node
/** Unit checks for multi-provider listing studio + cutout-based clips (no real network). */
import {
  isStudioConfigured,
  isStudioClipEnabled,
  listConfiguredProviders,
  resolveProviderOrder,
  resolveClipTransform,
  resolveClipTransformFromOriginal,
  removeBackground,
  previewStudioClean,
  prepareListingShowcaseMedia,
  cloudinaryPublicIdFromUrl,
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
  "STUDIO_INLINE_IMAGES",
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

  process.env.CLOUDINARY_CLIP_TRANS =
    "e_background_removal/b_rgb:FFF8F0/e_zoompan:mode_ztc;maxzoom_1.25;du_5;fps_25";
  const stripped = resolveClipTransform();
  if (/background_removal/i.test(stripped) || !/zoompan/i.test(stripped)) {
    throw new Error(`resolveClipTransform should strip bg removal: ${stripped}`);
  }
  delete process.env.CLOUDINARY_CLIP_TRANS;
  if (!/^e_background_removal\//i.test(resolveClipTransformFromOriginal())) {
    throw new Error("from-original helper should prefix bg-removal");
  }

  // Photoroom — image only (no Cloudinary → no clip / no CDN clean)
  process.env.PHOTOROOM_API_KEY = "test-key";
  if (isStudioClipEnabled()) throw new Error("photoroom must not enable clips without cloudinary");
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
  try {
    const ok = await removeBackground(tiny, "image/jpeg");
    if (!ok.studioApplied || ok.provider !== "photoroom" || ok.clipUrl || ok.cleanUrl) {
      throw new Error(`photoroom-only unexpected: ${JSON.stringify(ok)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Cloudinary: original upload → clean derived ready → cutout re-upload → clip on cutout
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "cloudinary";

  if (!isStudioClipEnabled()) throw new Error("cloudinary should enable clips by default");
  if (getStudioMeta().studioClipEnabled !== true) throw new Error("meta.studioClipEnabled expected");

  let uploadCount = 0;
  let uploadedIds = [];
  let sawEagerAsyncFalse = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      uploadCount += 1;
      const body = init.body;
      if (body && typeof body.get === "function") {
        if (body.get("eager") && String(body.get("eager_async")) === "false") {
          sawEagerAsyncFalse = true;
        }
      }
      const id =
        uploadCount === 1 ? "sokoni-studio/listing_x" : "sokoni-studio/cutout_y";
      uploadedIds.push(id);
      return new Response(
        JSON.stringify({
          public_id: id,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${id}`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "HEAD") {
      // Clean derived on listing_ must be ready; clip on cutout_
      if (u.includes("listing_x") && u.includes("e_background_removal") && u.includes("f_png")) {
        return new Response(null, { status: 200 });
      }
      if (u.includes("cutout_y") && (u.includes("f_mp4") || u.includes(".mp4"))) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      // Must be cutout asset — refuse listing_ zoompan
      if (u.includes("listing_x") && !u.includes("cutout")) {
        return new Response("clip must not use original listing asset", { status: 500 });
      }
      return new Response(fakeMp4, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }
    if (u.includes("e_background_removal") || u.includes("f_png")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    return new Response("nope", { status: 500 });
  };

  try {
    const withClip = await removeBackground(tiny, "image/jpeg");
    if (
      !withClip.studioApplied ||
      withClip.provider !== "cloudinary" ||
      !withClip.cleanUrl ||
      !withClip.clipUrl ||
      withClip.buffer
    ) {
      throw new Error(
        `cloudinary cutout clip missing: ${JSON.stringify({
          ...withClip,
          buffer: !!withClip.buffer,
        })}`
      );
    }
    if (uploadCount !== 2) {
      throw new Error(`expected listing upload + cutout upload, got ${uploadCount}`);
    }
    if (!sawEagerAsyncFalse) {
      throw new Error("upload must send eager_async=false with background_removal eager");
    }
    if (!/cutout_/i.test(withClip.clipUrl) && !/cutout_y/i.test(withClip.clipUrl)) {
      throw new Error(`clip must be from cutout asset: ${withClip.clipUrl}`);
    }
    if (/listing_x/i.test(withClip.clipUrl) && /e_background_removal.*zoompan|zoompan.*listing/i.test(withClip.clipUrl)) {
      throw new Error(`clip must not zoompan original listing: ${withClip.clipUrl}`);
    }

    const preview = await previewStudioClean(tiny, "image/jpeg");
    if (
      !preview.studioApplied ||
      !preview.clipApplied ||
      !preview.cleanImageUrl ||
      !preview.clipVideoUrl ||
      preview.cleanImageBase64 ||
      preview.clipVideoBase64
    ) {
      throw new Error(`preview must be CDN URLs only: ${JSON.stringify(preview)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Public id parse + multi-photo showcase reel
  const parsed = cloudinaryPublicIdFromUrl(
    "https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/v123/sokoni-studio/cutout_abc.png"
  );
  if (parsed !== "sokoni-studio/cutout_abc") {
    throw new Error(`public id parse failed: ${parsed}`);
  }

  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_ENABLED = "true";
  let multiCalled = false;
  let reelUploadIds = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("/image/multi") && u.includes("api.cloudinary.com")) {
      multiCalled = true;
      const body = init.body;
      if (body?.get && String(body.get("format")) !== "mp4") {
        throw new Error("multi must request mp4");
      }
      return new Response(
        JSON.stringify({
          public_id: "sokoni-studio/reel_demo",
          secure_url: "https://res.cloudinary.com/demo/image/multi/dl_2000/sokoni-studio/reel_demo.mp4",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      const body = init.body;
      const pid = body?.get?.("public_id") || `slide_${reelUploadIds.length}`;
      const folder = body?.get?.("folder") || "sokoni-studio";
      const full = `${folder}/${pid}`;
      reelUploadIds.push(full);
      // listing_* uploads are raw; reel_* / cutout_* are durable slides
      return new Response(
        JSON.stringify({
          public_id: full,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${full}`,
          eager: body?.get?.("eager")
            ? [{ secure_url: `https://res.cloudinary.com/demo/image/upload/${body.get("eager")}/${full}` }]
            : undefined,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "HEAD") return new Response(null, { status: 200 });
    if (u.includes("res.cloudinary.com")) {
      if (u.includes(".mp4") || u.includes("f_mp4") || u.includes("/multi/")) {
        return new Response(fakeMp4, { status: 200 });
      }
      return new Response(cleanPng, { status: 200 });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const cutA = "https://res.cloudinary.com/demo/image/upload/sokoni-studio/cutout_a";
    const cutB = "https://res.cloudinary.com/demo/image/upload/sokoni-studio/cutout_b";
    const cutC = "https://res.cloudinary.com/demo/image/upload/sokoni-studio/cutout_c";
    const reel = await prepareListingShowcaseMedia([cutA, cutB, cutC], {
      productKey: "seller1",
    });
    if (!reel?.imageUrls?.length || reel.imageUrls.length !== 3) {
      throw new Error(`reel images expected 3: ${JSON.stringify(reel)}`);
    }
    if (!multiCalled || !reel.videoUrl || reel.videoKind !== "preview") {
      throw new Error(`multi reel missing: ${JSON.stringify(reel)} multi=${multiCalled}`);
    }
    if (!/reel_/i.test(reel.imageUrls[0]) && !reelUploadIds.some((id) => /reel_/i.test(id))) {
      throw new Error(`ordered reel slides missing: ${reelUploadIds.join(",")}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Soft-fail clip still returns clean URL
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  uploadCount = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("api.cloudinary.com")) {
      uploadCount += 1;
      const id = uploadCount === 1 ? "sokoni-studio/listing_soft" : "sokoni-studio/cutout_soft";
      return new Response(
        JSON.stringify({ public_id: id, secure_url: `https://res.cloudinary.com/demo/image/upload/${id}` }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "HEAD" && u.includes("listing_soft") && u.includes("f_png")) {
      return new Response(null, { status: 200 });
    }
    if (u.includes("f_mp4") || u.includes(".mp4") || (method === "HEAD" && u.includes("cutout"))) {
      return new Response("clip-fail", { status: 500 });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const soft = await previewStudioClean(tiny, "image/jpeg");
    if (!soft.studioApplied || soft.clipApplied || !soft.cleanImageUrl) {
      throw new Error(`clip soft-fail expected clean URL only: ${JSON.stringify(soft)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // 423 pending then success on clean HEAD
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_ENABLED = "false";
  process.env.CLOUDINARY_DERIVED_ATTEMPTS = "3";
  let headHits = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("api.cloudinary.com")) {
      return new Response(
        JSON.stringify({
          public_id: "sokoni-studio/pending",
          secure_url: "https://res.cloudinary.com/demo/image/upload/sokoni-studio/pending",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "HEAD" || u.includes("e_background_removal") || u.includes("f_png")) {
      headHits += 1;
      if (headHits < 2) return new Response("pending", { status: 423 });
      return new Response(null, { status: 200 });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const pending = await removeBackground(tiny, "image/jpeg");
    if (!pending.studioApplied || !pending.cleanUrl || headHits < 2) {
      throw new Error(`423 retry failed: applied=${pending.studioApplied} hits=${headHits}`);
    }
  } finally {
    globalThis.fetch = origFetch;
    delete process.env.CLOUDINARY_DERIVED_ATTEMPTS;
  }

  // Photoroom clean + Cloudinary cutout clip
  clearStudioEnv();
  process.env.PHOTOROOM_API_KEY = "pr_test";
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "photoroom";

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("photoroom.com")) {
      return new Response(cleanPng, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      return new Response(
        JSON.stringify({
          public_id: "sokoni-studio/cutout_from_pr",
          secure_url: "https://res.cloudinary.com/demo/image/upload/sokoni-studio/cutout_from_pr",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
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
    if (!hybrid.studioApplied || hybrid.provider !== "photoroom" || !hybrid.clipUrl || !hybrid.cleanUrl) {
      throw new Error(`photoroom+cloudinary cutout expected: ${JSON.stringify(hybrid)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // HF fallback after Cloudinary BG fail
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

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("api.cloudinary.com")) {
      return new Response(JSON.stringify({ public_id: "sokoni-studio/z" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("res.cloudinary.com")) {
      if (method === "HEAD") return new Response(null, { status: 403 });
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
      throw new Error(`HF fallback failed: ${JSON.stringify(fallback)}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  if (!listConfiguredProviders().length && false) throw new Error("unreachable");
  console.log("OK: eager_async cutouts + multi-photo showcase reel + CDN-only preview");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(restoreEnv);
