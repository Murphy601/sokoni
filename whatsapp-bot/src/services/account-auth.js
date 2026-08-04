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
  findUserByPhone,
  setUserPasswordResetToken,
  findUserByPasswordResetToken,
  updateUserPasswordHash,
  unifyEmailAccountWithPhone,
  updateAccountProfile,
} from "../db/repositories/users.js";
import { isDbEnabled } from "../db/pool.js";
import { config } from "../config.js";
import { sendText } from "./whatsapp.js";
import { validateBuyerSession } from "./buyer-verification.js";
import { validateSellerSession } from "./seller-verification.js";

const scrypt = promisify(scryptCb);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, "..", "..", "data", "account-sessions.json");

/** Default session: 14 days; remember-me: 90 days. */
export const ACCOUNT_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const ACCOUNT_REMEMBER_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
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

  const ttlMs = rememberMe ? ACCOUNT_REMEMBER_TTL_MS : ACCOUNT_SESSION_TTL_MS;
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

  // Sliding expiry: refresh when more than halfway through the window.
  const remaining = entry.expiresAt - Date.now();
  if (remaining < ACCOUNT_SESSION_TTL_MS / 2) {
    entry.expiresAt = Date.now() + ACCOUNT_SESSION_TTL_MS;
    await saveStore();
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

/** Request password reset — sends WhatsApp link when phone is on file (free via WAHA). */
export async function requestPasswordReset(email) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured yet." };
  }
  const generic = {
    ok: true,
    message:
      "If that email is on Sokoni and has WhatsApp on file, we sent a reset link. Check WhatsApp.",
  };
  const found = await findUserByEmail(email);
  if (found.error || !found.user || !found.passwordHash) {
    return generic;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  await setUserPasswordResetToken(found.user.id, token, expiresAt);

  const site = config.publicSiteUrl || "https://sokonimall.com";
  const resetUrl = `${site}/reset-password.html?token=${encodeURIComponent(token)}`;

  if (found.user.phone) {
    try {
      await sendText(
        found.user.phone,
        `Sokoni Mall password reset\n\n` +
          `Tap to set a new password (valid 1 hour):\n${resetUrl}\n\n` +
          `_If you didn't ask for this, ignore the message._`
      );
    } catch (err) {
      console.warn("[account-auth] reset WhatsApp send failed:", err.message);
    }
  }

  return generic;
}

export async function resetPasswordWithToken({ token, password } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured yet." };
  }
  const pw = String(password || "");
  if (pw.length < 8) {
    return { error: "weak_password", message: "Use a password with at least 8 characters." };
  }
  const found = await findUserByPasswordResetToken(token);
  if (found.error) return found;
  if (!found.user || !found.resetExpiresAt || found.resetExpiresAt < Date.now()) {
    return { error: "invalid_token", message: "Reset link expired or invalid. Request a new one." };
  }
  const passwordHash = await hashPassword(pw);
  const updated = await updateUserPasswordHash(found.user.id, passwordHash);
  if (updated.error) return updated;
  const session = await createSession(updated.user);
  return {
    ok: true,
    user: publicUser(updated.user),
    ...session,
    message: "Password updated. You're signed in.",
  };
}

/** Continue with WhatsApp — OTP already verified via buyer auth. */
export async function loginWithWhatsApp({ phone, buyerSessionToken } = {}) {
  if (!isDbEnabled()) {
    return { error: "database_not_configured", message: "Database is not configured yet." };
  }
  const wa = await validateBuyerSession(phone, buyerSessionToken);
  if (wa.error) return wa;

  const found = await findUserByPhone(wa.phone);
  if (found.error) return found;
  if (!found.user) {
    return {
      error: "need_signup",
      phone: wa.phone,
      message: "No account for this WhatsApp yet — create a free email signup (phone will be filled in).",
    };
  }

  const session = await createSession(found.user, { ttlMs: ACCOUNT_REMEMBER_TTL_MS });
  return {
    ok: true,
    user: publicUser(found.user),
    ...session,
    message: "Signed in with WhatsApp.",
  };
}

/**
 * Link a verified WhatsApp buyer/seller session to the signed-in email account.
 * May merge a phone-only social user into the email account (or vice versa).
 */
export async function linkWhatsAppToAccount({
  accountToken,
  phone,
  whatsappSessionToken,
  role = "buyer",
} = {}) {
  const account = await validateAccountSession(accountToken);
  if (account.error) return account;

  const waToken = String(whatsappSessionToken || "").trim();
  const wa =
    role === "seller"
      ? await validateSellerSession(phone, waToken)
      : await validateBuyerSession(phone, waToken);
  if (wa.error) return wa;

  const found = await findUserById(account.user.id);
  if (found.error || !found.user) {
    return { error: "not_found", message: "Account not found." };
  }

  const unified = await unifyEmailAccountWithPhone({
    accountUserId: account.user.id,
    phone: wa.phone,
    passwordHash: found.passwordHash,
    email: account.user.email,
    displayName: account.user.displayName,
  });
  if (unified.error) return unified;

  // If merge kept a different user id, reissue session for the kept user.
  let sessionToken = accountToken;
  let expiresAt = account.expiresAt;
  if (unified.merged && unified.keptUserId && unified.keptUserId !== account.user.id) {
    await revokeAccountSession(accountToken);
    const session = await createSession(unified.user);
    sessionToken = session.sessionToken;
    expiresAt = session.expiresAt;
  }

  return {
    ok: true,
    user: publicUser(unified.user),
    merged: Boolean(unified.merged),
    sessionToken,
    expiresAt,
    expiresInSec: Math.max(60, Math.floor((expiresAt - Date.now()) / 1000)),
    message: unified.merged
      ? "WhatsApp linked — your earlier profile is now this same account."
      : "WhatsApp linked to your Sokoni account.",
  };
}
