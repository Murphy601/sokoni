/**
 * AI Photo Studio — cloud background removal (+ optional product reel).
 * Providers (zero disk/RAM on the bot VM):
 *   - cloudinary  — clean PNG via e_background_removal
 *   - huggingface — image cleanup only (RMBG / Inference)
 *   - photoroom   — image cleanup only (Segment API)
 *   - remote      — POST→PNG microservice (Modal/Render rembg)
 *
 * Transform once, cache forever (Cloudinary path):
 *   1. Upload cutout_* with eager e_background_removal/f_png + eager_async=false
 *   2. Wait until cleaned PNG has alpha, then DOWNLOAD those PNG bytes
 *   3. Flatten transparent cutout onto cream (FFF8F0) — MP4 has no alpha channel
 *   4. Store opaque cream JPEG as cutout_ or reel_ asset (tagged for multi)
 *   5. Zoompan / multi on that cream asset (never e_background_removal in video chains)
 *   6. Save those CDN URLs in the catalog
 *
 * Why bake + flatten? (a) URL→upload fetch often re-pulls the original photo.
 * (b) Cloudinary ignores e_background_removal inside MP4 chains.
 * (c) MP4 cannot keep PNG transparency — without cream flatten, RGB under alpha
 *     shows the original background in the reel.
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
import {
  isClipFallbackConfigured,
  listConfiguredClipFallbacks,
  tryClipFallbacks,
} from "./clip-fallbacks.js";

const PHOTOROOM_SEGMENT = "https://sdk.photoroom.com/v1/segment";

const ALL_PROVIDERS = ["cloudinary", "huggingface", "photoroom", "remote"];

/** Cream pad under cutouts — MP4 has no alpha, so frames must be flattened onto this. */
const CREAM_BG = "FFF8F0";

/** Photoroom-like clip from a cutout flattened onto cream — no background_removal here. */
/** 3–5s teaser for grid hover — longer makes a still look stretched. */
const DEFAULT_CLIP_TRANS =
  `c_pad,w_1080,h_1080,b_rgb:${CREAM_BG}/e_shadow:45/e_zoompan:du_4;fps_30;mode_ofl;maxzoom_1.4/w_720,q_auto:eco,vc_h264`;

function env(name) {
  return String(process.env[name] || "").trim();
}

export function isCloudinaryConfigured() {
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
  const clipFallbacks = listConfiguredClipFallbacks();
  return {
    studioEnabled: isStudioConfigured(),
    studioProvider: order[0] || "none",
    studioProviders: providers,
    studioProviderOrder: order,
    studioClipEnabled: isStudioClipEnabled(),
    /** Soft clip engines tried only after Cloudinary zoompan/multi fails. */
    studioClipFallbacks: clipFallbacks,
    studioClipFallbackConfigured: isClipFallbackConfigured(),
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
    /** Durable Cloudinary public_id for the cutout (for multi-reel tagging). */
    cleanPublicId: extras.cleanPublicId || null,
    /** True when cleanUrl points at a base asset that is already a transparent PNG. */
    baked: extras.baked === true,
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
    cleanPublicId: null,
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

/** True when PNG IHDR color type includes alpha (4=gray+A, 6=RGBA) or tRNS chunk. */
export function pngHasAlpha(buf) {
  if (!isPngBuffer(buf) || buf.length < 26) return false;
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) return true;
  const head = buf.subarray(0, Math.min(buf.length, 512));
  for (let i = 8; i < head.length - 4; i += 1) {
    if (
      head[i] === 0x74 &&
      head[i + 1] === 0x52 &&
      head[i + 2] === 0x4e &&
      head[i + 3] === 0x53
    ) {
      return true; // tRNS
    }
  }
  return false;
}

function bgRemovalEffect() {
  return env("CLOUDINARY_BG_EFFECT") || "e_background_removal";
}

/** Warmed clean-PNG delivery URL for a stored public_id (AI runs once, then CDN-cached). */
function cleanedPngUrl(cloud, publicId) {
  return `https://res.cloudinary.com/${cloud}/image/upload/${bgRemovalEffect()}/f_png/${publicId}`;
}

/** Clip URL for a cream-flattened cutout (no bg-removal in the video chain). */
function bakedClipUrl(cloud, publicId) {
  const motion = resolveClipTransform();
  return `https://res.cloudinary.com/${cloud}/image/upload/${motion}/f_mp4/${publicId}.mp4`;
}

/** Delivery URL: transparent cutout composited onto Sokoni cream (opaque — safe for MP4/multi). */
function creamFlattenUrl(cloud, publicId) {
  return `https://res.cloudinary.com/${cloud}/image/upload/b_rgb:${CREAM_BG}/f_jpg/q_auto/${publicId}`;
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

/**
 * Schedule destroy for *temporary* uploads only (raw listing_* before cutout is stored).
 * Durable cutout_* / reel_* assets are never auto-deleted — their CDN URLs live in the catalog.
 */
function scheduleCloudinaryDestroy(publicId, cloud, apiKey, apiSecret) {
  if (env("CLOUDINARY_DELETE_AFTER") === "false") return;
  const id = String(publicId || "");
  // Never wipe product assets that buyers hit via saved CDN URLs.
  if (/\/(cutout_|reel_)/i.test(`/${id}`) || /^(cutout_|reel_)/i.test(id.split("/").pop() || "")) {
    return;
  }
  const ms = Number(env("CLOUDINARY_DELETE_MS")) || 180_000;
  setTimeout(() => {
    void cloudinaryDestroy(publicId, cloud, apiKey, apiSecret).catch((err) =>
      console.warn("[listing-studio] Cloudinary destroy:", err.message)
    );
  }, ms);
}

/**
 * Wait until AI background removal produced a real transparent PNG.
 * HEAD 200 is not enough — Cloudinary can serve the original while AI is pending.
 * Reads only the first bytes (Range) so the 1GB bot never holds the full image.
 */
async function waitCloudinaryCleanPng(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || 120_000;
  const attempts =
    opts.attempts ||
    Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) ||
    12;
  const label = opts.label || "bg-removal-alpha";
  let pngOkHits = 0;

  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-512" },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 45_000)),
      });
      if (res.status === 420 || res.status === 423) {
        console.warn(
          `[listing-studio] Cloudinary ${label} pending (${res.status}) — retry ${i + 1}/${attempts}`
        );
        await sleep(2000 + i * 750);
        continue;
      }
      if (!res.ok && res.status !== 206) {
        console.warn(`[listing-studio] Cloudinary ${label} failed:`, res.status);
        await sleep(1500 + i * 500);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
      if (pngHasAlpha(buf)) return true;
      // Range responses sometimes omit tRNS; two successful PNGs from the
      // bg-removal URL after 423 clears is enough to proceed to full download.
      if (isPngBuffer(buf)) {
        pngOkHits += 1;
        if (pngOkHits >= 2) {
          console.warn(
            `[listing-studio] Cloudinary ${label} PNG ready (alpha not in header — baking anyway)`
          );
          return true;
        }
      }
      console.warn(
        `[listing-studio] Cloudinary ${label} PNG has no alpha yet — retry ${i + 1}/${attempts}`
      );
    } catch (err) {
      console.warn(`[listing-studio] Cloudinary ${label} error:`, err.message);
    }
    await sleep(2000 + i * 750);
  }
  return false;
}

