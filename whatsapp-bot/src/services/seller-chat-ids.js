/**
 * Persist WhatsApp chatId → seller phone (especially @lid chats).
 * Mirrors admin-chat-ids bootstrap so DISPATCH works when WAHA hides digits.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "seller-chat-ids.json"
);

/** @type {Map<string, string>} chatId → phone digits */
const chatToPhone = new Map();
let loaded = false;

function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("0") && d.length >= 10) d = `254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) d = `254${d}`;
  if (!d.startsWith("254") && d.length >= 9) d = `254${d}`;
  return d.length >= 9 ? d : "";
}

function load() {
  if (loaded) return;
  loaded = true;
  chatToPhone.clear();
  try {
    if (!existsSync(FILE)) return;
    const raw = JSON.parse(readFileSync(FILE, "utf-8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const [chatId, phone] of Object.entries(raw)) {
        const p = normalizePhone(phone);
        if (chatId && p) chatToPhone.set(String(chatId), p);
      }
    }
  } catch (err) {
    console.warn("[seller-chat-ids] load failed:", err.message);
  }
}

function persist() {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify(Object.fromEntries(chatToPhone), null, 2));
  } catch (err) {
    console.warn("[seller-chat-ids] persist failed:", err.message);
  }
}

/** Remember that this WhatsApp chat belongs to a seller phone. */
export function registerSellerChatId(chatId, phone) {
  load();
  if (!chatId) return;
  const p = normalizePhone(phone);
  if (!p) return;
  const prev = chatToPhone.get(chatId);
  if (prev === p) return;
  chatToPhone.set(chatId, p);
  persist();
  console.log("[seller-chat-ids] linked", chatId, "→", p);
}

export function getSellerPhoneForChatId(chatId) {
  load();
  if (!chatId) return null;
  return chatToPhone.get(chatId) || null;
}

function phonesMatch(a, b) {
  const x = normalizePhone(a);
  const y = normalizePhone(b);
  if (!x || !y) return false;
  return x === y || x.slice(-9) === y.slice(-9);
}

/** All chatIds previously linked to this seller phone (includes @lid). */
export function listChatIdsForSellerPhone(phone) {
  load();
  const want = normalizePhone(phone);
  if (!want) return [];
  const out = [];
  for (const [chatId, p] of chatToPhone.entries()) {
    if (phonesMatch(p, want)) out.push(chatId);
  }
  return out;
}

/** Remember outbound @c.us target so inbound @lid can be linked later. */
export function rememberSellerNotifyTarget(phone, extraChatId = null) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const chat = `${p}@c.us`;
  registerSellerChatId(chat, p);
  if (extraChatId) registerSellerChatId(extraChatId, p);
  return chat;
}

/**
 * Bind this WhatsApp chat to a seller phone during onboarding / sign-in.
 * Primary path — sellers should never need LINKSELLER after this.
 */
export function bindSellerWhatsAppChat(chatId, phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  return rememberSellerNotifyTarget(p, chatId || null);
}

export function listSellerChatIds() {
  load();
  return Object.fromEntries(chatToPhone);
}

/** Drop all chatId → phone links for a purged seller. */
export function clearSellerChatIdsForPhone(phone) {
  load();
  const want = normalizePhone(phone);
  if (!want) return { ok: true, removed: 0 };
  let removed = 0;
  for (const [chatId, p] of [...chatToPhone.entries()]) {
    if (phonesMatch(p, want)) {
      chatToPhone.delete(chatId);
      removed += 1;
    }
  }
  if (removed) persist();
  return { ok: true, removed };
}
