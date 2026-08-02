/**
 * AI Photo Studio — cloud background removal (+ optional short product clip).
 * Providers (zero disk/RAM on the bot VM):
 *   - cloudinary  — clean PNG via e_background_removal
 *   - huggingface — image cleanup only (RMBG / Inference)
 *   - photoroom   — image cleanup only (Segment API)
 *   - remote      — POST→PNG microservice (Modal/Render rembg)
 *
 * Product clips: always from a re-uploaded cleaned cutout asset (never zoompan
 * the raw phone photo). Cloudinary fetches the cleaned derived URL server-side.
 *
 * Studio API returns CDN URLs only (cleanImageUrl + clipVideoUrl) so the 1GB
 * bot does not JSON-encode multi‑MB PNG/MP4 (that was taking Sokoni down).
 * Set STUDIO_INLINE_IMAGES / STUDIO_CLIP_INLINE only for tests.
 *
 * STUDIO_PROVIDER=auto (default) tries configured providers free-first:
 *   cloudinary → huggingface → photoroom → remote
 * Failures always keep the original image. Bot boot never depends on studio.
 */
import crypto from "node:crypto";
import { generateListingFromImage } from "./listing-generator.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

const ALL_PROVIDERS = ["cloudinary", "huggingface", "photoroom", "remote"];

/** Photoroom-like clip from a transparent cutout — no background_removal here. */
/** 3–5s teaser for grid hover — longer makes a still look stretched. */
const DEFAULT_CLIP_TRANS =
  "c_pad,w_1080,h_1080,b_rgb:FFF8F0/e_shadow:45/e_zoompan:du_4;fps_30;mode_ofl;maxzoom_1.4/w_720,q_auto:eco,vc_h264";

function env(name) {
  return String(process.env[name] || "").trim();
}

function isCloudinaryConfigured() {
  return Boolean(env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY") && env("CLOUDINARY_API_SECRET"));
}

function isHuggingFaceConfigured() {
  return Boolean(env("HUGGINGFACE_API_KEY") || env("HF_TOKEN") || env("HUGGINGFACE_RMBG_URL"));
}

function isPhotoroomConfigured() {
  return Boolean(env("PHOTOROOM_API_KEY"));
}

function isRemoteConfigured() {
  return Boolean(env("STUDIO_REMOTE_URL"));
}

const PROVIDER_READY = {
  cloudinary: isCloudinaryConfigured,
  huggingface: isHuggingFaceConfigured,
  photoroom: isPhotoroomConfigured,
  remote: isRemoteConfigured,
};

/** @returns {string[]} configured provider ids */
export function listConfiguredProviders() {
  return ALL_PROVIDERS.filter((id) => PROVIDER_READY[id]());
}

/** @returns {boolean} */
export function isStudioConfigured() {
  const pinned = env("STUDIO_PROVIDER").toLowerCase();
  if (pinned === "off" || pinned === "none") return false;
  if (pinned && ALL_PROVIDERS.includes(pinned)) return PROVIDER_READY[pinned]();
  return listConfiguredProviders().length > 0;
}

/**
 * Resolve try-order for this request.
 * @returns {string[]}
 */
export function resolveProviderOrder() {
  const pinned = env("STUDIO_PROVIDER").toLowerCase() || "auto";
  if (pinned === "off" || pinned === "none") return [];

  const fallback = env("STUDIO_FALLBACK").toLowerCase();
  const configured = listConfiguredProviders();

  if (pinned !== "auto" && ALL_PROVIDERS.includes(pinned)) {
    const order = [pinned];
    if (fallback && fallback !== pinned && ALL_PROVIDERS.includes(fallback) && PROVIDER_READY[fallback]()) {
      order.push(fallback);
    } else {
      for (const id of configured) {
        if (id !== pinned) order.push(id);
      }
    }
    return order.filter((id) => PROVIDER_READY[id]());
  }

  // auto — free-first defaults
  return configured;
}

/** Short Ken Burns clips — Cloudinary zoompan on the cleaned cutout. */
export function isStudioClipEnabled() {
  if (env("STUDIO_CLIP_ENABLED") === "false") return false;
  return isCloudinaryConfigured();
}

export function getStudioMeta() {
  const providers = listConfiguredProviders();
  const order = resolveProviderOrder();
  return {
    studioEnabled: isStudioConfigured(),
    studioProvider: order[0] || "none",
    studioProviders: providers,
    studioProviderOrder: order,
    studioClipEnabled: isStudioClipEnabled(),
  };
}

function okResult(buffer, provider, extras = {}) {
  const hasClip = Boolean(extras.clipBuffer?.length || extras.clipUrl);
  return {
    buffer: buffer || null,
    mimeType: "image/png",
    studioApplied: true,
    provider,
    /** CDN URL of the cleaned cutout — preferred over embedding base64 (1GB VM). */
    cleanUrl: extras.cleanUrl || null,
    clipBuffer: extras.clipBuffer || null,
    clipUrl: extras.clipUrl || null,
    clipMimeType: hasClip ? extras.clipMimeType || "video/mp4" : null,
  };
}

function failResult(buffer, mimeType, reason, provider = null) {
  return {
    buffer,
    mimeType,
    studioApplied: false,
    reason,
    provider,
    cleanUrl: null,
    clipBuffer: null,
    clipUrl: null,
    clipMimeType: null,
  };
}

/** Cloudinary signed upload signature (sha1). */
function cloudinarySign(params, apiSecret) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/** Sleep helper for Cloudinary 423 (derived still generating). */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Motion/pad/shadow segment only (no bg removal).
 * Strips legacy e_background_removal from CLOUDINARY_CLIP_TRANS.
 */
export function resolveClipTransform() {
  let t =
    env("CLOUDINARY_CLIP_TRANS") ||
    DEFAULT_CLIP_TRANS;
  t = t
    .replace(/(^|\/)e_background_removal(\/|$)/gi, "$1")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "");
  if (!t) t = DEFAULT_CLIP_TRANS;
  return t;
}

