#!/usr/bin/env node
/**
 * Commit and push catalog changes (products.json, site catalog, product images).
 * Used by WhatsApp admin catalog intake when CATALOG_AUTO_PUSH=true.
 *
 * Manual: node scripts/commit-catalog.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function main() {
  const status = run("git", ["status", "--porcelain",
    "whatsapp-bot/src/data/products.json",
    "website/data/products.json",
    "website/assets/images/products/",
  ]);

  if (!status) {
    console.log("No catalog changes to commit.");
    return;
  }

  run("git", ["add",
    "whatsapp-bot/src/data/products.json",
    "website/data/products.json",
    "website/assets/images/products/",
  ]);

  const msg = `catalog: update products via WhatsApp admin (${new Date().toISOString().slice(0, 10)})`;
  run("git", ["commit", "-m", msg]);
  run("git", ["push", "origin", "HEAD"]);
  console.log("Catalog committed and pushed.");
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
