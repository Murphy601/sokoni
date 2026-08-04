/**
 * Email/password site accounts — free signup (no mail vendor for Phase A).
 * Sessions are opaque tokens (file-backed), same pattern as buyer WhatsApp OTP.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEmailAccountUser,
  findUserByEmail,
  findUserById,
  updateAccountProfile,
} from "../db/repositories/users.js";
import { isDbEnabled } from "../db/pool.js";

const scrypt = promisify(scryptCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, "..", "..", "data", "account-sessions.json");

/** Default session: 7 days (Phase E can extend with “remember me”). */
export const ACCOUNT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

/** @type {{ sessions: Record<string, { userId: number, email: string, expiresAt: number }> }} */
let store = { sessions: {} };
let loaded = false;

async function loadStore() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(await readFile(STORE_FILE, "utf-8"));
      store = { sessions: {}, ...raw };
    }
  } catch (err) {
    console.error("[account-auth] load failed:", err.message);
  }
}

async function saveStore() {
  const dir = path.dirname(STORE_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

function pruneExpired() {
  const now = Date.now();
  for (const [token, entry] of Object.entries(store.sessions || {})) {
    if (!entry?.expiresAt || entry.expiresAt < now) delete store.sessions[token];
  }
}

function generateToken() {
  return randomBytes(32).toString("hex");
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(String(password), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${Buffer.from(derived).toString("hex")}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expectHex = parts[5];
  if (!salt || !expectHex || !Number.isFinite(N)) return false;
  const derived = await scrypt(String(password), salt, SCRYPT_KEYLEN, { N, r, p });
  const expect = Buffer.from(expectHex, "hex");
  const got = Buffer.from(derived);
  if (expect.length !== got.length) return false;
  return timingSafeEqual(expect, got);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    displayName: user.displayName || null,
    role: user.role || "buyer",
    handle: user.handle || null,
    shopName: user.shopName || null,
    hasPassword: Boolean(user.hasPassword),
  };
}

async function createSession(user, { ttlMs = ACCOUNT_SESSION_TTL_MS } = {}) {
  await loadStore();
  pruneExpired();
  const token = generateToken();
  const expiresAt = Date.now() + Math.max(60_000, ttlMs);
  store.sessions[token] = {
    userId: Number(user.id),
    email: user.email,
    expiresAt,
  };
  await saveStore();
  return {
    sessionToken: token,
    expiresInSec: Math.floor((expiresAt - Date.now()) / 1000),
    expiresAt,
  };
}

export async function signupAccount({ email, password, displayName, phone } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured yet — try again later." };
  }
  const pw = String(password || "");
  if (pw.length < 8) {
    return { error: "weak_password", message: "Use a password with at least 8 characters." };
  }
  if (pw.length > 200) {
    return { error: "weak_password", message: "Password is too long." };
  }

  const passwordHash = await hashPassword(pw);
  const created = await createEmailAccountUser({
    email,
    passwordHash,
    displayName,
    phone: phone || null,
  });
  if (created.error) return created;

  const session = await createSession(created.user);
  return {
    ok: true,
    user: publicUser(created.user),
    ...session,
    message: "Account created. You're signed in.",
  };
}

export async function loginAccount({ email, password, rememberMe = false } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured yet — try again later." };
  }
  const found = await findUserByEmail(email);
  if (found.error) return found;
  if (!found.user || !found.passwordHash) {
    return { error: "invalid_credentials", message: "Wrong email or password." };
  }
  const ok = await verifyPassword(password, found.passwordHash);
  if (!ok) {
    return { error: "invalid_credentials", message: "Wrong email or password." };
  }

  const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : ACCOUNT_SESSION_TTL_MS;
  const session = await createSession(found.user, { ttlMs });
  return {
    ok: true,
    user: publicUser(found.user),
    ...session,
    message: "Signed in.",
  };
}

export async function validateAccountSession(sessionToken) {
  await loadStore();
  pruneExpired();
  const token = String(sessionToken || "").trim();
  if (!token) {
    return { error: "session_required", message: "Sign in to continue." };
  }
  const entry = store.sessions?.[token];
  if (!entry) {
    return { error: "session_invalid", message: "Session expired — log in again." };
  }
  if (entry.expiresAt < Date.now()) {
    delete store.sessions[token];
    await saveStore();
    return { error: "session_expired", message: "Session expired — log in again." };
  }

  const found = await findUserById(entry.userId);
  if (found.error) return found;
  if (!found.user) {
    delete store.sessions[token];
    await saveStore();
    return { error: "session_invalid", message: "Account not found — sign up again." };
  }

  return {
    ok: true,
    sessionToken: token,
    user: publicUser(found.user),
    expiresAt: entry.expiresAt,
  };
}

export async function revokeAccountSession(sessionToken) {
  await loadStore();
  const token = String(sessionToken || "").trim();
  if (token && store.sessions?.[token]) {
    delete store.sessions[token];
    await saveStore();
  }
  return { ok: true };
}

export function extractAccountToken(req) {
  const header = req.get?.("x-account-token") || req.get?.("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  if (header && !header.includes(" ")) return String(header).trim();
  return String(req.body?.sessionToken || req.query?.sessionToken || "").trim();
}

export async function resolveAccountFromRequest(req) {
  const token = extractAccountToken(req);
  return validateAccountSession(token);
}

export async function updateSignedInProfile(sessionToken, patch) {
  const auth = await validateAccountSession(sessionToken);
  if (auth.error) return auth;
  const updated = await updateAccountProfile(auth.user.id, patch);
  if (updated.error) return updated;
  return { ok: true, user: publicUser(updated.user) };
}