/**
 * Full Cloudinary clip chain from an *original* upload:
 * background removal first, then pad/shadow/zoompan — never zoompan the raw photo.
 */
export function resolveClipTransformFromOriginal() {
  const bgEffect = env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
  const motion = resolveClipTransform();
  return `${bgEffect}/${motion}`;
}

function isPngBuffer(buf) {
  return Boolean(
    buf &&
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
  );
}

/** FormData-safe binary part (Node Buffer → Blob). */
function binaryBlob(buffer, mimeType, filename) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

/**
 * Fetch a Cloudinary derived URL. Retries 420/423 while BG removal / zoompan builds.
 * @param {string} url
 * @param {{ timeoutMs?: number, attempts?: number, label?: string }} [opts]
 */
async function fetchCloudinaryDerived(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 90_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    8;
  const label = opts.label || "derived";
  let lastStatus = 0;
  let lastText = "";

  for (let i = 0; i < attempts; i += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    lastStatus = res.status;
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length) return buf;
      lastText = "empty body";
    } else {
      lastText = await res.text().catch(() => "");
      // 423 = still generating derived; 420 = pending incoming transform.
      if (res.status !== 420 && res.status !== 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} failed:`,
          res.status,
          lastText.slice(0, 200)
        );
        return null;
      }
      console.warn(
        `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
      );
    }
    await sleep(1500 + i * 500);
  }

  console.warn(
    `[listing-studio] Cloudinary ${label} gave up:`,
    lastStatus,
    lastText.slice(0, 200)
  );
  return null;
}

/**
 * Wait until a derived URL is ready without keeping the body in RAM (1GB VM safe).
 */