/**
 * Signed image upload with optional eager transforms.
 * When `eager` is set, always sends eager_async=false so AI bg-removal finishes
 * before the upload response completes (avoids zoompan racing the raw original).
 * `file` may be a Buffer or a remote HTTPS URL (Cloudinary fetches it — no bot RAM).
 * @returns {Promise<{ ok: true, publicId: string, uploaded: object, cloud: string, apiKey: string, apiSecret: string } | { ok: false, authFailed?: boolean, status: number, errText: string }>}
 */
async function cloudinaryUploadImage(
  file,
  mimeType,
  { publicId, folder, eager, filename, tags, overwrite, invalidate }
) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const timestamp = Math.floor(Date.now() / 1000);
  const signParams = { folder, public_id: publicId, timestamp };
  if (eager) {
    signParams.eager = eager;
    // Explicit sync eager — default is false, but sign+send so AI clean completes first.
    signParams.eager_async = "false";
  }
  if (tags) signParams.tags = tags;
  if (overwrite) signParams.overwrite = "true";
  if (invalidate) signParams.invalidate = "true";
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
  if (eager) {
    form.append("eager", eager);
    form.append("eager_async", "false");
  }
  if (tags) form.append("tags", tags);
  if (overwrite) form.append("overwrite", "true");
  if (invalidate) form.append("invalidate", "true");

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
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

/** Extract Cloudinary public_id from a delivery URL (strips transforms + version). */
export function cloudinaryPublicIdFromUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const m = raw.match(/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/(.+)$/i);
  if (!m) return null;
  const parts = m[1].replace(/^\/+/, "").split("/");
  // Drop transformation segments and version (v123…) until the public_id path remains.
  while (parts.length > 1) {
    const head = parts[0];
    if (
      /^v\d+$/i.test(head) ||
      /[,=]/.test(head) ||
      /^(c_|w_|h_|e_|b_|g_|q_|f_|fl_|dpr_|ar_|a_|r_|l_|u_|t_|dl_)/i.test(head)
    ) {
      parts.shift();
      continue;
    }
    break;
  }
  // Leading version with no transforms: v123/folder/id
  if (parts.length && /^v\d+$/i.test(parts[0])) parts.shift();
  const id = parts.join("/").replace(/\.[a-z0-9]+$/i, "");
  return id || null;
}

function isCloudinaryDeliveryUrl(url) {
  try {
    const u = new URL(String(url));
    return u.hostname === "res.cloudinary.com" || u.hostname.endsWith(".cloudinary.com");
  } catch {
    return false;
  }
}

/**
 * Store an already-cleaned PNG *buffer* (Photoroom/HF/remote) on Cloudinary and
 * optionally zoompan it. Do not pass Cloudinary transformed URLs here — fetch
 * often re-pulls the original photo.
 * @param {Buffer} cleanPng
 * @param {{ wantClip?: boolean, publicId?: string, tags?: string }} [opts]
 */
