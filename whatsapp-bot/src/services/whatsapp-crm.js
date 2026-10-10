/**
 * EZContact-style WhatsApp mini-CRM: intent → tags, human assign,
 * Meta 24-hour customer-service window, tagged broadcasts.
 *
 * Tags persist in data/crm-contacts.json (gitignored) and are mirrored onto
 * session.customerMeta so chat-memory / Postgres keep the same fields.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { setCustomerMeta, getCustomerMeta, getHumanHandoff } from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DEFAULT_STORE = path.join(DATA_DIR, "crm-contacts.json");

export const CRM_WINDOW_MS = 24 * 60 * 60 * 1000;

export const CRM_TAGS = Object.freeze([
  "new_lead",
  "interested",
  "qualified",
  "ordering",
  "support",
  "complaint",
  "closed",
]);

export const CRM_INTENTS = Object.freeze([
  "greeting",
  "faq",
  "pricing",
  "product",
  "ordering",
  "support",
  "complaint",
  "closed",
  "unknown",
]);

const TAG_RANK = {
  closed: 0,
  new_lead: 10,
  interested: 20,
  qualified: 30,
  ordering: 40,
  support: 50,
  complaint: 60,
};

export const CRM_TEMPLATES = Object.freeze({
  follow_up:
    "Hi from Sokoni — still shopping? Reply here and I'll help with prepaid M-Pesa escrow.",
  interested_nudge:
    "Sokoni here — that item you asked about is still available. Reply YES to continue.",
  window_reopen:
    "Hi, this is Sokoni. Reply if you still need help with an order or a listing.",
  support_checkin:
    "Sokoni support here. Reply with your SKN order number and we will pick it up.",
});

const PRICING_RE =
  /\b(how much|price|bei|gharama|pesa ngapi|quote|cost|offer|discount|promo|sale)\b/i;
const PRODUCT_RE =
  /\b(stock|size|colour|color|available|catalog|do you have|una|looking for|viatu|shoes|jacket|phone|sku|listing)\b/i;
const ORDERING_RE =
  /\b(order|checkout|add to cart|buy now|lipa|pay now|stk|cart|niletee|nataka kununua)\b/i;
const QUALIFIED_RE =
  /\b(escrow|how (do i|to) pay|till|prepaid|delivery (fee|cost)|shipping to|mpesa|m-pesa)\b/i;
const SUPPORT_RE =
  /\b(support|customer\s*care|help\s*desk|where is my|track(ing)?|delayed|late delivery)\b/i;
const HUMAN_RE =
  /\b(human|agent|speak to|talk to|connect me|representative|nisaidie na mtu|real person)\b/i;
const COMPLAINT_RE =
  /\b(refund|scam|stolen|fraud|fake|never (arrived|received)|didn'?t (arrive|receive)|complaint|dispute|money back|wrong item)\b/i;
const CLOSED_RE =
  /\b(not interested|stop texting|cancel (this|chat)|never mind|no thanks|acha tu)\b/i;
const FAQ_RE =
  /\b(what is sokoni|how (does|do) (sokoni|escrow|this) work|who are you)\b/i;
const GREETING_RE = /^(hi|hello|hey|habari|sasa|mambo|niaje|poa|thanks|asante|karibu)\b/i;

let store = { contacts: {} };
let loaded = false;
let memoryOnly = false;
let storePath = process.env.CRM_STORE_PATH || DEFAULT_STORE;

function load() {
  if (loaded) return;
  loaded = true;
  if (memoryOnly) return;
  try {
    const file = storePath;
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf-8"));
      store = { contacts: parsed.contacts && typeof parsed.contacts === "object" ? parsed.contacts : {} };
    }
  } catch (err) {
    console.warn("[whatsapp-crm] load failed:", err.message);
  }
}

function persist() {
  if (memoryOnly) return;
  try {
    const dir = path.dirname(storePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(storePath, JSON.stringify(store, null, 2) + "\n");
  } catch (err) {
    console.warn("[whatsapp-crm] persist failed:", err.message);
  }
}

export function resetCrmStoreForTests(seed = {}) {
  memoryOnly = true;
  loaded = true;
  store = { contacts: { ...seed } };
}

export function normalizeCrmTag(raw) {
  const tag = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (tag === "new" || tag === "lead") return "new_lead";
  if (tag === "hot" || tag === "warm") return "interested";
  if (CRM_TAGS.includes(tag)) return tag;
  return "";
}

export function classifyLeadIntent(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { intent: "unknown", tag: "new_lead", assignHuman: false, confidence: "low" };
  }

  if (COMPLAINT_RE.test(raw)) {
    return { intent: "complaint", tag: "complaint", assignHuman: true, confidence: "high" };
  }
  if (HUMAN_RE.test(raw)) {
    return { intent: "support", tag: "support", assignHuman: true, confidence: "high" };
  }
  if (CLOSED_RE.test(raw)) {
    return { intent: "closed", tag: "closed", assignHuman: false, confidence: "medium" };
  }
  if (SUPPORT_RE.test(raw)) {
    return { intent: "support", tag: "support", assignHuman: false, confidence: "medium" };
  }
  if (ORDERING_RE.test(raw)) {
    return { intent: "ordering", tag: "ordering", assignHuman: false, confidence: "high" };
  }
  if (QUALIFIED_RE.test(raw)) {
    return { intent: "ordering", tag: "qualified", assignHuman: false, confidence: "medium" };
  }
  if (PRICING_RE.test(raw)) {
    return { intent: "pricing", tag: "interested", assignHuman: false, confidence: "high" };
  }
  if (PRODUCT_RE.test(raw)) {
    return { intent: "product", tag: "interested", assignHuman: false, confidence: "high" };
  }
  if (FAQ_RE.test(raw)) {
    return { intent: "faq", tag: "interested", assignHuman: false, confidence: "medium" };
  }
  if (GREETING_RE.test(raw) && raw.length < 40) {
    return { intent: "greeting", tag: "new_lead", assignHuman: false, confidence: "medium" };
  }
  return { intent: "unknown", tag: "new_lead", assignHuman: false, confidence: "low" };
}

export function nextCrmTag(existingTag, incomingTag) {
  const current = normalizeCrmTag(existingTag);
  const next = normalizeCrmTag(incomingTag) || "new_lead";
  if (!current) return next;
  if (current === "closed" && next !== "closed") {
    return TAG_RANK[next] >= TAG_RANK.interested ? next : current;
  }
  if (next === "closed") return "closed";
  if (next === "new_lead") return current;
  return TAG_RANK[next] >= TAG_RANK[current] ? next : current;
}

export function customerServiceWindow(lastInboundAt, now = Date.now()) {
  const ts = Number(lastInboundAt) || 0;
  if (!ts) {
    return { open: false, remainingMs: 0, lastInboundAt: 0, reason: "no_inbound" };
  }
  const remaining = CRM_WINDOW_MS - (now - ts);
  if (remaining > 0) {
    return { open: true, remainingMs: remaining, lastInboundAt: ts, reason: "inside_24h" };
  }
  return { open: false, remainingMs: 0, lastInboundAt: ts, reason: "outside_24h" };
}

export function approvedTemplate(name) {
  const key = String(name || "window_reopen")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return CRM_TEMPLATES[key] || CRM_TEMPLATES.window_reopen;
}

export function resolveOutboundBody({ windowOpen, message, templateName } = {}) {
  const custom = String(message || "").trim();
  if (windowOpen && custom) return { body: custom, mode: "freeform" };
  const body = approvedTemplate(templateName);
  return { body, mode: "template", templateName: templateName || "window_reopen" };
}

function contactKey(customerKey) {
  return String(customerKey || "").trim();
}

function mirrorSession(key, patch) {
  try {
    setCustomerMeta(key, patch);
  } catch {
    /* fail-soft */
  }
}

