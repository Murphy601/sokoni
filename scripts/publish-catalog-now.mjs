#!/usr/bin/env node
/**
 * Rebuild public catalog + push to GitHub (run on VM after WhatsApp product uploads).
 *
 *   node scripts/publish-catalog-now.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function run(script) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", script)], {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

console.log("=== 1/2 Build website catalog ===\n");
run("build-site-catalog.mjs");
console.log("\n=== 2/2 Commit + push ===\n");
run("commit-catalog.mjs");
console.log("\nDone. Cloudflare deploys sokonimall.com in ~1–2 min.");