async function storeCleanPngBufferAndClip(cleanPng, opts = {}) {
  if (!isCloudinaryConfigured()) return null;
  if (!isPngBuffer(cleanPng)) {
    console.warn("[listing-studio] refusing cutout store — not a cleaned PNG");
    return null;
  }
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const stamp = Math.floor(Date.now() / 1000);
  const hex = crypto.randomBytes(4).toString("hex");
  const publicId =
    opts.publicId || `cutout_${stamp}_${hex}`;
  const wantClip =
    opts.wantClip !== undefined ? opts.wantClip : env("STUDIO_CLIP_ENABLED") !== "false";
  const clipTrans = resolveClipTransform();

  // Stage alpha PNG, flatten onto cream, store opaque JPEG (MP4-safe).
  const stageId = `alpha_${stamp}_${hex}`;
  const staged = await cloudinaryUploadImage(cleanPng, "image/png", {
    publicId: stageId,
    folder,
    overwrite: true,
    filename: "clean.png",
  });
  if (!staged.ok) return null;

  let flatBuf = await fetchCloudinaryDerived(creamFlattenUrl(cloud, staged.publicId), {
    label: "cream-flatten-store",
    timeoutMs: 90_000,
    attempts: 6,
  });
  void cloudinaryDestroy(staged.publicId, cloud, staged.apiKey, staged.apiSecret).catch(() => {});
  if (!flatBuf?.length) return null;

  const eager = wantClip ? `${clipTrans}/f_mp4` : undefined;
  const up = await cloudinaryUploadImage(flatBuf, "image/jpeg", {
    publicId,
    folder,
    overwrite: Boolean(opts.publicId),
    invalidate: Boolean(opts.publicId),
    eager,
    filename: "clean.jpg",
    tags: opts.tags,
  });
  flatBuf = null;
  if (!up.ok) return null;

  const id = up.publicId;
  const cleanUrl =
    up.uploaded.secure_url ||
    up.uploaded.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${id}`;

  if (!wantClip) {
    return { cleanUrl, cleanPublicId: id, clipUrl: null, clipBuffer: null, baked: true };
  }

  const clipUrl =
    up.uploaded.eager?.[0]?.secure_url ||
    up.uploaded.eager?.[0]?.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${clipTrans}/f_mp4/${id}.mp4`;

  const clip = await finalizeClipUrl(clipUrl);
  if (!clip) return { cleanUrl, cleanPublicId: id, clipUrl: null, clipBuffer: null, baked: true };
  return {
    cleanUrl,
    cleanPublicId: id,
    baked: true,
    clipUrl: clip.clipUrl,
    clipBuffer: clip.clipBuffer,
  };
}