export function upsertCrmContact(customerKey, patch = {}, now = Date.now()) {
  const key = contactKey(customerKey);
  if (!key) return null;
  load();
  const prev = store.contacts[key] || {};
  const nextTag = normalizeCrmTag(patch.tag)
    ? nextCrmTag(prev.tag, patch.tag)
    : prev.tag || "new_lead";
  const row = {
    customerKey: key,
    chatId: patch.chatId || prev.chatId || key,
    displayName: patch.displayName || prev.displayName || "",
    phone: patch.phone || prev.phone || "",
    tag: nextTag,
    lastIntent: patch.lastIntent || prev.lastIntent || "",
    lastInboundAt: patch.lastInboundAt != null ? patch.lastInboundAt : prev.lastInboundAt || 0,
    lastOutboundAt: patch.lastOutboundAt != null ? patch.lastOutboundAt : prev.lastOutboundAt || 0,
    assignedAt: patch.assignedAt != null ? patch.assignedAt : prev.assignedAt || 0,
    ticketId: patch.ticketId || prev.ticketId || "",
    updatedAt: now,
  };
  store.contacts[key] = row;
  persist();
  mirrorSession(key, {
    crmTag: row.tag,
    lastInboundAt: row.lastInboundAt,
    lastIntent: row.lastIntent,
    crmTicketId: row.ticketId || undefined,
  });
  return { ...row };
}

