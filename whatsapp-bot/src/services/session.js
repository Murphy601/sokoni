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
