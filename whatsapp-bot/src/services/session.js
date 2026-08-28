/**
 * Session store keyed by WhatsApp customer key (phone or @lid).
 * Pending checkout state is also mirrored to disk so a bot restart
 * (or brief process recycle) does not restart the order flow mid-way.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sessions = new Map();
const MAX_HISTORY = 20;

/** Normalize WhatsApp sender → LangGraph-style thread_id (avoid importing commerce-ops). */
function threadIdFromPhoneLocal(phoneOrKey) {
  const raw = String(phoneOrKey || "").trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits || raw;
}

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const PENDING_FILE = path.join(DATA_DIR, "pending-checkouts.json");
const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

/** @type {Record<string, { pendingOrder?: object|null, pendingCart?: object|null, at?: number }>} */
let pendingDisk = {};
let pendingLoaded = false;

function loadPendingDisk() {
  if (pendingLoaded) return;
  pendingLoaded = true;
  try {
    if (!existsSync(PENDING_FILE)) return;
    const raw = JSON.parse(readFileSync(PENDING_FILE, "utf8"));
    pendingDisk = raw && typeof raw === "object" ? raw : {};
    const now = Date.now();
    for (const [k, v] of Object.entries(pendingDisk)) {
      if (!v?.at || now - v.at > PENDING_TTL_MS) delete pendingDisk[k];
    }
  } catch {
    pendingDisk = {};
  }
}

function writePendingDisk() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${PENDING_FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(pendingDisk, null, 2) + "\n", "utf8");
    renameSync(tmp, PENDING_FILE);
  } catch (err) {
    console.warn("[session] pending checkout persist failed:", err?.message || err);
  }
}

function persistPending(phoneNumber) {
  loadPendingDisk();
  const session = sessions.get(phoneNumber);
  const pendingOrder = session?.pendingOrder || null;
  const pendingCart = session?.pendingCart || null;
  if (!pendingOrder && !pendingCart) {
    if (pendingDisk[phoneNumber]) {
      delete pendingDisk[phoneNumber];
      writePendingDisk();
    }
    return;
  }
  pendingDisk[phoneNumber] = {
    pendingOrder,
    pendingCart,
    at: Date.now(),
  };
  writePendingDisk();
}

function hydratePending(phoneNumber, session) {
  loadPendingDisk();
  const saved = pendingDisk[phoneNumber];
  if (!saved) return;
  if (saved.at && Date.now() - saved.at > PENDING_TTL_MS) {
    delete pendingDisk[phoneNumber];
    writePendingDisk();
    return;
  }
  if (!session.pendingOrder && saved.pendingOrder) session.pendingOrder = saved.pendingOrder;
  if (!session.pendingCart && saved.pendingCart) session.pendingCart = saved.pendingCart;
}

export function getSession(phoneNumber) {
  if (!sessions.has(phoneNumber)) {
    const session = {
      history: [],
      lastProductContext: null,
      pendingOrder: null,
      /** Multi-seller cart draft awaiting delivery details */
      pendingCart: null,
      menuState: null,
      humanHandoff: null,
      customerMeta: null,
      pendingReview: null,
      /** Persistent LangGraph-style thread id = WhatsApp sender phone */
      threadId: threadIdFromPhoneLocal(phoneNumber),
    };
    sessions.set(phoneNumber, session);
    hydratePending(phoneNumber, session);
  }
  const session = sessions.get(phoneNumber);
  if (!session.threadId) session.threadId = threadIdFromPhoneLocal(phoneNumber);
  return session;
}

/** WhatsApp sender phone (or @lid) used as LangGraph-style thread_id. */
export function resolveThreadId(phoneOrKey) {
  return threadIdFromPhoneLocal(phoneOrKey) || String(phoneOrKey || "").trim();
}

export function pushMessage(phoneNumber, role, content) {
  const session = getSession(phoneNumber);
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY) {
    session.history.splice(0, session.history.length - MAX_HISTORY);
  }
}

export function setProductContext(phoneNumber, product) {
  getSession(phoneNumber).lastProductContext = product;
}

/**
 * Prepaid order state. When a customer taps "Order" we stash the
 * chosen product and wait for checkout steps in the next messages.
 */
export function setPendingOrder(phoneNumber, order) {
  getSession(phoneNumber).pendingOrder = order;
  persistPending(phoneNumber);
}

export function getPendingOrder(phoneNumber) {
  return getSession(phoneNumber).pendingOrder;
}

export function clearPendingOrder(phoneNumber) {
  getSession(phoneNumber).pendingOrder = null;
  persistPending(phoneNumber);
}

export function setPendingCart(phoneNumber, cart) {
  getSession(phoneNumber).pendingCart = cart;
  persistPending(phoneNumber);
}

export function getPendingCart(phoneNumber) {
  return getSession(phoneNumber).pendingCart;
}

export function clearPendingCart(phoneNumber) {
  getSession(phoneNumber).pendingCart = null;
  persistPending(phoneNumber);
}

/** Numbered menu context for WAHA (no interactive buttons). */
export function setMenuState(phoneNumber, state) {
  getSession(phoneNumber).menuState = state;
}

export function getMenuState(phoneNumber) {
  return getSession(phoneNumber).menuState;
}

export function clearMenuState(phoneNumber) {
  getSession(phoneNumber).menuState = null;
}

export function setCustomerMeta(phoneNumber, meta) {
  getSession(phoneNumber).customerMeta = { ...getSession(phoneNumber).customerMeta, ...meta };
}

export function getCustomerMeta(phoneNumber) {
  return getSession(phoneNumber).customerMeta;
}

export function setHumanHandoff(phoneNumber, state) {
  getSession(phoneNumber).humanHandoff = state;
}

export function getHumanHandoff(phoneNumber) {
  return getSession(phoneNumber).humanHandoff;
}

export function clearHumanHandoff(phoneNumber) {
  getSession(phoneNumber).humanHandoff = null;
}

export function isHumanHandoff(phoneNumber) {
  return !!getSession(phoneNumber).humanHandoff;
}

export function setPendingReview(phoneNumber, state) {
  getSession(phoneNumber).pendingReview = state;
}

export function getPendingReview(phoneNumber) {
  return getSession(phoneNumber).pendingReview;
}

export function clearPendingReview(phoneNumber) {
  getSession(phoneNumber).pendingReview = null;
}

/** Snapshot of disk-persisted pending checkouts for abandon recovery. */
export function listPendingDiskEntries() {
  loadPendingDisk();
  const now = Date.now();
  return Object.entries(pendingDisk)
    .filter(([, v]) => v?.at && now - v.at <= PENDING_TTL_MS)
    .map(([phone, v]) => ({
      phone,
      customerKey: phone,
      pendingOrder: v.pendingOrder || null,
      pendingCart: v.pendingCart || null,
      at: v.at,
      abandonNudgeSent: Boolean(v.abandonNudgeSent),
    }));
}

export function markPendingAbandonNudge(phoneNumber) {
  loadPendingDisk();
  const key = String(phoneNumber || "");
  if (!key || !pendingDisk[key]) return false;
  pendingDisk[key].abandonNudgeSent = true;
  writePendingDisk();
  return true;
}