async function waitCloudinaryDerivedReady(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    8;
  const label = opts.label || "derived";

  for (let i = 0; i < attempts; i += 1) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
      });
      if (head.ok) return true;
      if (head.status !== 420 && head.status !== 423 && head.status !== 405) {
        // Fall through to GET for CDNs that dislike HEAD
      } else if (head.status === 420 || head.status === 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} pending (${head.status}) — retry ${i + 1}/${attempts}`
        );
        await sleep(1500 + i * 500);
        continue;
      }
    } catch {
      // HEAD unsupported / network — try GET
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
      return true;
    }
    if (res.status !== 420 && res.status !== 423) {
      const lastText = await res.text().catch(() => "");
      console.warn(
        `[listing-studio] Cloudinary ${label} failed:`,
        res.status,
        lastText.slice(0, 200)
      );
      return false;
    }
    console.warn(
      `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
    );
    await sleep(1500 + i * 500);
  }
  return false;
}

function scheduleCloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  if (env("CLOUDINARY_DELETE_AFTER") === "false") return;
  const ms = Number(env("CLOUDINARY_DELETE_MS")) || 180_000;
  setTimeout(() => {
    void cloudinaryDestroy(publicId, cloud, apiKey, apiSecret).catch((err) =>
      console.warn("[listing-studio] Cloudinary destroy:", err.message)
    );
  }, ms);
}

/**
 * Signed image upload with optional eager transforms.
 * `file` may be a Buffer or a remote HTTPS URL (Cloudinary fetches it — no bot RAM).
 * @returns {Promise<{ ok: true, publicId: string, uploaded: object, cloud: string, apiKey: string, apiSecret: string } | { ok: false, authFailed?: boolean, status: number, errText: string }>}
 */
async function cloudinaryUploadImage(file, mimeType, { publicId, folder, eager, filename }) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const signParams = { folder, public_id: publicId, timestamp };
  if (eager) signParams.eager = eager;
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  if (typeof file === "string" && /^https?:\/\//i.test(file)) {
    form.append("file", file);
  } else {
    form.append(
      "file",
      binaryBlob(file, mimeType || "image/jpeg", filename || "listing.jpg"),
      filename || "listing.jpg"
    );
  }
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("folder", folder);
  form.append("public_id", publicId);
  if (eager) form.append("eager", eager);

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary upload failed:", uploadRes.status, errText.slice(0, 200));
    const authFailed =
      uploadRes.status === 401 ||
      /api_secret mismatch|invalid signature|unauthorized/i.test(errText);
    return { ok: false, authFailed, status: uploadRes.status, errText };
  }

  const uploaded = await uploadRes.json().catch(() => ({}));
  return {
    ok: true,
    publicId: uploaded.public_id || `${folder}/${publicId}`,
    uploaded,
    cloud,
    apiKey,
    apiSecret,
  };
}

/**
 * Store a cleaned cutout on Cloudinary and build the motion clip FROM that asset
 * (never from the original phone photo). Source may be a cleaned HTTPS URL or PNG buffer.
 * @param {string|Buffer} cleanSource
 * @returns {Promise<{ cleanUrl: string, clipUrl: string|null, clipBuffer: Buffer|null }|null>}
 */