export function getCrmContact(customerKey) {
  const key = contactKey(customerKey);
  if (!key) return null;
  load();
  const row = store.contacts[key];
  return row ? { ...row } : null;
}

export function recordInbound({
  customerKey,
  text = "",
  displayName = "",
  phone = "",
  chatId = "",
  now = Date.now(),
} = {}) {
  const key = contactKey(customerKey);
  if (!key) {
    return { contact: null, intent: classifyLeadIntent(text) };
  }
  const intent = classifyLeadIntent(text);
  load();
  const prev = store.contacts[key] || {};
  const tag = nextCrmTag(prev.tag || (intent.intent === "greeting" ? "" : "new_lead"), intent.tag);
  const contact = upsertCrmContact(
    key,
    {
      chatId: chatId || key,
      displayName,
      phone,
      tag,
      lastIntent: intent.intent,
      lastInboundAt: now,
    },
    now
  );
  return { contact, intent };
}

export function setCrmTag(customerKey, tag, now = Date.now()) {
  const next = normalizeCrmTag(tag);
  if (!next) return { ok: false, error: "invalid_tag", message: `Use one of: ${CRM_TAGS.join(", ")}` };
  const key = contactKey(customerKey);
  if (!key) return { ok: false, error: "missing_customer" };
  const contact = upsertCrmContact(key, { tag: next }, now);
  return { ok: true, contact };
}

export function listCrmContacts({
  tag = "",
  window = "any",
  q = "",
  sinceDays = 0,
  now = Date.now(),
  limit = 100,
} = {}) {
  load();
  const wantTag = normalizeCrmTag(tag);
  const query = String(q || "").trim().toLowerCase();
  const sinceMs = Number(sinceDays) > 0 ? now - Number(sinceDays) * 24 * 60 * 60 * 1000 : 0;
  const win = String(window || "any").toLowerCase();

  const rows = Object.values(store.contacts)
    .filter((c) => (wantTag ? c.tag === wantTag : true))
    .filter((c) => (sinceMs ? Number(c.lastInboundAt || 0) >= sinceMs : true))
    .filter((c) => {
      if (!query) return true;
      const hay = `${c.displayName || ""} ${c.phone || ""} ${c.customerKey || ""} ${c.tag || ""}`.toLowerCase();
      return hay.includes(query);
    })
    .map((c) => {
      const serviceWindow = customerServiceWindow(c.lastInboundAt, now);
      return { ...c, serviceWindow };
    })
    .filter((c) => {
      if (win === "inside" || win === "open") return c.serviceWindow.open;
      if (win === "outside" || win === "closed_window") return !c.serviceWindow.open;
      return true;
    })
    .sort((a, b) => Number(b.lastInboundAt || 0) - Number(a.lastInboundAt || 0))
    .slice(0, Math.min(500, Math.max(1, Number(limit) || 100)));

  return rows;
}

function isOptedOut(customerKey) {
  try {
    return Boolean(getCustomerMeta(customerKey)?.broadcastOptOut);
  } catch {
    return false;
  }
}

/**
 * Flag a chat for a human. Opens a SUP- ticket via startHumanHandoff and
 * tags the CRM row support/complaint. Idempotent while handoff is already on.
 */
