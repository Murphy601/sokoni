/**
 * General (non-order) WhatsApp support inbox tickets.
 * Order HELP / ADMIN_TAKE_OVER stays on communication-hub supportThread.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendText } from "./whatsapp.js";
import { clearHumanHandoff, setHumanHandoff, setCustomerMeta } from "./session.js";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const STORE_FILE = path.join(DATA_DIR, "support-inbox.json");

let store = { seq: 0, tickets: {} };
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(STORE_FILE)) {
      store = { seq: 0, tickets: {}, ...JSON.parse(readFileSync(STORE_FILE, "utf-8")) };
      store.tickets = store.tickets || {};
    }
  } catch (err) {
    console.warn("[support-inbox] load failed:", err.message);
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn("[support-inbox] persist failed:", err.message);
  }
}

function nextId() {
  store.seq = Number(store.seq || 0) + 1;
  const year = new Date().getFullYear();
  return `SUP-${year}-${String(store.seq).padStart(4, "0")}`;
}

function normalizeTicketId(raw) {
  const id = String(raw || "").trim().toUpperCase();
  if (/^SUP-\d{4}-\d+$/.test(id)) return id;
  return "";
}

export function isGeneralSupportId(raw) {
  return Boolean(normalizeTicketId(raw));
}

function appendMessage(ticket, entry) {
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  messages.push({
    role: entry.role || "CUSTOMER",
    text: String(entry.text || "").slice(0, 2000),
    at: entry.at || Date.now(),
    direction: entry.direction || "inbound",
  });
  if (messages.length > 200) messages.splice(0, messages.length - 200);
  ticket.messages = messages;
  ticket.updatedAt = Date.now();
  ticket.lastMessage = String(entry.text || "").slice(0, 160);
}

/**
 * Open or reopen a general support ticket when someone asks for a human.
 */
export function openGeneralSupportTicket({
  customerKey,
  chatId = "",
  displayName = "",
  phone = "",
  lastMessage = "",
  priority = "normal",
  escalationReason = "",
} = {}) {
  load();
  const key = String(customerKey || "").trim();
  if (!key) return { error: "missing_customer" };

  setCustomerMeta(key, { chatId: chatId || key, displayName, phone });

  let ticket =
    Object.values(store.tickets).find(
      (t) => t.status === "open" && String(t.customerKey) === key
    ) || null;

  const pri = priority === "high" || priority === "urgent" ? "high" : "normal";

  if (!ticket) {
    const id = nextId();
    ticket = {
      id,
      kind: "general",
      priority: pri,
      escalationReason: String(escalationReason || "").slice(0, 120),
      customerKey: key,
      chatId: chatId || key,
      displayName: displayName || "",
      phone: phone || "",
      status: "open",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastMessage: "",
    };
    store.tickets[id] = ticket;
  } else {
    if (displayName) ticket.displayName = displayName;
    if (phone) ticket.phone = phone;
    if (chatId) ticket.chatId = chatId;
    if (pri === "high") ticket.priority = "high";
    if (escalationReason) ticket.escalationReason = String(escalationReason).slice(0, 120);
  }

  appendMessage(ticket, {
    role: "CUSTOMER",
    text: lastMessage
      ? lastMessage
      : "Requested to talk to a human (menu / free text).",
    direction: "inbound",
  });
  appendMessage(ticket, {
    role: "SYSTEM",
    text:
      pri === "high"
        ? "HIGH PRIORITY — bot paused; waiting for Sokoni support from admin inbox."
        : "Bot paused — waiting for Sokoni support reply from admin inbox.",
    direction: "system",
  });

  setHumanHandoff(key, {
    startedAt: Date.now(),
    ackSent: true,
    supportTicketId: ticket.id,
    generalSupport: true,
    priority: pri,
  });

  persist();
  return { ok: true, ticket };
}

/** Append a customer WhatsApp message while general handoff is open. */
export function appendGeneralSupportCustomerMessage(customerKey, text) {
  load();
  const key = String(customerKey || "").trim();
  const body = String(text || "").trim();
  if (!key || !body) return null;

  const ticket =
    Object.values(store.tickets).find(
      (t) => t.status === "open" && String(t.customerKey) === key
    ) || null;
  if (!ticket) return null;

  appendMessage(ticket, { role: "CUSTOMER", text: body, direction: "inbound" });
  persist();
  return ticket;
}

