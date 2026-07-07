/**
 * Minimal in-memory session store keyed by WhatsApp phone number.
 * Good enough for local dev / a single-process demo. For production, swap
 * this for Redis (or any small KV store) so sessions survive restarts and
 * work across multiple server instances.
 */
const sessions = new Map();
const MAX_HISTORY = 20;

export function getSession(phoneNumber) {
  if (!sessions.has(phoneNumber)) {
    sessions.set(phoneNumber, {
      history: [],
      lastProductContext: null,
      pendingOrder: null,
      menuState: null,
      humanHandoff: null,
      customerMeta: null,
      pendingReview: null,
    });
  }
  return sessions.get(phoneNumber);
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
 * Pay-on-delivery order state. When a customer taps "Order (COD)" we stash the
 * chosen product and wait for their delivery details in the next message.
 */
export function setPendingOrder(phoneNumber, order) {
  getSession(phoneNumber).pendingOrder = order;
}

export function getPendingOrder(phoneNumber) {
  return getSession(phoneNumber).pendingOrder;
}

export function clearPendingOrder(phoneNumber) {
  getSession(phoneNumber).pendingOrder = null;
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