async function storeCutoutAndRenderClip(cleanSource) {
  if (!isCloudinaryConfigured()) return null;
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const stamp = Math.floor(Date.now() / 1000);
  const publicId = `cutout_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
  const wantClip = env("STUDIO_CLIP_ENABLED") !== "false";
  const clipTrans = resolveClipTransform();
  const eager = wantClip ? `${clipTrans}/f_mp4` : undefined;

  const isUrl = typeof cleanSource === "string";
  if (!isUrl && !isPngBuffer(cleanSource)) {
    console.warn("[listing-studio] refusing cutout store — not a cleaned PNG");
    return null;
  }

  const up = await cloudinaryUploadImage(cleanSource, "image/png", {
    publicId,
    folder,
    eager,
    filename: "clean.png",
  });
  if (!up.ok) return null;

  const id = up.publicId;
  const cleanUrl =
    up.uploaded.secure_url ||
    up.uploaded.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${id}`;

  scheduleCloudinaryDestroy(id, cloud, up.apiKey, up.apiSecret);

  if (!wantClip) return { cleanUrl, clipUrl: null, clipBuffer: null };

  const clipUrl =
    up.uploaded.eager?.[0]?.secure_url ||
    up.uploaded.eager?.[0]?.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${clipTrans}/f_mp4/${id}.mp4`;

  // Clip must target the cutout public id — never the original listing_ asset.
  if (!String(clipUrl).includes(id.split("/").pop()) && !String(clipUrl).includes(id)) {
    console.warn("[listing-studio] clip URL does not reference cutout id — skipping");
    return { cleanUrl, clipUrl: null, clipBuffer: null };
  }

  const clip = await finalizeClipUrl(clipUrl);
  if (!clip) return { cleanUrl, clipUrl: null, clipBuffer: null };
  return { cleanUrl, clipUrl: clip.clipUrl, clipBuffer: clip.clipBuffer };
}

/**
 * Wait for a clip derived URL; optionally download bytes when STUDIO_CLIP_INLINE=true.
 * @returns {Promise<{ clipUrl: string, clipBuffer: Buffer|null }|null>}
 */
async function finalizeClipUrl(clipUrl) {
  if (!clipUrl) return null;
  const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 10;
  const inline = env("STUDIO_CLIP_INLINE") === "true";
  const attempts = Math.max(4, Math.min(derivedAttempts, 8));

  if (inline) {
    const clipBuffer = await fetchCloudinaryDerived(clipUrl, {
      label: "clip",
      timeoutMs: 120_000,
      attempts,
    });
    if (!clipBuffer || clipBuffer.length <= 256) {
      console.warn("[listing-studio] Cloudinary clip too small / missing — skipping");
      return null;
    }
    return { clipUrl, clipBuffer };
  }

  const ready = await waitCloudinaryDerivedReady(clipUrl, {
    label: "clip",
    timeoutMs: 120_000,
    attempts,
  });
  if (!ready) {
    console.warn("[listing-studio] Cloudinary clip not ready — skipping");
    return null;
  }
  return { clipUrl, clipBuffer: null };
}

/**
 * After image-only cleanup (Photoroom/HF/remote), store cutout on Cloudinary and clip it.
 */
async function maybeAttachProductClip(result) {
  if (!result?.studioApplied) return result;
  if (result.clipUrl || result.cleanUrl) return result;
  if (!isCloudinaryConfigured()) return result;
  try {
    const source = result.cleanUrl || result.buffer;
    if (!source) return result;
    const stored = await storeCutoutAndRenderClip(source);
    if (!stored?.cleanUrl) return result;
    return okResult(result.buffer, result.provider, {
      cleanUrl: stored.cleanUrl,
      clipUrl: stored.clipUrl || null,
      clipBuffer: stored.clipBuffer || null,
      clipMimeType: "video/mp4",
    });
  } catch (err) {
    console.warn("[listing-studio] clip from clean failed:", err.message);
    return result;
  }
}

/**
 * Upload original → wait for cleaned derived → re-upload THAT cutout → motion clip.
 * Clip is never zoompan on the raw phone photo. Bot keeps no PNG/MP4 bytes by default.
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
async function removeBackgroundCloudinary(buffer, mimeType) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = `listing_${timestamp}_${crypto.randomBytes(4).toString("hex")}`;
  const bgEffect = env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
  const eagerClean = `${bgEffect}/f_png`;

  const up = await cloudinaryUploadImage(buffer, mimeType, {
    publicId,
    folder,
    eager: eagerClean,
    filename: "listing.jpg",
  });
  if (!up.ok) {
    if (up.authFailed) return failResult(buffer, mimeType, "auth_failed", "cloudinary");
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  const id = up.publicId;
  const cleanDerivedUrl =
    up.uploaded.eager?.[0]?.secure_url ||
    up.uploaded.eager?.[0]?.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${eagerClean}/${id}`;

  try {
    const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 10;
    // HEAD only — do not pull the full cleaned PNG into the 1GB bot.
    const cleanReady = await waitCloudinaryDerivedReady(cleanDerivedUrl, {
      label: "bg-removal",
      timeoutMs: 90_000,
      attempts: derivedAttempts,
    });
    if (!cleanReady) return failResult(buffer, mimeType, "api_failed", "cloudinary");

    // Cloudinary fetches the cleaned derived URL and stores a new cutout asset,
    // then builds the MP4 from that cutout (pad/shadow/zoompan).
    const stored = await storeCutoutAndRenderClip(cleanDerivedUrl);
    if (!stored?.cleanUrl) {
      // Cleanup worked; clip/store failed — still expose the cleaned derived URL.
      return okResult(null, "cloudinary", { cleanUrl: cleanDerivedUrl });
    }

    return okResult(null, "cloudinary", {
      cleanUrl: stored.cleanUrl,
      clipUrl: stored.clipUrl || null,
      clipBuffer: stored.clipBuffer || null,
      clipMimeType: "video/mp4",
    });
  } finally {
    scheduleCloudinaryDestroy(id, cloud, up.apiKey, up.apiSecret);
  }
}

