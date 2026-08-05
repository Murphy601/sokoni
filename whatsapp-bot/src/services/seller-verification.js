/**
 * Free WhatsApp OTP for seller sign-in — sent via existing WAHA session (Sokoni Mall).
 * Every visit requires a fresh code; session lasts for the browser tab (sessionStorage).
 */
import { randomInt, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendText, toChatId } from "./whatsapp.js";
import { config } from "../config.js";
import { findSupplierByPhone } from "./suppliers.js";

function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, "..", "..", "data", "seller-verification-store.json");

const CODE_TTL_MS = 10 * 60 * 1000;
/** Seller session after OTP — valid until browser session ends (client uses sessionStorage). */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 6;

/** @type {{ pending: Record<string, object>, sessions: Record<string, object> }} */
let store = { pending: {}, sessions: {} };
let loaded = false;

async function loadStore() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(await readFile(STORE_FILE, "utf-8"));
      store = { pending: {}, sessions: {}, ...raw };
      if (raw.verified && !raw.sessions) {
        store.sessions = {};
      }
    }
  } catch (err) {
    console.error("[seller-verification] load failed:", err.message);
  }
}

async function saveStore() {
  const dir = path.dirname(STORE_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

function isValidSignupPhone(phone) {
  const d = normalizePhone(phone);
  return d.length >= 12 && (/^2547\d{8}$/.test(d) || /^2541\d{8}$/.test(d));
}

function generateCode() {
  return String(randomInt(100000, 999999));
}

function generateToken() {
  return randomBytes(24).toString("hex");
}

function pruneExpired() {
  const now = Date.now();
  for (const [phone, entry] of Object.entries(store.pending)) {
    if (!entry?.expiresAt || entry.expiresAt < now) delete store.pending[phone];
  }
  for (const [phone, entry] of Object.entries(store.sessions || {})) {
    if (!entry?.expiresAt || entry.expiresAt < now) delete store.sessions[phone];
  }
}

function sendsInLastHour(entry) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const history = Array.isArray(entry?.sendHistory) ? entry.sendHistory : [];
  return history.filter((t) => t >= windowStart).length;
}

function verificationMessage(code) {
  return (
    `🔐 *Sokoni Mall* sign-in code\n\n` +
    `Your code: *${code}*\n\n` +
    `Valid for 10 minutes. Do not share this code with anyone.\n\n` +
    `_If you didn't request this, ignore this message._`
  );
}

function createSessionForPhone(digits) {
  const token = generateToken();
  const now = Date.now();
  store.sessions = store.sessions || {};
  store.sessions[digits] = {
    token,
    verifiedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  return { token, expiresInSec: Math.floor(SESSION_TTL_MS / 1000) };
}

/** Validate seller session token (required on every API call). */
export async function validateSellerSession(phone, sessionToken) {
  await loadStore();
  pruneExpired();

  const digits = normalizePhone(phone);
  const token = String(sessionToken || "").trim();
  if (!isValidSignupPhone(digits)) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }
  if (!token) {
    return {
      error: "session_required",
      message: "Sign in with the WhatsApp code sent to your phone.",
    };
  }

  const entry = store.sessions?.[digits];
  if (!entry || entry.token !== token) {
    return {
      error: "session_invalid",
      message: "Session expired — verify WhatsApp again to continue.",
    };
  }
  if (entry.expiresAt < Date.now()) {
    delete store.sessions[digits];
    await saveStore();
    return {
      error: "session_expired",
      message: "Session expired — request a new WhatsApp code.",
    };
  }

  return { ok: true, phone: digits };
}

export async function revokeSellerSession(phone) {
  await loadStore();
  const digits = normalizePhone(phone);
  if (store.sessions?.[digits]) {
    delete store.sessions[digits];
    await saveStore();
  }
  return { ok: true };
}

/** POST send-code — deliver OTP on WhatsApp. */
export async function sendSellerVerificationCode(phone) {
  await loadStore();
  pruneExpired();

  const digits = normalizePhone(phone);
  if (!isValidSignupPhone(digits)) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number (07xx or 2547xx)." };
  }

  const now = Date.now();
  let entry = store.pending[digits];

  if (entry?.lastSentAt && now - entry.lastSentAt < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - entry.lastSentAt)) / 1000);
    return {
      error: "rate_limited",
      message: `Wait ${waitSec} seconds before requesting another code.`,
      retryAfterSec: waitSec,
    };
  }

  if (entry && sendsInLastHour(entry) >= MAX_SENDS_PER_HOUR) {
    return {
      error: "rate_limited",
      message: "Too many codes sent — try again in an hour or WhatsApp us for help.",
    };
  }

  const code = generateCode();
  const sendHistory = [...(entry?.sendHistory || []), now].slice(-20);

  entry = {
    code,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0,
    lastSentAt: now,
    sendHistory,
  };
  store.pending[digits] = entry;
  await saveStore();

  const chatId = toChatId(digits);
  try {
    const { attachSellerWhatsAppChat } = await import("./suppliers.js");
    // OTP send is the website onboarding handshake — bind @c.us immediately.
    attachSellerWhatsAppChat(digits, chatId);
  } catch (err) {
    console.warn("[seller-verification] chat bind skipped:", err.message);
  }
  try {
    const resp = await sendText(chatId, verificationMessage(code));
    if (resp?.dryRun) {
      console.log(`[seller-verification] dry-run OTP for ${digits}: ${code}`);
    }
  } catch (err) {
    delete store.pending[digits];
    await saveStore();
    console.error("[seller-verification] send failed:", err.message);
    return {
      error: "send_failed",
      message: "Could not send WhatsApp code — make sure Sokoni WhatsApp is online and try again.",
    };
  }

  return {
    success: true,
    message: "Code sent on WhatsApp from Sokoni Mall. Check your chats.",
    expiresInSec: Math.floor(CODE_TTL_MS / 1000),
    dryRun: !config.waha.apiUrl,
  };
}