/** @deprecated alias — buffer-only */
async function storeCutoutAndRenderClip(cleanSource, opts = {}) {
  if (typeof cleanSource === "string") {
    console.warn(
      "[listing-studio] refusing URL cutout re-upload (Cloudinary fetch returns originals) — use removeBackgroundCloudinary"
    );
    return null;
  }
  return storeCleanPngBufferAndClip(cleanSource, opts);
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
    // Only real PNG bytes from Photoroom/HF/remote — never a Cloudinary transform URL.
    if (!result.buffer || !isPngBuffer(result.buffer)) return result;
    const stored = await storeCleanPngBufferAndClip(result.buffer);
    if (!stored?.cleanUrl) return result;
    return okResult(result.buffer, result.provider, {
      cleanUrl: stored.cleanUrl,
      cleanPublicId: stored.cleanPublicId || null,
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
 * Upload original to a TEMP id → AI clean → download PNG bytes with alpha →
 * upload ONLY those bytes to the final cutout/reel id (never store the original there).
 * Video / multi cannot apply e_background_removal, so the final base asset must be the cutout.
 *
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {{ wantClip?: boolean, cutoutPublicId?: string, tags?: string }} [opts]
 */
async function removeBackgroundCloudinary(buffer, mimeType, opts = {}) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const folder = env("CLOUDINARY_FOLDER") || "sokoni-studio";
  const stamp = Math.floor(Date.now() / 1000);
  const hex = crypto.randomBytes(4).toString("hex");
  // Final asset is clean-only. Original lands on a short-lived tmp_* id (never tagged for multi).
  const finalId =
    opts.cutoutPublicId || `cutout_${stamp}_${hex}`;
  const tempId = `tmp_${stamp}_${hex}`;
  const eagerClean = `${bgRemovalEffect()}/f_png`;

  const up = await cloudinaryUploadImage(buffer, mimeType, {
    publicId: tempId,
    folder,
    eager: eagerClean,
    filename: "listing.jpg",
    // Do NOT put reel tags on the dirty original — multi-by-tag would merge originals.
  });
  if (!up.ok) {
    if (up.authFailed) return failResult(buffer, mimeType, "auth_failed", "cloudinary");
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  const tempPublicId = up.publicId;
  const eagerUrl = up.uploaded.eager?.[0]?.secure_url || up.uploaded.eager?.[0]?.url || "";
  // Only trust eager URL if it is the bg-removal PNG (not a later zoompan eager).
  const derivedUrl =
    /e_background_removal/i.test(eagerUrl) && /(f_png|\.png)/i.test(eagerUrl)
      ? eagerUrl
      : cleanedPngUrl(cloud, tempPublicId);

  const derivedAttempts = Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 14;
  const cleanReady = await waitCloudinaryCleanPng(derivedUrl, {
    label: "bg-removal",
    timeoutMs: 150_000,
    attempts: derivedAttempts,
  });
  if (!cleanReady) {
    console.warn("[listing-studio] Cloudinary bg-removal never produced alpha PNG");
    void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  // Pull the verified clean PNG — require real alpha before baking into the final asset.
  let cleanBuf = await fetchCloudinaryDerived(derivedUrl, {
    label: "bg-removal-download",
    timeoutMs: 120_000,
    attempts: Math.min(6, derivedAttempts),
  });
  if (!cleanBuf?.length || !isPngBuffer(cleanBuf)) {
    console.warn("[listing-studio] clean PNG download failed or not a PNG");
    void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }
  if (!pngHasAlpha(cleanBuf)) {
    // Do not bake an opaque PNG into reel_* — multi would show the original photo.
    console.warn(
      "[listing-studio] clean PNG has no alpha — refusing bake; using derived URL for image only"
    );
    void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
    return okResult(null, "cloudinary", {
      cleanUrl: derivedUrl,
      cleanPublicId: tempPublicId,
      baked: false,
    });
  }
  if (cleanBuf.length > 12 * 1024 * 1024) {
    console.warn("[listing-studio] clean PNG too large to bake on 1GB VM:", cleanBuf.length);
    void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
    return failResult(buffer, mimeType, "api_failed", "cloudinary");
  }

  // Stage transparent cutout under a staging id so we can flatten cream onto finalId.
  const stageId = `alpha_${stamp}_${hex}`;
  const staged = await cloudinaryUploadImage(cleanBuf, "image/png", {
    publicId: stageId,
    folder,
    overwrite: true,
    filename: "clean.png",
  });
  cleanBuf = null;
  if (!staged.ok) {
    console.warn("[listing-studio] staging transparent PNG failed — using derived URL only");
    void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
    return okResult(null, "cloudinary", {
      cleanUrl: derivedUrl,
      cleanPublicId: tempPublicId,
      baked: false,
    });
  }

  // MP4 has no alpha — flatten cutout onto cream so multi/zoompan cannot show original RGB.
  const flatUrl = creamFlattenUrl(cloud, staged.publicId);
  let flatBuf = await fetchCloudinaryDerived(flatUrl, {
    label: "cream-flatten",
    timeoutMs: 90_000,
    attempts: Math.min(6, derivedAttempts),
  });
  if (!flatBuf?.length) {
    console.warn("[listing-studio] cream flatten download failed — using derived URL only");
    void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
    void cloudinaryDestroy(staged.publicId, cloud, staged.apiKey, staged.apiSecret).catch(() => {});
    return okResult(null, "cloudinary", {
      cleanUrl: derivedUrl,
      cleanPublicId: tempPublicId,
      baked: false,
    });
  }

  const wantClip =
    opts.wantClip !== undefined ? opts.wantClip : env("STUDIO_CLIP_ENABLED") !== "false";
  const clipTrans = resolveClipTransform();
  // Final id = opaque cream-backed cutout (+ reel tags). Safe for stills, multi, and MP4.
  const baked = await cloudinaryUploadImage(flatBuf, "image/jpeg", {
    publicId: finalId,
    folder,
    overwrite: true,
    invalidate: true,
    eager: wantClip ? `${clipTrans}/f_mp4` : undefined,
    filename: "clean.jpg",
    tags: opts.tags,
  });
  flatBuf = null;

  void cloudinaryDestroy(tempPublicId, cloud, up.apiKey, up.apiSecret).catch(() => {});
  void cloudinaryDestroy(staged.publicId, cloud, staged.apiKey, staged.apiSecret).catch(() => {});

  if (!baked.ok) {
    console.warn("[listing-studio] bake cream cutout failed — using derived URL only");
    return okResult(null, "cloudinary", {
      cleanUrl: derivedUrl,
      cleanPublicId: tempPublicId,
      baked: false,
    });
  }

  const id = baked.publicId;
  const cleanUrl =
    baked.uploaded.secure_url ||
    baked.uploaded.url ||
    `https://res.cloudinary.com/${cloud}/image/upload/${id}`;

  if (!wantClip) {
    return okResult(null, "cloudinary", { cleanUrl, cleanPublicId: id, baked: true });
  }

  // Zoompan on cream-flattened asset — do NOT put e_background_removal in the MP4 chain.
  const clipUrl =
    baked.uploaded.eager?.[0]?.secure_url ||
    baked.uploaded.eager?.[0]?.url ||
    bakedClipUrl(cloud, id);
  if (/e_background_removal/i.test(String(clipUrl))) {
    console.warn("[listing-studio] refusing video URL that still uses bg-removal transform");
    return okResult(null, "cloudinary", { cleanUrl, cleanPublicId: id, baked: true });
  }

  const clip = await finalizeClipUrl(clipUrl);
  return okResult(null, "cloudinary", {
    cleanUrl,
    cleanPublicId: id,
    baked: true,
    clipUrl: clip?.clipUrl || null,
    clipBuffer: clip?.clipBuffer || null,
    clipMimeType: "video/mp4",
  });
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

/** Default multi-reel: 2s per slide, padded square, light encode for Kenya mobile. */
function resolveReelTransform() {
  const delayMs = Number(env("CLOUDINARY_REEL_DELAY_MS")) || 2000;
  const custom = env("CLOUDINARY_REEL_TRANS");
  if (custom) return custom.includes("dl_") ? custom : `dl_${delayMs}/${custom}`;
  return `dl_${delayMs}/w_720,h_720,c_pad,b_rgb:${CREAM_BG}/q_auto:eco,vc_h264`;
}

/**
 * URL safe to feed into Cloudinary multi as a frame.
 * - Baked cutout base URL (transparent PNG already stored), or
 * - Derived URL that still includes e_background_removal (image fetch applies AI).
 * Never strip bg-removal transforms down to the original base — that merges dirty photos.
 */
function multiFrameUrl(url, { baked = false } = {}) {
  const raw = String(url || "").trim().split("?")[0];
  if (!/^https?:\/\//i.test(raw)) return null;
  // Cream-flattened JPEG base — safe for MP4.
  if (baked) return raw;
  // Derived bg-removal URL: force cream under alpha before multi fetches the frame.
  if (/e_background_removal/i.test(raw)) {
    if (/b_rgb:/i.test(raw)) return raw;
    return raw
      .replace(/e_background_removal/i, `e_background_removal/b_rgb:${CREAM_BG}`)
      .replace(/\/f_png\b/i, "/f_jpg");
  }
  // Unknown base URL — refuse (likely the uncleaned original).
  return null;
}

/**
 * Cloudinary Multi API — one MP4 from ordered cleaned image URLs.
 * REST requires repeated `urls[]` fields (not a pipe-separated `urls` string).
 * Signature joins the array with commas (Cloudinary SDK convention).
 */
async function cloudinaryMultiByUrls(urls, opts = {}) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const format = opts.format || "mp4";
  const transformation = opts.transformation || resolveReelTransform();
  const bakedFlags = opts.bakedFlags || [];
  const list = (urls || [])
    .map((u, i) => multiFrameUrl(u, { baked: bakedFlags[i] === true }))
    .filter(Boolean);
  if (list.length < 2) {
    console.warn(
      "[listing-studio] multi(urls) skipped — need ≥2 clean frame URLs (baked or bg-removal derived)"
    );
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  // Sign like the official SDK: array values joined with commas.
  const signParams = { urls: list.join(","), timestamp, format, transformation };
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  for (const u of list) form.append("urls[]", u);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  form.append("format", format);
  form.append("transformation", transformation);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/multi`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary multi(urls) failed:", res.status, errText.slice(0, 240));
    return null;
  }
  return res.json().catch(() => null);
}

/**
 * Cloudinary Multi API — one MP4 from assets sharing a tag (ordered by public_id).
 * Fallback when urls[] is rejected; reel_XX_01 / _02 public_ids keep slide order.
 */
async function cloudinaryMultiByTag(tag, opts = {}) {
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const apiKey = env("CLOUDINARY_API_KEY");
  const apiSecret = env("CLOUDINARY_API_SECRET");
  const format = opts.format || "mp4";
  const transformation = opts.transformation || resolveReelTransform();
  if (!tag) return null;

  const timestamp = Math.floor(Date.now() / 1000);
  const signParams = { tag, timestamp, format, transformation };
  const signature = cloudinarySign(signParams, apiSecret);

  const form = new FormData();
  form.append("tag", tag);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", signature);
  form.append("format", format);
  form.append("transformation", transformation);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/multi`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn("[listing-studio] Cloudinary multi(tag) failed:", res.status, errText.slice(0, 240));
    return null;
  }
  return res.json().catch(() => null);
}

/**
 * Prefer ordered urls[] of baked/derived-clean frames; fall back to tag only when
 * every slide was baked onto a clean-only reel_* asset (tags never touch originals).
 */
async function cloudinaryMultiReel(imageUrls, reelTag, opts = {}) {
  const byUrls = await cloudinaryMultiByUrls(imageUrls, opts);
  if (byUrls?.secure_url || byUrls?.url) return byUrls;
  const allBaked =
    Array.isArray(opts.bakedFlags) &&
    opts.bakedFlags.length >= 2 &&
    opts.bakedFlags.every(Boolean);
  if (reelTag && allBaked) {
    const byTag = await cloudinaryMultiByTag(reelTag, opts);
    if (byTag?.secure_url || byTag?.url) return byTag;
  }
  return byUrls || null;
}

/**
 * Build a product video URL from already-cleaned Cloudinary stills (cream JPEGs).
 * Does not re-run background removal. Used when Preview cleaned photos but the
 * reel URL never reached publish (the common "images only" failure mode).
 *
 * @param {string[]} imageUrls
 * @returns {Promise<{ videoUrl: string, videoKind: "preview" }|null>}
 */
export async function attachVideoFromCleanImageUrls(imageUrls) {
  if (isStudioClipEnabled() === false) return null;
  const cloud = env("CLOUDINARY_CLOUD_NAME");
  const list = (imageUrls || [])
    .map((u) => String(u || "").trim().split("?")[0])
    .filter((u) => /^https?:\/\//i.test(u) && /res\.cloudinary\.com/i.test(u))
    .slice(0, 8);
  if (!list.length) return null;

  if (isCloudinaryConfigured()) {
    if (list.length === 1) {
      const pid = cloudinaryPublicIdFromUrl(list[0]);
      if (pid) {
        const videoUrl = bakedClipUrl(cloud, pid);
        // Soft wait — keep the URL even if CDN is still warming (unchanged happy path).
        await waitCloudinaryDerivedReady(videoUrl, {
          label: "attach-clip",
          timeoutMs: 45_000,
          attempts: 4,
        }).catch(() => false);
        return { videoUrl, videoKind: "preview" };
      }
    } else {
      const multi = await cloudinaryMultiByUrls(list, {
        format: "mp4",
        transformation: resolveReelTransform(),
        bakedFlags: list.map(() => true),
      });
      let videoUrl = multi?.secure_url || multi?.url || null;
      if (videoUrl) {
        await waitCloudinaryDerivedReady(videoUrl, {
          label: "attach-reel",
          timeoutMs: 60_000,
          attempts: 5,
        }).catch(() => false);
        return { videoUrl, videoKind: "preview" };
      }

      // Multi failed — still ship a single-photo zoompan so the listing isn't stills-only.
      const pid = cloudinaryPublicIdFromUrl(list[0]);
      if (pid) {
        videoUrl = bakedClipUrl(cloud, pid);
        console.warn("[listing-studio] multi attach failed — using cover zoompan", pid);
        await waitCloudinaryDerivedReady(videoUrl, {
          label: "attach-zoompan-fallback",
          timeoutMs: 45_000,
          attempts: 4,
        }).catch(() => false);
        return { videoUrl, videoKind: "preview" };
      }
    }
  }

  // No Cloudinary clip URL possible — optional HyperFrames / Remotion.
  const fallback = await tryClipFallbacks(list);
  if (fallback?.videoUrl) return { videoUrl: fallback.videoUrl, videoKind: "preview" };
  return null;
}

/**
 * Ensure a baked clean CDN PNG (+ optional clip) for one listing photo.
 * @param {string|Buffer} source — HTTPS URL or image buffer
 * @param {string} [mimeType]
 * @param {{ publicId?: string, tags?: string, wantClip?: boolean }} [opts]
 */
export async function ensureCleanCutout(source, mimeType = "image/jpeg", opts = {}) {
  if (!isCloudinaryConfigured()) return null;
  const cloud = env("CLOUDINARY_CLOUD_NAME");

  if (Buffer.isBuffer(source)) {
    const cleaned = await removeBackgroundCloudinary(source, mimeType, {
      wantClip: opts.wantClip,
      cutoutPublicId: opts.publicId,
      tags: opts.tags,
    });
    if (!cleaned.studioApplied) return null;
    return {
      cleanUrl: cleaned.cleanUrl,
      cleanPublicId: cleaned.cleanPublicId,
      baked: cleaned.baked === true,
      clipUrl: cleaned.clipUrl || null,
      clipBuffer: cleaned.clipBuffer || null,
    };
  }

  if (typeof source === "string" && isCloudinaryDeliveryUrl(source)) {
    const pid = cloudinaryPublicIdFromUrl(source);
    if (!pid) return null;

    // Already a final studio asset (cream JPEG cutout / reel slide) — do not re-run bg-removal.
    // Cream flatten produces JPEG (no alpha); requiring PNG alpha here was dropping reels on publish.
    if (!/e_background_removal/i.test(source)) {
      const baseUrl = source.split("?")[0];
      const looksFinal =
        /\.(jpe?g)(\?|$)/i.test(baseUrl) ||
        /\/f_jpg\b/i.test(source) ||
        /\/(cutout_|reel_|alpha_)/i.test(`/${pid}`);
      let ready = looksFinal;
      if (!ready) {
        ready = await waitCloudinaryCleanPng(baseUrl, {
          label: "ensure-baked",
          attempts: 4,
        });
      }
      if (ready) {
        let clipUrl = null;
        let clipBuffer = null;
        if (opts.wantClip) {
          const clip = await finalizeClipUrl(bakedClipUrl(cloud, pid));
          clipUrl = clip?.clipUrl || null;
          clipBuffer = clip?.clipBuffer || null;
        }
        return {
          cleanUrl: baseUrl,
          cleanPublicId: pid,
          baked: true,
          clipUrl,
          clipBuffer,
        };
      }
    }

    // Derived clean URL or dirty base — download PNG bytes and bake into opts.publicId / new cutout.
    const derived = /e_background_removal/i.test(source)
      ? source.split("?")[0]
      : cleanedPngUrl(cloud, pid);
    const alphaOk = await waitCloudinaryCleanPng(derived, {
      label: "ensure-clean",
      attempts: Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 12,
    });
    if (!alphaOk) return null;
    let cleanBuf = await fetchCloudinaryDerived(derived, {
      label: "ensure-download",
      timeoutMs: 120_000,
      attempts: 5,
    });
    if (!cleanBuf?.length || !isPngBuffer(cleanBuf)) return null;
    if (!pngHasAlpha(cleanBuf)) {
      // Keep derived URL for display; do not store opaque bytes as a "cutout".
      return {
        cleanUrl: derived,
        cleanPublicId: pid,
        baked: false,
        clipUrl: null,
        clipBuffer: null,
      };
    }
    const stored = await storeCleanPngBufferAndClip(cleanBuf, {
      publicId: opts.publicId,
      tags: opts.tags,
      wantClip: opts.wantClip === true,
    });
    cleanBuf = null;
    if (!stored) return null;
    return { ...stored, baked: true };
  }

  if (typeof source === "string" && /^https?:\/\//i.test(source)) {
    // Raw remote URL — download bytes here, then full Cloudinary bake pipeline.
    const res = await fetch(source, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    if (!raw.length) return null;
    return ensureCleanCutout(raw, mimeType || res.headers.get("content-type") || "image/jpeg", opts);
  }

  return null;
}

/**
 * Build ONE continuous showcase MP4 from 1–8 cleaned product photos.
 * - 1 photo: zoompan teaser on the cutout (existing clip path)
 * - 2–8 photos: Cloudinary multi slideshow (≈2s per slide)
 *
 * Returns durable CDN URLs to persist in the catalog — never regenerate per page view.
 *
 * @param {Array<string|Buffer|{url?:string,buffer?:Buffer,mimeType?:string}>} sources
 * @param {{ existingClipUrl?: string|null, productKey?: string }} [opts]
 * @returns {Promise<{ imageUrls: string[], videoUrl: string|null, videoKind: "preview"|null }|null>}
 */
export async function prepareListingShowcaseMedia(sources, opts = {}) {
  if (!isCloudinaryConfigured()) return null;
  const list = (Array.isArray(sources) ? sources : []).slice(0, 8);
  if (!list.length) return null;

  const stamp = Math.floor(Date.now() / 1000);
  const reelTag = `reel_${stamp}_${crypto.randomBytes(3).toString("hex")}`;
  const cutouts = [];
  const wantClipSingle = list.length === 1 && env("STUDIO_CLIP_ENABLED") !== "false";

  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    let source = item;
    let mime = "image/jpeg";
    if (item && typeof item === "object" && !Buffer.isBuffer(item)) {
      source = item.url || item.buffer || null;
      mime = item.mimeType || mime;
    }
    if (!source) continue;

    // Ordered public_ids so Cloudinary multi(tag) keeps seller photo order.
    const slideId = `reel_${stamp}_${String(i + 1).padStart(2, "0")}`;
    const cut = await ensureCleanCutout(source, mime, {
      publicId: slideId,
      tags: reelTag,
      wantClip: wantClipSingle,
    });
    if (cut?.cleanUrl) cutouts.push(cut);
  }

  if (!cutouts.length) {
    return { imageUrls: [], videoUrl: null, videoKind: null, error: "clean_failed" };
  }

  const imageUrls = cutouts.map((c) => c.cleanUrl);
  const bakedFlags = cutouts.map((c) => c.baked === true);

  // Single photo: reuse existing clip only if it targets a baked asset (no bg-removal in MP4 chain).
  if (cutouts.length === 1) {
    const existing = String(opts.existingClipUrl || "");
    let videoUrl =
      (existing && !/e_background_removal/i.test(existing) ? existing : null) ||
      cutouts[0].clipUrl ||
      null;
    let clipProvider = videoUrl ? "cloudinary" : null;
    if (!videoUrl) {
      const fb = await tryClipFallbacks(imageUrls);
      if (fb?.videoUrl) {
        videoUrl = fb.videoUrl;
        clipProvider = fb.provider;
      }
    }
    return {
      imageUrls,
      videoUrl,
      videoKind: videoUrl ? "preview" : null,
      error: videoUrl ? null : "clip_failed",
      clipProvider,
    };
  }

  // 2–8 photos → one multi MP4 from baked cutouts (or bg-removal derived URLs).
  // Never pass dirty original base URLs — multi would merge uncleaned photos.
  const multi = await cloudinaryMultiReel(imageUrls, reelTag, {
    format: "mp4",
    transformation: resolveReelTransform(),
    bakedFlags,
  });
  let videoUrl = multi?.secure_url || multi?.url || null;
  let error = null;
  let clipProvider = videoUrl ? "cloudinary" : null;

  if (videoUrl) {
    const ready = await waitCloudinaryDerivedReady(videoUrl, {
      label: "showcase-reel",
      timeoutMs: 180_000,
      attempts: Number(env("CLOUDINARY_DERIVED_ATTEMPTS")) || 12,
    });
    if (!ready) {
      // Still return the URL — Cloudinary often finishes shortly after; buyers hit CDN later.
      console.warn("[listing-studio] showcase reel not confirmed ready yet — keeping URL", videoUrl.slice(0, 96));
      error = "reel_pending";
    }
  } else {
    error = "multi_failed";
    console.warn("[listing-studio] Cloudinary multi returned no URL", { reelTag, slides: imageUrls.length });
  }

  // Soft fallback: first slide zoompan if multi failed (still better than nothing).
  if (!videoUrl && cutouts[0].cleanPublicId) {
    const cloud = env("CLOUDINARY_CLOUD_NAME");
    const fallback = await finalizeClipUrl(bakedClipUrl(cloud, cutouts[0].cleanPublicId));
    videoUrl = fallback?.clipUrl || cutouts[0].clipUrl || null;
    if (videoUrl) clipProvider = "cloudinary";
  }

  // Soft fallbacks: HyperFrames / Remotion only after Cloudinary paths miss.
  if (!videoUrl) {
    const fb = await tryClipFallbacks(imageUrls);
    if (fb?.videoUrl) {
      videoUrl = fb.videoUrl;
      clipProvider = fb.provider;
      error = null;
    }
  }

  return {
    imageUrls,
    videoUrl,
    videoKind: videoUrl ? "preview" : null,
    // Keep reel_pending when URL exists but CDN not confirmed; clear multi_failed if fallback clip worked.
    error: videoUrl ? (error === "multi_failed" ? null : error) : error || "reel_failed",
    reelTag,
    slideCount: cutouts.length,
    clipProvider,
  };
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
 * Pass one buffer, or an array of buffers (2–8) to build a single showcase reel.
 * Default: CDN URLs only — never embed multi‑MB PNG/MP4 base64 (crashes 1GB VMs).
 * @param {Buffer|Buffer[]} bufferOrList
 * @param {string} [mimeType]
 */
export async function previewStudioClean(bufferOrList, mimeType = "image/jpeg") {
  const list = (Array.isArray(bufferOrList) ? bufferOrList : [bufferOrList])
    .filter((b) => Buffer.isBuffer(b) && b.length)
    .slice(0, 8);

  if (!list.length) {
    return {
      studioApplied: false,
      cleanImageBase64: null,
      cleanImageUrl: null,
      clipVideoBase64: null,
      clipVideoUrl: null,
      clipApplied: false,
      imageUrls: [],
      reason: "missing_image",
      provider: null,
      message: "Add a cover photo first.",
    };
  }

  // Multi-photo: clean all + one Cloudinary multi reel (what sellers expect from Preview).
  if (list.length > 1 && isCloudinaryConfigured() && isStudioClipEnabled()) {
    try {
      const showcase = await prepareListingShowcaseMedia(list, {});
      if (showcase?.imageUrls?.length && showcase.videoUrl) {
        return {
          studioApplied: true,
          cleanImageBase64: null,
          cleanImageUrl: showcase.imageUrls[0],
          clipVideoBase64: null,
          clipVideoUrl: showcase.videoUrl,
          clipApplied: true,
          imageUrls: showcase.imageUrls,
          reason: null,
          provider: "cloudinary",
          message: `Cleaned ${showcase.imageUrls.length} photos + one ${showcase.imageUrls.length * 2}s showcase reel — use the toggles below.`,
        };
      }
      if (showcase?.imageUrls?.length) {
        // Second chance: build reel/zoompan from the cleaned CDN stills (no re-clean).
        const attached = await attachVideoFromCleanImageUrls(showcase.imageUrls);
        if (attached?.videoUrl) {
          return {
            studioApplied: true,
            cleanImageBase64: null,
            cleanImageUrl: showcase.imageUrls[0],
            clipVideoBase64: null,
            clipVideoUrl: attached.videoUrl,
            clipApplied: true,
            imageUrls: showcase.imageUrls,
            reason: null,
            provider: "cloudinary",
            message: `Cleaned ${showcase.imageUrls.length} photos + product video — use the toggles below.`,
          };
        }
        return {
          studioApplied: true,
          cleanImageBase64: null,
          cleanImageUrl: showcase.imageUrls[0],
          clipVideoBase64: null,
          clipVideoUrl: null,
          clipApplied: false,
          imageUrls: showcase.imageUrls,
          reason: showcase.error || "reel_failed",
          provider: "cloudinary",
          message:
            "Photos cleaned, but the product video failed — try Preview again before posting.",
        };
      }
    } catch (err) {
      console.warn("[listing-studio] multi preview failed:", err.message);
    }
  }

  const cleaned = await removeBackground(list[0], mimeType);
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
      imageUrls: [],
      reason: cleaned.reason || "api_failed",
      provider: cleaned.provider || null,
      message: messages[cleaned.reason] || messages.api_failed,
    };
  }

  let { clipApplied, clipVideoUrl, clipVideoBase64 } = formatClipPayload(cleaned);
  const { cleanImageUrl, cleanImageBase64 } = formatCleanImagePayload(cleaned);

  // Fallback: if we only have a buffer (e.g. Photoroom without Cloudinary store), inline once.
  let cleanB64 = cleanImageBase64;
  let cleanUrl = cleanImageUrl;
  if (!cleanUrl && !cleanB64 && cleaned.buffer?.length) {
    cleanB64 = `data:image/png;base64,${cleaned.buffer.toString("base64")}`;
  }

  // Eager clip may still be warming — derive zoompan URL from the cream cutout anyway.
  if (!clipApplied && cleanUrl && isStudioClipEnabled()) {
    try {
      const attached = await attachVideoFromCleanImageUrls([cleanUrl]);
      if (attached?.videoUrl) {
        clipVideoUrl = attached.videoUrl;
        clipVideoBase64 = null;
        clipApplied = true;
      }
    } catch (err) {
      console.warn("[listing-studio] single preview reel attach failed:", err?.message || err);
    }
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
    imageUrls: cleanUrl ? [cleanUrl] : [],
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
