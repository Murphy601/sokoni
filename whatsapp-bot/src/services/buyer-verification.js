/**
 * Free WhatsApp OTP for buyer sign-in — sent via existing WAHA session (Sokoni Mall).
 * Session lasts for the browser tab (client uses sessionStorage).
 */
import { randomInt, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendText, toChatId } from "./whatsapp.js";
import { config } from "../config.js";
import { getWahaHealthSummary } from "./waha-session.js";

const WAHA_OFFLINE_MESSAGE =
  "Sokoni WhatsApp is temporarily offline — try again in a few minutes.";

function normalizePhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9) d = `254${d}`;
  return d;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, "..", "..", "data", "buyer-verification-store.json");

const CODE_TTL_MS = 10 * 60 * 1000;
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
    }
  } catch (err) {
    console.error("[buyer-verification] load failed:", err.message);
  }
}

async function saveStore() {
  const dir = path.dirname(STORE_FILE);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

function isValidBuyerPhone(phone) {
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
    `Sokoni Mall buyer sign-in code\n\n` +
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

export async function validateBuyerSession(phone, sessionToken) {
  await loadStore();
  pruneExpired();

  const digits = normalizePhone(phone);
  const token = String(sessionToken || "").trim();
  if (!isValidBuyerPhone(digits)) {
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
      message: "Session expired - verify WhatsApp again to continue.",
    };
  }
  if (entry.expiresAt < Date.now()) {
    delete store.sessions[digits];
    await saveStore();
    return {
      error: "session_expired",
      message: "Session expired - request a new WhatsApp code.",
    };
  }

  return { ok: true, phone: digits };
}

export async function revokeBuyerSession(phone) {
  await loadStore();
  const digits = normalizePhone(phone);
  if (store.sessions?.[digits]) {
    delete store.sessions[digits];
    await saveStore();
  }
  return { ok: true };
}

export async function sendBuyerVerificationCode(phone) {
  await loadStore();
  pruneExpired();

  const digits = normalizePhone(phone);
  if (!isValidBuyerPhone(digits)) {
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
      message: "Too many codes sent - try again in an hour or WhatsApp us for help.",
    };
  }

  if (config.waha.apiUrl) {
    try {
      const waha = await getWahaHealthSummary();
      if (!waha.wahaLinked || waha.wahaSessionStatus !== "WORKING") {
        console.error(
          `[buyer-verification] WAHA not ready: linked=${waha.wahaLinked} status=${waha.wahaSessionStatus}`
        );
        return {
          error: "send_failed",
          message: WAHA_OFFLINE_MESSAGE,
          wahaSessionStatus: waha.wahaSessionStatus || null,
        };
      }
    } catch (err) {
      console.warn("[buyer-verification] WAHA health check skipped:", err.message);
    }
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
    const resp = await sendText(chatId, verificationMessage(code));
    if (resp?.dryRun) {
      console.log(`[buyer-verification] dry-run OTP for ${digits}: ${code}`);
    }
  } catch (err) {
    delete store.pending[digits];
    await saveStore();
    console.error("[buyer-verification] send failed:", err.message);
    return {
      error: "send_failed",
      message: WAHA_OFFLINE_MESSAGE,
    };
  }

  return {
    success: true,
    message: "Code sent on WhatsApp from Sokoni Mall. Check your chats.",
    expiresInSec: Math.floor(CODE_TTL_MS / 1000),
    dryRun: !config.waha.apiUrl,
  };
}

export async function verifyBuyerCode(phone, codeInput) {
  await loadStore();
  pruneExpired();

  const digits = normalizePhone(phone);
  const code = String(codeInput || "").replace(/\D/g, "").trim();

  if (!isValidBuyerPhone(digits)) {
    return { error: "invalid_phone", message: "Enter a valid WhatsApp number." };
  }
  if (code.length !== 6) {
    return { error: "invalid_code", message: "Enter the 6-digit code from WhatsApp." };
  }

  const entry = store.pending[digits];
  if (!entry) {
    return { error: "no_code", message: "No active code - tap Send code on WhatsApp first." };
  }
  if (entry.expiresAt < Date.now()) {
    delete store.pending[digits];
    await saveStore();
    return { error: "expired", message: "Code expired - request a new one." };
  }
  if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
    delete store.pending[digits];
    await saveStore();
    return { error: "too_many_attempts", message: "Too many wrong tries - request a new code." };
  }

  if (entry.code !== code) {
    entry.attempts += 1;
    store.pending[digits] = entry;
    await saveStore();
    const left = MAX_VERIFY_ATTEMPTS - entry.attempts;
    return {
      error: "wrong_code",
      message: left > 0 ? `Wrong code - ${left} attempt${left === 1 ? "" : "s"} left.` : "Wrong code - request a new one.",
    };
  }

  delete store.pending[digits];
  const session = createSessionForPhone(digits);
  await saveStore();

  return {
    success: true,
    sessionToken: session.token,
    verificationToken: session.token,
    phone: digits,
    message: "WhatsApp verified - you can like, offer, chat, and review safely.",
    expiresInSec: session.expiresInSec,
  };
}

export function buyerSessionFromReq(req) {
  return (
    req.query?.sessionToken ||
    req.headers["x-buyer-session"] ||
    req.body?.sessionToken ||
    req.body?.verificationToken ||
    null
  );
}

export function normalizeBuyerPhone(phone) {
  return normalizePhone(phone);
}