/** POST verify-code — check OTP and issue seller session token. */
export async function verifySellerCode(phone, codeInput) {
  await loadStore();
  pruneExpired();

  const digits = normalizePhone(phone);
  const code = String(codeInput || "").replace(/\D/g, "").trim();

  if (!isValidSignupPhone(digits)) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }
  if (code.length !== 6) {
    return { error: "invalid_code", message: "Enter the 6-digit code from WhatsApp." };
  }

  const entry = store.pending[digits];
  if (!entry) {
    return { error: "no_code", message: "No active code — tap Send code on WhatsApp first." };
  }
  if (entry.expiresAt < Date.now()) {
    delete store.pending[digits];
    await saveStore();
    return { error: "expired", message: "Code expired — request a new one." };
  }
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    delete store.pending[digits];
    await saveStore();
    return { error: "too_many_attempts", message: "Too many wrong tries — request a new code." };
  }

  if (entry.code !== code) {
    entry.attempts += 1;
    store.pending[digits] = entry;
    await saveStore();
    const left = MAX_VERIFY_ATTEMPTS - entry.attempts;
    return {
      error: "wrong_code",
      message: left > 0 ? `Wrong code — ${left} attempt${left === 1 ? "" : "s"} left.` : "Wrong code — request a new one.",
    };
  }

  delete store.pending[digits];
  const session = createSessionForPhone(digits);
  await saveStore();

  try {
    const { attachSellerWhatsAppChat } = await import("./suppliers.js");
    attachSellerWhatsAppChat(digits, toChatId(digits));
  } catch (err) {
    console.warn("[seller-verification] post-verify chat bind skipped:", err.message);
  }

  const existing = findSupplierByPhone(digits);
  const needsSetup = !existing;

  return {
    success: true,
    sessionToken: session.token,
    verificationToken: session.token,
    needsSetup,
    seller: existing
      ? {
          id: existing.id,
          businessName: existing.businessName,
          shopHandle: existing.shopHandle || null,
          phone: existing.phone,
          mpesaNumber: existing.mpesaNumber || null,
          isSellerVerified: Boolean(existing.isSellerVerified),
        }
      : null,
    message: needsSetup
      ? "WhatsApp verified — set up your seller profile below."
      : "Signed in — loading your dashboard…",
    expiresInSec: session.expiresInSec,
  };
}

/** @deprecated Use validateSellerSession — kept for compatibility. */
export async function consumeVerificationToken(phone, token) {
  return validateSellerSession(phone, token);
}

export function sellerSessionFromReq(req) {
  return (
    req.query?.sessionToken ||
    req.headers["x-seller-session"] ||
    req.body?.sessionToken ||
    req.body?.verificationToken ||
    null
  );
}