async function cloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinarySign({ public_id: publicId, timestamp }, apiSecret);
  const form = new FormData();
  form.append("public_id", publicId);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/destroy`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
}

/**
 * Hugging Face Inference / router — or a full custom RMBG URL (Space / dedicated endpoint).
 * Note: many Hub models (incl. briaai/RMBG-1.4) are not on free serverless anymore;
 * set HUGGINGFACE_RMBG_URL to a working Inference Endpoint or Space proxy if needed.
 */
async function removeBackgroundHuggingFace(buffer, mimeType) {
  const token = env("HUGGINGFACE_API_KEY") || env("HF_TOKEN");
  const customUrl = env("HUGGINGFACE_RMBG_URL");
  const model = env("HUGGINGFACE_RMBG_MODEL") || "briaai/RMBG-1.4";
  const url = customUrl || `https://router.huggingface.co/hf-inference/models/${model}`;

  const headers = {
    Accept: "image/png",
    "Content-Type": mimeType || "image/jpeg",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: buffer,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Hugging Face RMBG failed:", res.status, errText.slice(0, 240));
    // Cold-start / loading
    if (res.status === 503 && /loading/i.test(errText)) {
      return failResult(buffer, mimeType, "api_error", "huggingface");
    }
    return failResult(buffer, mimeType, "api_failed", "huggingface");
  }

  const contentType = String(res.headers.get("content-type") || "");
  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "huggingface");
  // Some endpoints return JSON errors with 200 — reject obvious non-images.
  if (contentType.includes("application/json") || (clean[0] === 0x7b && clean[1] === 0x22)) {
    console.warn("[listing-studio] Hugging Face returned JSON, not PNG:", clean.toString("utf8").slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "huggingface");
  }
  return okResult(clean, "huggingface");
}

async function removeBackgroundPhotoroom(buffer, mimeType) {
  const apiKey = env("PHOTOROOM_API_KEY");
  const form = new FormData();
  form.append("image_file", new Blob([buffer], { type: mimeType }), "listing.jpg");

  const res = await fetch(PHOTOROOM_SEGMENT, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Photoroom failed:", res.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "photoroom");
  }

  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "photoroom");
  return okResult(clean, "photoroom");
}

