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
import { normalizeKenyaPhone } from "../lib/phone-normalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DEFAULT_STORE = path.join(DATA_DIR, "crm-contacts.json");

export const CRM_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CRM_VIP_KES = 15_000;

/** Ranked buyer funnel — kept for broadcasts and existing desk filters. */
export const CRM_LEGACY_TAGS = Object.freeze([
  "new_lead",
  "interested",
  "qualified",
  "ordering",
  "support",
  "complaint",
  "closed",
]);

/** P2P thrift / escrow / dispatch taxonomy (hyphenated). */
export const CRM_TAXONOMY_TAGS = Object.freeze([
  "new-lead",
  "hot-lead",
  "cart-abandoned",
  "active-buyer",
  "repeat-buyer",
  "vip-buyer",
  "seller-prospect",
  "active-seller",
  "top-seller",
  "delayed-dispatch",
  "inspection-pending",
  "dispute-open",
  "rider-partner",
  "payout-pending",
  "complaint",
  "follow-up",
  "restock-subscriber",
  "opt-out",
]);

export const CRM_TAG_GROUPS = Object.freeze({
  buyer: ["new-lead", "hot-lead", "cart-abandoned", "active-buyer", "repeat-buyer", "vip-buyer"],
  seller: ["seller-prospect", "active-seller", "top-seller", "delayed-dispatch"],
  ops: ["inspection-pending", "dispute-open", "rider-partner", "payout-pending"],
  support: ["complaint", "follow-up", "restock-subscriber", "opt-out"],
});

export const CRM_TAGS = Object.freeze([...CRM_LEGACY_TAGS, ...CRM_TAXONOMY_TAGS]);

const TAXONOMY_ALIASES = Object.freeze({
  new: "new-lead",
  lead: "new-lead",
  "new-lead": "new-lead",
  new_lead: "new-lead",
  hot: "hot-lead",
  warm: "hot-lead",
  interested: "hot-lead",
  "hot-lead": "hot-lead",
  qualified: "hot-lead",
  ordering: "hot-lead",
  "cart-abandoned": "cart-abandoned",
  "active-buyer": "active-buyer",
  "repeat-buyer": "repeat-buyer",
  "vip-buyer": "vip-buyer",
  "seller-prospect": "seller-prospect",
  "active-seller": "active-seller",
  "top-seller": "top-seller",
  "delayed-dispatch": "delayed-dispatch",
  "inspection-pending": "inspection-pending",
  "dispute-open": "dispute-open",
  "rider-partner": "rider-partner",
  "payout-pending": "payout-pending",
  support: "follow-up",
  "follow-up": "follow-up",
  complaint: "complaint",
  "restock-subscriber": "restock-subscriber",
  waitlist: "restock-subscriber",
  closed: "opt-out",
  "opt-out": "opt-out",
  optout: "opt-out",
  unsubscribe: "opt-out",
});

const TAXONOMY_TO_LEGACY = Object.freeze({
  "new-lead": "new_lead",
  "hot-lead": "interested",
  "cart-abandoned": "ordering",
  complaint: "complaint",
  "follow-up": "support",
  "opt-out": "closed",
});

const LEGACY_TO_TAXONOMY = Object.freeze({
  new_lead: "new-lead",
  interested: "hot-lead",
  qualified: "hot-lead",
  ordering: "hot-lead",
  support: "follow-up",
  complaint: "complaint",
  closed: "opt-out",
});

