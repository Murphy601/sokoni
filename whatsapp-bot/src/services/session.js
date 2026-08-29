/**
 * Session store keyed by WhatsApp customer key (phone or @lid).
 * Pending checkout state is mirrored to disk; chat history / meta / handoff
 * also persist to Postgres chat_memory when DATABASE_URL is set (fail-soft).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sessions = new Map();
const MAX_HISTORY = 20;

/** Normalize WhatsApp sender → thread_id (phone digits or chat id). */
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

function scheduleDurablePersist(phoneNumber) {
  const session = sessions.get(phoneNumber);
  if (!session) return;
  void import("./chat-memory.js")
    .then(({ scheduleChatMemorySave }) => {
      scheduleChatMemorySave(
        phoneNumber,
        () => ({
          threadId: session.threadId,
          history: session.history,
          customerMeta: session.customerMeta,
          humanHandoff: session.humanHandoff,
          lastProductContext: session.lastProductContext,
        }),
        session.customerMeta?.phone || ""
      );
    })
    .catch(() => {});
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
      /** thread_id = WhatsApp sender phone / chat id */
      threadId: threadIdFromPhoneLocal(phoneNumber),
      _dbHydrated: false,
    };
    sessions.set(phoneNumber, session);
    hydratePending(phoneNumber, session);
  }
  const session = sessions.get(phoneNumber);
  if (!session.threadId) session.threadId = threadIdFromPhoneLocal(phoneNumber);
  return session;
}

/**
 * Load durable history/meta/handoff from Postgres into the in-memory session.
 * Call once near the start of each inbound WhatsApp message.
 */
export async function hydrateSessionFromDb(phoneNumber, phone = "") {
  const session = getSession(phoneNumber);
  if (session._dbHydrated) return session;
  try {
    const { loadChatMemory } = await import("./chat-memory.js");
    const mem = await loadChatMemory(phoneNumber, phone || session.customerMeta?.phone || "");
    if (mem) {
      if ((!session.history || !session.history.length) && mem.history?.length) {
        session.history = mem.history.slice(-MAX_HISTORY);
      }
      if (mem.customerMeta && Object.keys(mem.customerMeta).length) {
        session.customerMeta = { ...mem.customerMeta, ...(session.customerMeta || {}) };
      }
      if (!session.humanHandoff && mem.humanHandoff) {
        session.humanHandoff = mem.humanHandoff;
      }
      if (!session.lastProductContext && mem.lastProductContext) {
        session.lastProductContext = mem.lastProductContext;
      }
      if (mem.threadId) session.threadId = mem.threadId;
    }
  } catch {
    /* fail-soft */
  }
  session._dbHydrated = true;
  return session;
}

/** WhatsApp sender phone (or @lid) used as thread_id. */
export function resolveThreadId(phoneOrKey) {
  return threadIdFromPhoneLocal(phoneOrKey) || String(phoneOrKey || "").trim();
}

export function pushMessage(phoneNumber, role, content) {
  const session = getSession(phoneNumber);
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY) {
    session.history.splice(0, session.history.length - MAX_HISTORY);
  }
  scheduleDurablePersist(phoneNumber);
}

export function setProductContext(phoneNumber, product) {
  getSession(phoneNumber).lastProductContext = product;
  scheduleDurablePersist(phoneNumber);
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
  scheduleDurablePersist(phoneNumber);
}

export function getCustomerMeta(phoneNumber) {
  return getSession(phoneNumber).customerMeta;
}

export function setHumanHandoff(phoneNumber, state) {
  getSession(phoneNumber).humanHandoff = state;
  scheduleDurablePersist(phoneNumber);
}

export function getHumanHandoff(phoneNumber) {
  return getSession(phoneNumber).humanHandoff;
}

export function clearHumanHandoff(phoneNumber) {
  getSession(phoneNumber).humanHandoff = null;
  scheduleDurablePersist(phoneNumber);
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
