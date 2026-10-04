/**
 * Admin-only Socket.io namespace on the rider server.
 *
 * The handshake token is the same header the admin REST routes already check.
 * A token in the query string is ignored, so it cannot sit in an access log.
 * If socket.io never attached, emits do nothing and the WhatsApp path still works.
 */

import { isAdminTokenValid } from "../lib/admin-auth.js";
import { platformState } from "./platform-state.js";

const PULSE_MS = 45_000;

/** @type {import('socket.io').Namespace | null} */
let nsp = null;
let pulseTimer = null;

/** Header or socket auth packet. The URL query is not read. */
export function adminTokenFromHandshake(handshake) {
  const headers = handshake?.headers || {};
  const auth = handshake?.auth || {};
  return String(
    auth.token || headers["x-admin-token"] || headers["x-master-admin-secret"] || headers["x-sokoni-token"] || ""
  ).trim();
}

export function emitOpsEvent(eventName, payload = {}) {
  if (!nsp) return false;
  nsp.emit(eventName, { timestamp: Date.now(), ...payload });
  return true;
}

function publishPulse() {
  const metrics = platformState.getSnapshot();
  emitOpsEvent("PLATFORM_PULSE", {
    metrics,
    global: { heapUsedMB: metrics.heapUsedMb },
  });
}

export function attachOpsNamespace(io) {
  if (!io?.of || nsp) return;
  nsp = io.of("/ops");
  nsp.use((socket, next) => {
    if (!isAdminTokenValid(adminTokenFromHandshake(socket.handshake))) {
      next(new Error("forbidden"));
      return;
    }
    next();
  });
  if (!pulseTimer) {
    pulseTimer = setInterval(publishPulse, PULSE_MS);
    pulseTimer.unref?.();
  }
  console.log("[ops] namespace /ops attached");
}

export function stopOpsDesk() {
  if (pulseTimer) clearInterval(pulseTimer);
  pulseTimer = null;
  nsp = null;
}