const DERIVED_TAGS = new Set([
  "active-buyer",
  "repeat-buyer",
  "vip-buyer",
  "cart-abandoned",
  "inspection-pending",
  "dispute-open",
  "payout-pending",
  "restock-subscriber",
  "active-seller",
  "rider-partner",
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

function slugTag(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function normalizeTaxonomyTag(raw) {
  const slug = slugTag(raw);
  if (!slug) return "";
  if (TAXONOMY_ALIASES[slug]) return TAXONOMY_ALIASES[slug];
  if (TAXONOMY_ALIASES[slug.replace(/-/g, "_")]) return TAXONOMY_ALIASES[slug.replace(/-/g, "_")];
  if (CRM_TAXONOMY_TAGS.includes(slug)) return slug;
  return "";
}

export function normalizeCrmTag(raw) {
  const tag = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (tag === "new" || tag === "lead") return "new_lead";
  if (tag === "hot" || tag === "warm") return "interested";
  if (CRM_LEGACY_TAGS.includes(tag)) return tag;
  const tax = normalizeTaxonomyTag(raw);
  if (tax && TAXONOMY_TO_LEGACY[tax]) return TAXONOMY_TO_LEGACY[tax];
  return "";
}

function uniqueTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const tag = normalizeTaxonomyTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function chatIdFromPhone(phone) {
  const digits = normalizeKenyaPhone(phone);
  return digits ? `${digits}@c.us` : "";
}

function findCrmKeyByPhone(phone) {
  const digits = normalizeKenyaPhone(phone);
  const fallback = chatIdFromPhone(phone);
  if (!digits && !fallback) return "";
  load();
  for (const [key, row] of Object.entries(store.contacts)) {
    const rowPhone = normalizeKenyaPhone(row.phone || row.customerKey || key);
    if (digits && rowPhone === digits) return key;
    if (fallback && key === fallback) return key;
  }
  return fallback;
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
  const removed = new Set(uniqueTags(patch.tagsToRemove || patch.tags_to_remove));
  const tags = uniqueTags([
    ...(Array.isArray(prev.tags) ? prev.tags : []),
    ...(Array.isArray(patch.tags) ? patch.tags : []),
    ...(patch.tagsToAdd || patch.tags_to_add || []),
    LEGACY_TO_TAXONOMY[nextTag],
  ]).filter((tag) => !removed.has(tag));
  const row = {
    customerKey: key,
    chatId: patch.chatId || prev.chatId || key,
    displayName: patch.displayName || prev.displayName || "",
    phone: patch.phone || prev.phone || "",
    tag: nextTag,
    tags,
    lastIntent: patch.lastIntent || prev.lastIntent || "",
    lastInboundAt: patch.lastInboundAt != null ? patch.lastInboundAt : prev.lastInboundAt || 0,
    lastOutboundAt: patch.lastOutboundAt != null ? patch.lastOutboundAt : prev.lastOutboundAt || 0,
    assignedAt: patch.assignedAt != null ? patch.assignedAt : prev.assignedAt || 0,
    ticketId: patch.ticketId || prev.ticketId || "",
    updatedAt: now,
  };
  store.contacts[key] = row;
  persist();
  if (tags.includes("opt-out") || removed.has("opt-out")) {
    try {
      setCustomerMeta(key, { broadcastOptOut: tags.includes("opt-out") });
    } catch {
      /* fail-soft */
    }
  }
  mirrorSession(key, {
    crmTag: row.tag,
    crmTags: row.tags,
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
  const tax = normalizeTaxonomyTag(tag);
  const next = normalizeCrmTag(tag);
  if (!tax && !next) return { ok: false, error: "invalid_tag", message: `Use one of: ${CRM_TAXONOMY_TAGS.join(", ")}` };
  const key = contactKey(customerKey);
  if (!key) return { ok: false, error: "missing_customer" };
  const contact = upsertCrmContact(
    key,
    {
      ...(next ? { tag: next } : {}),
      ...(tax ? { tagsToAdd: [tax] } : {}),
    },
    now
  );
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

  const wantTax = normalizeTaxonomyTag(tag);
  const rows = Object.values(store.contacts)
    .filter((c) => {
      if (!wantTag && !wantTax) return true;
      if (wantTag && c.tag === wantTag) return true;
      const tags = Array.isArray(c.tags) ? c.tags : [];
      if (wantTax && tags.includes(wantTax)) return true;
      if (wantTag && tags.includes(LEGACY_TO_TAXONOMY[wantTag])) return true;
      return false;
    })
    .filter((c) => (sinceMs ? Number(c.lastInboundAt || 0) >= sinceMs : true))
    .filter((c) => {
      if (!query) return true;
      const hay = `${c.displayName || ""} ${c.phone || ""} ${c.customerKey || ""} ${c.tag || ""} ${(c.tags || []).join(" ")}`.toLowerCase();
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

function deriveTagsFromOrders(orders = [], now = Date.now()) {
  const tags = [];
  const live = orders.filter((o) => o && o.kind !== "cart_child");
  const paid = live.filter((o) => o.paidAt || o.customerPaymentStatus === "confirmed");
  const delivered = live.filter((o) => String(o.status || "") === "delivered");
  const active = paid.filter((o) => !["delivered", "cancelled", "refunded"].includes(String(o.status || "")));
  if (active.length) tags.push("active-buyer");
  if (delivered.length >= 2) tags.push("repeat-buyer");
  const spent = delivered.reduce((sum, o) => sum + (Number(o.totalKes ?? o.buyerTotalKes ?? o.priceKes) || 0), 0);
  if (spent > CRM_VIP_KES) tags.push("vip-buyer");
  const abandoned = live.filter((o) => {
    if (o.paidAt || o.customerPaymentStatus === "confirmed") return false;
    if (String(o.status || "") === "cancelled") return false;
    return Boolean(o.stkRequestedAt || o.stkPushAt || o.kind === "cart" || o.status === "pending");
  });
  if (abandoned.length) tags.push("cart-abandoned");
  if (
    live.some((o) => {
      const ends = Number(o.inspectionEndsAt);
      return Number.isFinite(ends) && ends > now;
    })
  ) {
    tags.push("inspection-pending");
  }
  if (live.some((o) => o.disputeHold || String(o.payoutStatus || "") === "held_for_dispute")) {
    tags.push("dispute-open");
  }
  if (
    paid.some((o) => {
      const escrow = String(o.escrowStatus || "").toLowerCase();
      if (escrow === "released" || escrow === "refunded") return false;
      if (o.disputeHold) return false;
      return Boolean(o.sellerDispatchedAt || o.status === "delivered" || escrow === "held");
    })
  ) {
    tags.push("payout-pending");
  }
  return tags;
}

export async function deriveLifecycleTags({ phone = "", customerKey = "" } = {}, now = Date.now()) {
  const tags = [];
  const digits = normalizeKenyaPhone(phone || customerKey);
  try {
    const { getOrdersForCustomer } = await import("./orders.js");
    const orders = getOrdersForCustomer(customerKey || chatIdFromPhone(digits), digits);
    tags.push(...deriveTagsFromOrders(orders, now));
  } catch (err) {
    console.warn("[whatsapp-crm] lifecycle orders skipped:", err.message);
  }
  try {
    const { hasOpenWaitlistForPhone } = await import("./product-waitlist.js");
    if (digits && (await hasOpenWaitlistForPhone(digits))) tags.push("restock-subscriber");
  } catch {
    /* optional */
  }
  return uniqueTags(tags);
}

export async function tagCrmContact(
  { phone_number, phone, tags_to_add, tags_to_remove, sync = true } = {},
  extras = {}
) {
  const rawPhone = phone_number || phone;
  const digits = normalizeKenyaPhone(rawPhone);
  if (!digits) {
    return { ok: false, error: "invalid_phone", tool: "tag_crm_contact", message: "Need a Kenya phone (254…)." };
  }
  const add = uniqueTags(tags_to_add);
  const remove = uniqueTags(tags_to_remove);
  const unknown = [...(tags_to_add || []), ...(tags_to_remove || [])].filter(
    (raw) => raw && !normalizeTaxonomyTag(raw) && !normalizeCrmTag(raw)
  );
  if (!add.length && !remove.length && !sync) {
    return {
      ok: false,
      error: "invalid_tag",
      tool: "tag_crm_contact",
      message: `Unknown or empty tags. Use: ${CRM_TAXONOMY_TAGS.join(", ")}`,
      unknown,
    };
  }
  if (unknown.length && !add.length && !remove.length) {
    return {
      ok: false,
      error: "invalid_tag",
      tool: "tag_crm_contact",
      message: `Unknown tags: ${unknown.join(", ")}. Use: ${CRM_TAXONOMY_TAGS.join(", ")}`,
      unknown,
    };
  }

  const key = findCrmKeyByPhone(digits);
  const primary = add.map((t) => TAXONOMY_TO_LEGACY[t]).find(Boolean);
  let contact = upsertCrmContact(
    key,
    {
      phone: digits,
      chatId: key,
      ...(primary ? { tag: primary } : {}),
      tagsToAdd: add,
      tagsToRemove: remove,
    },
    extras.now || Date.now()
  );

  let derived = [];
  if (sync !== false) {
    derived = await deriveLifecycleTags({ phone: digits, customerKey: key }, extras.now || Date.now());
    const staleDerived = (contact.tags || []).filter((t) => DERIVED_TAGS.has(t) && !derived.includes(t) && !add.includes(t));
    contact = upsertCrmContact(
      key,
      {
        phone: digits,
        tagsToAdd: derived.filter((t) => !remove.includes(t)),
        tagsToRemove: staleDerived.filter((t) => !add.includes(t)),
      },
      extras.now || Date.now()
    );
  }

  return {
    ok: true,
    tool: "tag_crm_contact",
    phone: digits,
    added: add,
    removed: remove,
    derived,
    unknown,
    tag: contact.tag,
    tags: contact.tags,
    contact: {
      name: contact.displayName || null,
      phone: contact.phone || digits,
      tag: contact.tag,
      tags: contact.tags,
    },
  };
}