/** Generic remote microservice: POST raw bytes → PNG (Modal/Render rembg, etc.). */
async function removeBackgroundRemote(buffer, mimeType) {
  const url = env("STUDIO_REMOTE_URL");
  const headers = {
    Accept: "image/png",
    "Content-Type": mimeType || "image/jpeg",
  };
  const remoteKey = env("STUDIO_REMOTE_KEY");
  if (remoteKey) headers.Authorization = `Bearer ${remoteKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: buffer,
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] remote studio failed:", res.status, errText.slice(0, 200));
    return failResult(buffer, mimeType, "api_failed", "remote");
  }

  const clean = Buffer.from(await res.arrayBuffer());
  if (!clean.length) return failResult(buffer, mimeType, "empty_result", "remote");
  return okResult(clean, "remote");
}

const PROVIDER_FN = {
  cloudinary: removeBackgroundCloudinary,
  huggingface: removeBackgroundHuggingFace,
  photoroom: removeBackgroundPhotoroom,
  remote: removeBackgroundRemote,
};

/**
 * Background removal only (no AI draft). Tries provider chain; keeps original on failure.
 * When clips are enabled, builds the MP4 from the cleaned cutout via Cloudinary.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @returns {Promise<{ buffer: Buffer, mimeType: string, studioApplied: boolean, reason?: string, provider?: string|null }>}
 */
export async function removeBackground(buffer, mimeType = "image/jpeg") {
  const order = resolveProviderOrder();
  if (!order.length) {
    return failResult(buffer, mimeType, "not_configured");
  }
  if (!buffer?.length) {
    return failResult(buffer, mimeType, "missing_image");
  }

  let lastReason = "api_failed";
  for (const provider of order) {
    const fn = PROVIDER_FN[provider];
    if (!fn) continue;
    try {
      const result = await fn(buffer, mimeType);
      if (result.studioApplied) {
        return maybeAttachProductClip(result);
      }
      lastReason = result.reason || lastReason;
      console.warn(`[listing-studio] ${provider} skipped (${result.reason}) — trying next`);
    } catch (err) {
      lastReason = "api_error";
      console.warn(`[listing-studio] ${provider} error:`, err.message);
    }
  }

  return failResult(buffer, mimeType, lastReason);
}

function formatClipPayload(cleaned) {
  const clipUrl = cleaned.clipUrl || null;
  const hasBuffer = Boolean(cleaned.clipBuffer?.length);
  const clipApplied = Boolean(clipUrl || hasBuffer);
  const inline = env("STUDIO_CLIP_INLINE") === "true";
  let clipVideoBase64 = null;
  if (inline && hasBuffer) {
    clipVideoBase64 = `data:${cleaned.clipMimeType || "video/mp4"};base64,${cleaned.clipBuffer.toString("base64")}`;
  }
  return { clipApplied, clipVideoUrl: clipUrl, clipVideoBase64 };
}

function formatCleanImagePayload(cleaned) {
  const cleanImageUrl = cleaned.cleanUrl || null;
  const inline = env("STUDIO_INLINE_IMAGES") === "true";
  let cleanImageBase64 = null;
  if (inline && cleaned.buffer?.length) {
    cleanImageBase64 = `data:image/png;base64,${cleaned.buffer.toString("base64")}`;
  }
  return { cleanImageUrl, cleanImageBase64 };
}

/** Small JPEG of the cleaned cover for vision models — keeps RAM low. */
async function fetchCleanForVision(cleaned) {
  if (cleaned.buffer?.length) return { buffer: cleaned.buffer, mimeType: cleaned.mimeType || "image/png" };
  const url = cleaned.cleanUrl;
  if (!url) return null;
  // Prefer a downscaled JPEG delivery when the URL is Cloudinary.
  let fetchUrl = url;
  if (/res\.cloudinary\.com/i.test(url) && !/\/c_limit,/i.test(url)) {
    fetchUrl = url.replace("/upload/", "/upload/c_limit,w_1024,q_auto,f_jpg/");
  }
  const buf = await fetchCloudinaryDerived(fetchUrl, {
    label: "vision-clean",
    timeoutMs: 60_000,
    attempts: 4,
  });
  if (!buf?.length) return null;
  return { buffer: buf, mimeType: "image/jpeg" };
}

/**
 * Format studio preview response for seller API (no draft generation).
 * Default: CDN URLs only — never embed multi‑MB PNG/MP4 base64 (crashes 1GB VMs).
 * @param {Buffer} buffer
 * @param {string} mimeType
 */
export async function previewStudioClean(buffer, mimeType = "image/jpeg") {
  const cleaned = await removeBackground(buffer, mimeType);
  if (!cleaned.studioApplied) {
    const messages = {
      not_configured: "Background cleanup is not configured on this bot.",
      missing_image: "Add a cover photo first.",
      auth_failed:
        "Cloudinary API secret doesn’t match — open Cloudinary → Settings → API Keys, copy the API secret again into whatsapp-bot/.env, then redeploy.",
      api_failed: "Background cleanup failed — keep your original photo.",
      empty_result: "Background cleanup returned an empty image — keep your original.",
      api_error: "Background cleanup unavailable right now — keep your original photo.",
    };
    return {
      studioApplied: false,
      cleanImageBase64: null,
      cleanImageUrl: null,
      clipVideoBase64: null,
      clipVideoUrl: null,
      clipApplied: false,
      reason: cleaned.reason || "api_failed",
      provider: cleaned.provider || null,
      message: messages[cleaned.reason] || messages.api_failed,
    };
  }

  const { clipApplied, clipVideoUrl, clipVideoBase64 } = formatClipPayload(cleaned);
  const { cleanImageUrl, cleanImageBase64 } = formatCleanImagePayload(cleaned);

  // Fallback: if we only have a buffer (e.g. Photoroom without Cloudinary store), inline once.
  let cleanB64 = cleanImageBase64;
  let cleanUrl = cleanImageUrl;
  if (!cleanUrl && !cleanB64 && cleaned.buffer?.length) {
    cleanB64 = `data:image/png;base64,${cleaned.buffer.toString("base64")}`;
  }

  let message = "Background cleaned — toggle below to switch back to the original.";
  if (clipApplied) {
    message = "Background cleaned + product clip from your cutout — use the toggles below.";
  } else if (isStudioClipEnabled()) {
    message = "Background cleaned — product clip unavailable this time; cover is ready.";
  }

  return {
    studioApplied: true,
    cleanImageBase64: cleanB64,
    cleanImageUrl: cleanUrl,
    clipVideoBase64,
    clipVideoUrl,
    clipApplied,
    reason: null,
    provider: cleaned.provider || null,
    message,
  };
}

/**
 * Studio clean-up + listing draft.
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} [caption]
 * @param {{ skipStudio?: boolean }} [opts]
 */
export async function processListingWithStudio(buffer, mimeType, caption = "", opts = {}) {
  let workBuffer = buffer;
  let workMime = mimeType;
  let studioApplied = false;
  let studioProvider = null;
  let clipVideoBase64 = null;
  let clipVideoUrl = null;
  let clipApplied = false;
  let cleanImageUrl = null;
  let cleanImageBase64 = null;

  if (!opts.skipStudio) {
    const cleaned = await removeBackground(buffer, mimeType);
    studioApplied = cleaned.studioApplied;
    studioProvider = cleaned.provider || null;
    const clip = formatClipPayload(cleaned);
    clipApplied = clip.clipApplied;
    clipVideoBase64 = clip.clipVideoBase64;
    clipVideoUrl = clip.clipVideoUrl;
    const clean = formatCleanImagePayload(cleaned);
    cleanImageUrl = clean.cleanImageUrl;
    cleanImageBase64 = clean.cleanImageBase64;

    if (cleaned.studioApplied) {
      const forVision = await fetchCleanForVision(cleaned);
      if (forVision?.buffer?.length) {
        workBuffer = forVision.buffer;
        workMime = forVision.mimeType;
      } else if (cleaned.buffer?.length) {
        workBuffer = cleaned.buffer;
        workMime = cleaned.mimeType;
      }
    }
  }

  const draft = await generateListingFromImage(workBuffer, workMime, caption);

  return {
    draft,
    studioApplied,
    studioProvider,
    cleanImageBase64,
    cleanImageUrl,
    clipApplied,
    clipVideoBase64,
    clipVideoUrl,
  };
}