export async function assignAgent(
  {
    customerKey,
    chatId = "",
    displayName = "",
    phone = "",
    lastMessage = "",
    reason = "support",
    priority = "",
  } = {},
  extras = {}
) {
  const key = contactKey(customerKey);
  if (!key) return { ok: false, error: "missing_customer" };

  const intent = classifyLeadIntent(lastMessage || reason);
  const tag = intent.intent === "complaint" || reason === "complaint" ? "complaint" : "support";
  const pri = priority || (tag === "complaint" ? "high" : "normal");

  const existing = getHumanHandoff(key);
  if (existing) {
    const contact = upsertCrmContact(key, {
      tag,
      chatId: chatId || key,
      displayName,
      phone,
      ticketId: existing.supportTicketId || existing.ticketId || "",
      assignedAt: existing.startedAt || Date.now(),
      lastIntent: intent.intent || tag,
    });
    return {
      ok: true,
      alreadyAssigned: true,
      assigned: false,
      ticketId: contact.ticketId || existing.supportTicketId || "",
      contact,
    };
  }

  const start =
    extras.startHandoff ||
    (async (args) => {
      const { startHumanHandoff } = await import("./handoff.js");
      return startHumanHandoff(key, args);
    });

  const opened = await start({
    chatId: chatId || key,
    displayName,
    phone,
    lastMessage,
    priority: pri,
    escalationReason: String(reason || intent.intent || "assign_agent").slice(0, 120),
  });

  const ticketId = opened?.ticket?.id || "";
  const contact = upsertCrmContact(key, {
    tag,
    chatId: chatId || key,
    displayName,
    phone,
    ticketId,
    assignedAt: Date.now(),
    lastIntent: intent.intent || tag,
  });

  if (!extras.silentAck) {
    try {
      const send = extras.sender || (await import("./whatsapp.js")).sendText;
      const { humanHandoffAck } = await import("./trust-copy.js");
      const { isAfterHumanHours } = await import("./customer-automations.js");
      await send(key, humanHandoffAck(isAfterHumanHours()));
    } catch (err) {
      console.warn("[whatsapp-crm] assign ack skipped:", err.message);
    }
  }

  return {
    ok: true,
    alreadyAssigned: false,
    assigned: true,
    ticketId,
    contact,
  };
}

/**
 * Broadcast to CRM-tagged contacts. Free-form inside the 24h window;
 * approved templates after it expires.
 */
export async function runTaggedBroadcast(
  { tag, message = "", templateName = "follow_up", sinceDays = 7, dryRun = false } = {},
  extras = {}
) {
  const want = normalizeCrmTag(tag);
  if (!want) {
    return { ok: false, error: "invalid_tag", message: `Use one of: ${CRM_TAGS.join(", ")}` };
  }
  const now = extras.now || Date.now();
  const recipients = listCrmContacts({ tag: want, sinceDays, now, limit: 2000 }).filter(
    (c) => !isOptedOut(c.customerKey)
  );

  const planned = recipients.map((c) => {
    const resolved = resolveOutboundBody({
      windowOpen: c.serviceWindow.open,
      message,
      templateName,
    });
    return {
      customerKey: c.customerKey,
      chatId: c.chatId || c.customerKey,
      tag: c.tag,
      windowOpen: c.serviceWindow.open,
      mode: resolved.mode,
      body: resolved.body,
    };
  });

  if (dryRun || extras.dryRun) {
    return {
      ok: true,
      dryRun: true,
      tag: want,
      total: planned.length,
      freeform: planned.filter((p) => p.mode === "freeform").length,
      templated: planned.filter((p) => p.mode === "template").length,
      preview: planned.slice(0, 8),
      message: `Dry run — ${planned.length} ${want} contact(s); free-form inside 24h, template after.`,
    };
  }

  const send = extras.sender || (await import("./whatsapp.js")).sendText;
  let sent = 0;
  let failed = 0;
  const results = [];
  for (const job of planned) {
    try {
      await send(job.chatId, job.body);
      upsertCrmContact(job.customerKey, { lastOutboundAt: now });
      sent += 1;
      results.push({ ...job, ok: true });
    } catch (err) {
      failed += 1;
      results.push({ ...job, ok: false, error: err.message });
      console.warn("[whatsapp-crm] broadcast failed", job.chatId, err.message);
    }
  }

  return {
    ok: true,
    dryRun: false,
    tag: want,
    total: planned.length,
    sent,
    failed,
    freeform: planned.filter((p) => p.mode === "freeform").length,
    templated: planned.filter((p) => p.mode === "template").length,
    results: results.slice(0, 50),
    message: `Broadcast to *${want}*: sent *${sent}* / ${planned.length} (template after 24h).`,
  };
}
