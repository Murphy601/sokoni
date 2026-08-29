#!/usr/bin/env node
/**
 * WAHA health ping (no sendText). Diagnoses hung API without needing a phone.
 *
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/test-waha-ping.mjs
 */
import axios from "axios";
import { config } from "../src/config.js";

const base = String(config.waha.apiUrl || "").replace(/\/$/, "");
const session = config.waha.session || "default";

if (!base) {
  console.error("FAIL: WAHA_API_URL unset");
  process.exit(1);
}

const headers = {};
if (config.waha.apiKey) headers["X-Api-Key"] = config.waha.apiKey;

console.log("WAHA_API_URL:", base);
console.log("WAHA session:", session);

try {
  const started = Date.now();
  const { data, status } = await axios.get(`${base}/api/sessions/${encodeURIComponent(session)}`, {
    headers,
    timeout: 8000,
  });
  const ms = Date.now() - started;
  const st = data?.status || data?.engine?.status || "(unknown)";
  console.log(`OK: session HTTP ${status} in ${ms}ms — status=${st}`);
  console.log(JSON.stringify({ status: st, name: data?.name, engine: data?.engine?.engine }, null, 2));
  if (String(st).toUpperCase() !== "WORKING") {
    console.error("WARN: session is not WORKING — sendText will fail until linked/recovered");
    process.exit(2);
  }
  process.exit(0);
} catch (err) {
  console.error("FAIL: WAHA session ping timed out or errored:", err.message);
  console.error("WAHA is likely wedged. Soft-restart (keeps session, usually no QR):");
  console.error("  docker ps --format '{{.ID}} {{.Names}}' | grep -i waha");
  console.error("  docker restart <waha-container-id>");
  process.exit(1);
}
