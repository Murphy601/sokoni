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
  pngHasAlpha,
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

/** Minimal PNG signature + IHDR color type 6 (RGBA) for alpha checks. */
const cleanPng = Buffer.alloc(32, 0);
cleanPng[0] = 0x89;
cleanPng[1] = 0x50;
cleanPng[2] = 0x4e;
cleanPng[3] = 0x47;
cleanPng[4] = 0x0d;
cleanPng[5] = 0x0a;
cleanPng[6] = 0x1a;
cleanPng[7] = 0x0a;
cleanPng[25] = 6; // RGBA
const opaquePng = Buffer.from(cleanPng);
opaquePng[25] = 2; // RGB, no alpha
const fakeMp4 = Buffer.alloc(512, 1);
fakeMp4.write("ftyp", 4);
const tiny = Buffer.from("fake-jpeg");

if (!pngHasAlpha(cleanPng) || pngHasAlpha(opaquePng)) {
  throw new Error("pngHasAlpha helper broken");
}

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

  // Cloudinary: upload → alpha wait → download PNG → bake overwrite → zoompan (no bg-removal in MP4)
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_PROVIDER = "cloudinary";

  if (!isStudioClipEnabled()) throw new Error("cloudinary should enable clips by default");
  if (getStudioMeta().studioClipEnabled !== true) throw new Error("meta.studioClipEnabled expected");

  let uploadCount = 0;
  let sawEagerAsyncFalse = false;
  let sawOverwrite = false;
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
        if (String(body.get("overwrite")) === "true") sawOverwrite = true;
      }
      const id = "sokoni-studio/cutout_y";
      if (uploadCount === 1) {
        return new Response(
          JSON.stringify({
            public_id: id,
            secure_url: `https://res.cloudinary.com/demo/image/upload/${id}`,
            eager: [
              {
                secure_url: `https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/${id}`,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          public_id: id,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${id}.png`,
          eager: [
            {
              secure_url: `https://res.cloudinary.com/demo/image/upload/e_zoompan:du_4/f_mp4/${id}.mp4`,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (method === "HEAD" && (u.includes("f_mp4") || u.includes(".mp4"))) {
      return new Response(null, { status: 200 });
    }
    if (u.includes("f_mp4") || u.includes(".mp4")) {
      if (/e_background_removal/i.test(u)) {
        return new Response("mp4 must not use bg-removal transform", { status: 500 });
      }
      return new Response(fakeMp4, { status: 200, headers: { "Content-Type": "video/mp4" } });
    }
    if (u.includes("e_background_removal") && u.includes("f_png")) {
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
        `cloudinary clean clip missing: ${JSON.stringify({
          ...withClip,
          buffer: !!withClip.buffer,
        })}`
      );
    }
    if (uploadCount !== 2) {
      throw new Error(`expected raw upload + bake overwrite, got ${uploadCount}`);
    }
    if (!sawEagerAsyncFalse) {
      throw new Error("upload must send eager_async=false with background_removal eager");
    }
    if (!sawOverwrite) {
      throw new Error("bake step must overwrite cutout with clean PNG bytes");
    }
    if (/e_background_removal/i.test(withClip.clipUrl)) {
      throw new Error(`baked clip must not use bg-removal in MP4 URL: ${withClip.clipUrl}`);
    }
    if (!/cutout_/i.test(withClip.clipUrl)) {
      throw new Error(`clip must target cutout asset: ${withClip.clipUrl}`);
    }

    uploadCount = 0;
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

  // Public id parse + multi-photo showcase reel via cleaned URLs
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
  let multiUrlList = [];
  let bakeUploads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("/image/multi") && u.includes("api.cloudinary.com")) {
      multiCalled = true;
      const body = init.body;
      // Cloudinary REST expects repeated urls[] — not a pipe-separated urls field.
      multiUrlList = typeof body?.getAll === "function" ? body.getAll("urls[]") : [];
      if (body?.get && String(body.get("format")) !== "mp4") {
        throw new Error("multi must request mp4");
      }
      if (multiUrlList.length < 2) {
        throw new Error(`multi must send urls[] array, got: ${JSON.stringify(multiUrlList)} urls=${body?.get?.("urls")}`);
      }
      if (multiUrlList.some((x) => /e_background_removal/i.test(String(x)))) {
        throw new Error(`multi urls must be base delivery URLs, got transforms: ${multiUrlList[0]}`);
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
      bakeUploads += 1;
      const body = init.body;
      const pid = body?.get?.("public_id") || `reel_${bakeUploads}`;
      const folder = body?.get?.("folder") || "sokoni-studio";
      const full = `${folder}/${pid}`;
      return new Response(
        JSON.stringify({
          public_id: full,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${full}.png`,
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
    const cutA =
      "https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/sokoni-studio/cutout_a";
    const cutB =
      "https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/sokoni-studio/cutout_b";
    const cutC =
      "https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/sokoni-studio/cutout_c";
    const reel = await prepareListingShowcaseMedia([cutA, cutB, cutC], {
      productKey: "seller1",
    });
    if (!reel?.imageUrls?.length || reel.imageUrls.length !== 3) {
      throw new Error(`reel images expected 3: ${JSON.stringify(reel)}`);
    }
    if (bakeUploads < 3) {
      throw new Error(`expected 3 bake uploads for multi slides, got ${bakeUploads}`);
    }
    if (!multiCalled || !reel.videoUrl || reel.videoKind !== "preview") {
      throw new Error(`multi reel missing: ${JSON.stringify(reel)} multi=${multiCalled}`);
    }
  } finally {
    globalThis.fetch = origFetch;
  }

  // Soft-fail clip still returns clean URL (bake OK, mp4 fails)
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  let softUploads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      softUploads += 1;
      const id = "sokoni-studio/cutout_soft";
      if (softUploads === 1) {
        return new Response(
          JSON.stringify({
            public_id: id,
            secure_url: `https://res.cloudinary.com/demo/image/upload/${id}`,
            eager: [
              {
                secure_url: `https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/${id}`,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          public_id: id,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${id}.png`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes("f_mp4") || u.includes(".mp4") || (method === "HEAD" && u.includes("f_mp4"))) {
      return new Response("clip-fail", { status: 500 });
    }
    if (u.includes("e_background_removal") && u.includes("f_png")) {
      return new Response(cleanPng, { status: 200 });
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

  // 423 pending then alpha PNG + bake
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_ENABLED = "false";
  process.env.CLOUDINARY_DERIVED_ATTEMPTS = "3";
  let cleanHits = 0;
  let pendingUploads = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      pendingUploads += 1;
      const id = "sokoni-studio/cutout_pending";
      if (pendingUploads === 1) {
        return new Response(
          JSON.stringify({
            public_id: id,
            secure_url: `https://res.cloudinary.com/demo/image/upload/${id}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          public_id: id,
          secure_url: `https://res.cloudinary.com/demo/image/upload/${id}.png`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes("e_background_removal") || u.includes("f_png")) {
      cleanHits += 1;
      if (cleanHits < 2) return new Response("pending", { status: 423 });
      return new Response(cleanPng, { status: 200 });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const pending = await removeBackground(tiny, "image/jpeg");
    if (!pending.studioApplied || !pending.cleanUrl || cleanHits < 2 || pendingUploads < 2) {
      throw new Error(
        `423 retry/bake failed: applied=${pending.studioApplied} hits=${cleanHits} uploads=${pendingUploads}`
      );
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
  process.env.CLOUDINARY_DERIVED_ATTEMPTS = "2";

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

  // Multi-photo previewStudioClean builds one reel (what sellers hit from Preview).
  clearStudioEnv();
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
  process.env.CLOUDINARY_DELETE_AFTER = "false";
  process.env.STUDIO_CLIP_ENABLED = "true";
  process.env.STUDIO_PROVIDER = "cloudinary";
  let previewMultiCalled = false;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = String(init.method || "GET").toUpperCase();
    if (u.includes("/image/multi") && u.includes("api.cloudinary.com")) {
      previewMultiCalled = true;
      const body = init.body;
      const urls = typeof body?.getAll === "function" ? body.getAll("urls[]") : [];
      if (urls.length < 2 && !body?.get?.("tag")) {
        throw new Error("preview multi needs urls[] or tag");
      }
      return new Response(
        JSON.stringify({
          secure_url: "https://res.cloudinary.com/demo/image/multi/v1/reel_preview.mp4",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (u.includes("/image/upload") && u.includes("api.cloudinary.com")) {
      const body = init.body;
      const pid = body?.get?.("public_id") || "cutout_x";
      const folder = body?.get?.("folder") || "sokoni-studio";
      const full = `${folder}/${pid}`;
      const eager = body?.get?.("eager") || "";
      const payload = {
        public_id: full,
        secure_url: `https://res.cloudinary.com/demo/image/upload/${full}.png`,
      };
      if (String(eager).includes("background_removal")) {
        payload.eager = [
          {
            secure_url: `https://res.cloudinary.com/demo/image/upload/e_background_removal/f_png/${full}.png`,
          },
        ];
      } else if (String(eager).includes("mp4") || String(eager).includes("zoompan")) {
        payload.eager = [
          { secure_url: `https://res.cloudinary.com/demo/image/upload/e_zoompan/f_mp4/${full}.mp4` },
        ];
      }
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (method === "HEAD") return new Response(null, { status: 200 });
    if (u.includes("res.cloudinary.com")) {
      if (u.includes(".mp4") || u.includes("f_mp4") || u.includes("/multi/")) {
        return new Response(fakeMp4, { status: 200 });
      }
      // Range / GET for alpha wait — return RGBA PNG
      return new Response(cleanPng, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }
    return new Response("nope", { status: 500 });
  };
  try {
    const multiPreview = await previewStudioClean([tiny, tiny], "image/jpeg");
    if (!multiPreview.studioApplied || !multiPreview.clipApplied || !multiPreview.clipVideoUrl) {
      throw new Error(`multi preview missing reel: ${JSON.stringify(multiPreview)}`);
    }
    if (!Array.isArray(multiPreview.imageUrls) || multiPreview.imageUrls.length < 2) {
      throw new Error(`multi preview imageUrls: ${JSON.stringify(multiPreview.imageUrls)}`);
    }
    if (!previewMultiCalled) throw new Error("multi preview never called Cloudinary multi");
  } finally {
    globalThis.fetch = origFetch;
  }

  if (!listConfiguredProviders().length && false) throw new Error("unreachable");
  console.log("OK: baked clean PNG clips + multi urls[] reel + multi preview + CDN-only preview");
}

main()
  .catch((err) => {
    console.error("FAIL:", err.message);
    process.exit(1);
  })
  .finally(restoreEnv);
