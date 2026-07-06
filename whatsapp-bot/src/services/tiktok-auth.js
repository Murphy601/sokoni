import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TOKEN_FILE = path.join(DATA_DIR, "tiktok-oauth.json");
const STATE_FILE = path.join(DATA_DIR, "tiktok-oauth-state.json");

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";

/** In-memory pending OAuth states (also persisted briefly for restarts). */
const pendingStates = new Map();

let refreshInFlight = null;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadTokenState() {
  try {
    if (existsSync(TOKEN_FILE)) {
      return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("[tiktok:oauth] load tokens:", err.message);
  }
  return null;
}

function saveTokenState(state) {
  ensureDataDir();
  writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2));
}

function loadPendingStates() {
  try {
    if (existsSync(STATE_FILE)) {
      const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      const now = Date.now();
      for (const [state, exp] of Object.entries(raw || {})) {
        if (exp > now) pendingStates.set(state, exp);
      }
    }
  } catch {
    /* ignore */
  }
}

function persistPendingStates() {
  try {
    ensureDataDir();
    const payload = Object.fromEntries(pendingStates);
    writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error("[tiktok:oauth] persist state:", err.message);
  }
}

loadPendingStates();

function tokenFromEnvBootstrap() {
  const { accessToken, refreshToken } = config.tiktok;
  if (!accessToken || !refreshToken) return null;
  const now = Date.now();
  return {
    accessToken,
    refreshToken,
    accessExpiresAt: new Date(now + 23 * 60 * 60 * 1000).toISOString(),
    refreshExpiresAt: new Date(now + 364 * 24 * 60 * 60 * 1000).toISOString(),
    openId: "",
    scope: config.tiktok.scopes,
    updatedAt: new Date().toISOString(),
    source: "env-bootstrap",
  };
}

function getStoredTokens() {
  const file = loadTokenState();
  if (file?.refreshToken) return file;
  const boot = tokenFromEnvBootstrap();
  if (boot) {
    saveTokenState(boot);
    console.log("[tiktok:oauth] bootstrapped tokens from env → data/tiktok-oauth.json");
    return boot;
  }
  return null;
}

function isExpired(iso, bufferMs = 0) {
  if (!iso) return true;
  return Date.parse(iso) - bufferMs <= Date.now();
}

async function requestTokens(body) {
  const { clientKey, clientSecret } = config.tiktok;
  if (!clientKey || !clientSecret) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are required");
  }

  const params = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    ...body,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error_description || data.error || `TikTok OAuth failed (${res.status})`);
  }
  return data;
}

function normalizeTokenResponse(data) {
  const now = Date.now();
  const accessBufferMs = 5 * 60 * 1000;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: new Date(now + data.expires_in * 1000 - accessBufferMs).toISOString(),
    refreshExpiresAt: new Date(now + data.refresh_expires_in * 1000).toISOString(),
    openId: data.open_id || "",
    scope: data.scope || "",
    updatedAt: new Date().toISOString(),
  };
}

/** Exchange OAuth authorization code (one-time connect). */
export async function exchangeAuthorizationCode(code) {
  const data = await requestTokens({
    code,
    grant_type: "authorization_code",
    redirect_uri: config.tiktok.redirectUri,
  });
  const state = normalizeTokenResponse(data);
  saveTokenState(state);
  console.log("[tiktok:oauth] connected", state.openId || "(user)");
  return state;
}

/** Refresh access token using stored refresh token. */
export async function refreshAccessToken({ force = false } = {}) {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const stored = getStoredTokens();
    if (!stored?.refreshToken) {
      throw new Error("TikTok not connected — run scripts/tiktok-connect.mjs first");
    }

    if (!force && stored.accessToken && !isExpired(stored.accessExpiresAt)) {
      return stored.accessToken;
    }

    if (isExpired(stored.refreshExpiresAt)) {
      throw new Error("TikTok refresh token expired — reconnect via scripts/tiktok-connect.mjs");
    }

    const data = await requestTokens({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    });
    const next = normalizeTokenResponse(data);
    saveTokenState(next);
    console.log("[tiktok:oauth] access token refreshed");
    return next.accessToken;
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Valid access token for API calls — refreshes automatically when near expiry. */
export async function getValidAccessToken() {
  const stored = getStoredTokens();
  if (!stored) return "";
  if (stored.accessToken && !isExpired(stored.accessExpiresAt, 60_000)) {
    return stored.accessToken;
  }
  return refreshAccessToken();
}

export function getConnectionStatus() {
  const stored = getStoredTokens();
  if (!stored?.refreshToken) {
    return { connected: false, reason: "not_connected" };
  }
  return {
    connected: !isExpired(stored.refreshExpiresAt),
    openId: stored.openId || null,
    scope: stored.scope || null,
    accessExpiresAt: stored.accessExpiresAt,
    refreshExpiresAt: stored.refreshExpiresAt,
    updatedAt: stored.updatedAt,
    accessValid: stored.accessToken && !isExpired(stored.accessExpiresAt),
  };
}

export function buildAuthorizationUrl() {
  const { clientKey, redirectUri, scopes } = config.tiktok;
  if (!clientKey || !redirectUri) {
    throw new Error("TIKTOK_CLIENT_KEY and TIKTOK_REDIRECT_URI must be set");
  }

  const state = randomBytes(16).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  pendingStates.set(state, expiresAt);
  persistPendingStates();

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });

  return { url: `${AUTH_URL}?${params.toString()}`, state };
}

export function consumeOAuthState(state) {
  if (!state) return false;
  loadPendingStates();
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  persistPendingStates();
  return exp && exp > Date.now();
}

export function isSetupTokenValid(token) {
  const expected = config.tiktok.setupToken;
  return expected && token && token === expected;
}

/** Proactively refresh before cron posts (every 6h + on startup if expiring soon). */
export function startTokenRefreshScheduler() {
  const { clientKey, clientSecret } = config.tiktok;
  if (!clientKey || !clientSecret) return;

  const tick = async () => {
    try {
      const stored = getStoredTokens();
      if (!stored?.refreshToken) return;
      if (isExpired(stored.accessExpiresAt, 2 * 60 * 60 * 1000)) {
        await refreshAccessToken({ force: true });
      }
    } catch (err) {
      console.error("[tiktok:oauth] scheduled refresh:", err.message);
    }
  };

  tick();
  setInterval(tick, 6 * 60 * 60 * 1000);
}
