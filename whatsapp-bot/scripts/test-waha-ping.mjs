#!/usr/bin/env node
/**
 * WAHA health ping (uses WAHA_API_KEY from whatsapp-bot/.env — no sendText).
 *
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/test-waha-ping.mjs
 */
import axios from "axios";
import { config } from "../src/config.js";

const base = String(config.waha.apiUrl || "").replace(/\/$/, "");
const session = config.waha.session || "default";

if (!base) {
  console.error("FAIL: WAHA_API_URL unset in .env");
  process.exit(1);
}

const headers = {};
if (config.waha.apiKey) headers["X-Api-Key"] = config.waha.apiKey;
else console.warn("WARN: WAHA_API_KEY unset — session call may return 401 Unauthorized");

console.log("WAHA_API_URL:", base);
console.log("WAHA session:", session);
console.log("API key:", config.waha.apiKey ? `set (${config.waha.apiKey.length} chars)` : "MISSING");

try {
  const started = Date.now();
  const { data, status } = await axios.get(`${base}/api/sessions/${encodeURIComponent(session)}`, {
    headers,
    timeout: 8000,
  });
  const ms = Date.now() - started;
  const st = data?.status || data?.engine?.status || "(unknown)";
  console.log(`OK: session HTTP ${status} in ${ms}ms — status=${st}`);
  console.log(
    JSON.stringify(
      {
        status: st,
        name: data?.name,
        engine: data?.engine?.engine || data?.engine,
        me: data?.me?.id || data?.me?.user || null,
      },
      null,
      2
    )
  );
  if (String(st).toUpperCase() !== "WORKING") {
    console.error("WARN: session is not WORKING — sendText will fail until linked/recovered");
    process.exit(2);
  }
  process.exit(0);
} catch (err) {
  const status = err.response?.status;
  const body = err.response?.data;
  console.error(
    "FAIL: WAHA session ping:",
    status ? `HTTP ${status}` : err.message,
    body ? JSON.stringify(body) : ""
  );
  if (status === 401) {
    console.error("→ Fix: WAHA_API_KEY in whatsapp-bot/.env must match the key WAHA was started with.");
  } else {
    console.error("→ Soft-restart WAHA (usually no QR):");
    console.error("   docker restart 93f51c97b10d");
    console.error("   # or: docker ps --format '{{.ID}} {{.Names}}' | grep -i waha");
  }
  process.exit(1);
}
