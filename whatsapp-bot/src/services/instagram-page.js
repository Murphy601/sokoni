/**
 * Instagram Content Publishing — same public CDN URLs as WhatsApp / Facebook drops.
 * Uses the Page access token and the linked Instagram Business account.
 */
import { config } from "../config.js";
import { facebookPageConfigured, mediaKindFromUrl } from "./facebook-page.js";

function apiVersion() {
  return String(config.facebook?.apiVersion || config.instagram?.apiVersion || "v21.0").replace(/^v/, "v");
}

function pageToken() {
  return String(config.facebook?.pageAccessToken || "").trim();
}

function pageId() {
  return String(config.facebook?.pageId || "").trim();
}

function configuredIgUserId() {
  return String(config.instagram?.userId || "").trim();
}

let cachedIgUserId = "";
let cachedIgUserAt = 0;

export function instagramPublishingConfigured() {
  if (!facebookPageConfigured()) return false;
  if (configuredIgUserId()) return true;
  return true;
}

export function instagramDropEnabled() {
  return Boolean(config.instagram?.dropEnabled && instagramPublishingConfigured());
}

async function graph(method, path, { query = {}, body = null } = {}) {
  const token = pageToken();
  const base = `https://graph.facebook.com/${apiVersion()}${path.startsWith("/") ? "" : "/"}${path}`;
  const url = new URL(base);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const init = { method, signal: AbortSignal.timeout(120_000) };
  if (body && method === "POST") {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null) form.set(k, String(v));
    }
    init.body = form;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = data?.error?.message || text.slice(0, 200);
    throw new Error(`Graph ${res.status}: ${err}`);
  }
  return data;
}

export async function resolveInstagramUserId({ force = false } = {}) {
  const explicit = configuredIgUserId();
  if (explicit) return explicit;
  if (!force && cachedIgUserId && Date.now() - cachedIgUserAt < 60 * 60 * 1000) return cachedIgUserId;
  const pid = pageId();
  if (!pid) throw new Error("missing_page_id");
  const data = await graph("GET", `/${pid}`, { query: { fields: "instagram_business_account" } });
  const id = data?.instagram_business_account?.id;
  if (!id) {
    throw new Error(
      "Page has no linked Instagram Business account. Link IG to the Page in Meta Business Suite, or set META_IG_USER_ID."
    );
  }
  cachedIgUserId = String(id);
  cachedIgUserAt = Date.now();
  return cachedIgUserId;
}

async function waitForContainer(creationId, { attempts = 30, delayMs = 2000 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const st = await graph("GET", `/${creationId}`, { query: { fields: "status_code,status" } });
    const code = String(st?.status_code || "").toUpperCase();
    if (code === "FINISHED") return st;
    if (code === "ERROR") {
      throw new Error(`Instagram container failed: ${st?.status || "ERROR"}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Instagram media container timed out");
}

async function publishContainer(igUserId, creationId) {
  return graph("POST", `/${igUserId}/media_publish`, { body: { creation_id: creationId } });
}

/** Feed photo post. */
export async function publishInstagramFeed({ text = "", mediaUrl = "" } = {}) {
  const caption = String(text || "").trim().slice(0, 2200);
  const media = String(mediaUrl || "").trim();
  if (!instagramPublishingConfigured()) {
    return { dryRun: true, surface: "FEED", text: caption, mediaUrl: media || null };
  }
  if (!media || mediaKindFromUrl(media) !== "image") {
    return {
      ok: false,
      surface: "FEED",
      error: "feed_requires_image",
      message: "Instagram feed posts need a public image URL.",
    };
  }
  const igUserId = await resolveInstagramUserId();
  const created = await graph("POST", `/${igUserId}/media`, {
    body: { image_url: media, caption },
  });
  const creationId = created.id;
  if (!creationId) throw new Error("Instagram media create missing id");
  await waitForContainer(creationId);
  const published = await publishContainer(igUserId, creationId);
  return { ok: true, surface: "FEED", kind: "image", id: published.id, creationId, raw: published };
}

/** Instagram Reel from public MP4. */
export async function publishInstagramReel({ text = "", mediaUrl = "" } = {}) {
  const caption = String(text || "").trim().slice(0, 2200);
  const media = String(mediaUrl || "").trim();
  if (!instagramPublishingConfigured()) {
    return { dryRun: true, surface: "REEL", text: caption, mediaUrl: media || null };
  }
  if (!media || mediaKindFromUrl(media) !== "video") {
    return {
      ok: false,
      surface: "REEL",
      error: "reel_requires_video",
      message: "Instagram Reels need a public HTTPS video (e.g. Cloudinary MP4).",
    };
  }
  const igUserId = await resolveInstagramUserId();
  const created = await graph("POST", `/${igUserId}/media`, {
    body: { media_type: "REELS", video_url: media, caption },
  });
  const creationId = created.id;
  if (!creationId) throw new Error("Instagram reel container missing id");
  await waitForContainer(creationId, { attempts: 45, delayMs: 3000 });
  const published = await publishContainer(igUserId, creationId);
  return { ok: true, surface: "REEL", kind: "video", id: published.id, creationId, raw: published };
}

/** Story — photo or short video. */
export async function publishInstagramStory({ text = "", mediaUrl = "" } = {}) {
  const caption = String(text || "").trim().slice(0, 2200);
  const media = String(mediaUrl || "").trim();
  if (!instagramPublishingConfigured()) {
    return { dryRun: true, surface: "STORY", text: caption, mediaUrl: media || null };
  }
  if (!media) throw new Error("Story needs media_url");
  const kind = mediaKindFromUrl(media);
  const igUserId = await resolveInstagramUserId();
  const body =
    kind === "video"
      ? { media_type: "STORIES", video_url: media, caption: caption.slice(0, 500) }
      : { media_type: "STORIES", image_url: media, caption: caption.slice(0, 500) };
  const created = await graph("POST", `/${igUserId}/media`, { body });
  const creationId = created.id;
  if (!creationId) throw new Error("Instagram story container missing id");
  await waitForContainer(creationId);
  const published = await publishContainer(igUserId, creationId);
  return { ok: true, surface: "STORY", kind, id: published.id, creationId, raw: published };
}
