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

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "sokoni-bot",
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "bot@sokonimall.com",
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME || "sokoni-bot",
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL || "bot@sokonimall.com",
};

const CATALOG_PATHS = [
  "whatsapp-bot/src/data/products.json",
  "website/data/products.json",
  "website/assets/images/products/",
];

function run(cmd, args, { optional = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8", env: GIT_ENV });
  const out = `${r.stdout || ""}${r.stderr || ""}`.trim();
  if (r.status !== 0 && !optional) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${out}`);
  }
  if (out) console.log(out);
  return out;
}

function main() {
  const status = run("git", ["status", "--porcelain", ...CATALOG_PATHS], { optional: true });

  if (!status) {
    console.log("No catalog changes to commit.");
    return;
  }

  console.log("Catalog changes:\n" + status);

  run("git", ["add", ...CATALOG_PATHS]);
  run("git", ["commit", "-m", `catalog: update products via WhatsApp admin (${new Date().toISOString().slice(0, 10)})`]);

  // Rebase on latest main so push succeeds after code deploys.
  run("git", ["pull", "--rebase", "origin", "main"], { optional: true });
  run("git", ["push", "origin", "HEAD"]);
  console.log("Catalog committed and pushed to GitHub.");
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