export function listOpenGeneralSupportTickets({ limit = 40 } = {}) {
  load();
  return Object.values(store.tickets)
    .filter((t) => t.status === "open")
    .sort((a, b) => {
      const pri = (x) => (x.priority === "high" || x.priority === "urgent" ? 1 : 0);
      const d = pri(b) - pri(a);
      if (d) return d;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    })
    .slice(0, limit)
    .map((t) => ({
      threadId: t.id,
      kind: "general",
      priority: t.priority || "normal",
      orderId: null,
      productName: null,
      label: t.displayName || t.phone || t.customerKey,
      lifecycle: t.priority === "high" ? "HIGH_PRIORITY_HANDOFF" : "HUMAN_HANDOFF",
      adminTakeOver: true,
      disputeHold: false,
      dropOff: null,
      buyerPhone: t.phone || null,
      customerKey: t.customerKey,
      threadCount: Array.isArray(t.messages) ? t.messages.length : 0,
      updatedAt: t.updatedAt || t.createdAt || null,
      lastMessage: t.lastMessage || null,
    }));
}

export function getGeneralSupportTicket(ticketId) {
  load();
  const id = normalizeTicketId(ticketId);
  const ticket = id ? store.tickets[id] : null;
  if (!ticket) return { error: "not_found" };
  return {
    threadId: ticket.id,
    orderId: ticket.id,
    kind: "general",
    lifecycle: ticket.status === "open" ? "HUMAN_HANDOFF" : "RESOLVED",
    adminTakeOver: ticket.status === "open",
    disputeHold: false,
    dropOff: null,
    productName: null,
    buyerPhone: ticket.phone || null,
    customerKey: ticket.customerKey,
    displayName: ticket.displayName || null,
    messages: Array.isArray(ticket.messages) ? ticket.messages : [],
  };
}

export async function replyGeneralSupportTicket(ticketId, message) {
  load();
  const id = normalizeTicketId(ticketId);
  const ticket = id ? store.tickets[id] : null;
  if (!ticket) return { error: "not_found" };
  if (ticket.status !== "open") {
    return { error: "already_resolved", message: "This thread is closed — customer can request a human again." };
  }
  const text = String(message || "").trim();
  if (!text) return { error: "missing_message" };

  const to = ticket.customerKey || ticket.chatId;
  if (!to) return { error: "no_buyer_chat", message: "No WhatsApp chat key on this ticket." };

  const body = `🛡️ *[Sokoni Support]:* ${text}`;
  try {
    await sendText(to, body);
  } catch (err) {
    return { error: "send_failed", message: err?.message || String(err) };
  }

  appendMessage(ticket, { role: "ADMIN", text, direction: "outbound" });
  setHumanHandoff(to, {
    startedAt: Date.now(),
    ackSent: true,
    supportTicketId: ticket.id,
    generalSupport: true,
    adminDirect: true,
  });
  persist();
  return { ok: true, ticketId: ticket.id, thread: getGeneralSupportTicket(ticket.id), notified: { buyer: true, seller: false } };
}

export async function resolveGeneralSupportTicket(ticketId, { note = "" } = {}) {
  load();
  const id = normalizeTicketId(ticketId);
  const ticket = id ? store.tickets[id] : null;
  if (!ticket) return { error: "not_found" };

  ticket.status = "resolved";
  ticket.resolvedAt = Date.now();
  ticket.updatedAt = Date.now();
  appendMessage(ticket, {
    role: "SYSTEM",
    text: note ? `Resolved: ${note}` : "Resolved — bot resumed for this chat.",
    direction: "system",
  });
  clearHumanHandoff(ticket.customerKey);
  persist();

  try {
    await sendText(
      ticket.customerKey,
      "Thanks — Sokoni support closed this chat. Type *menu* anytime, or say *talk to a human* if you need us again."
    );
  } catch {
    /* fail-soft */
  }

  return { ok: true, ticket: getGeneralSupportTicket(ticket.id) };
}

export function supportInboxSiteHint() {
  const base = String(config.publicSiteUrl || "https://sokonimall.com").replace(/\/$/, "");
  return `${base}/admin-support.html`;
}
