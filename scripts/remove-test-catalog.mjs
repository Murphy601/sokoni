#!/usr/bin/env node
/**
 * Remove WhatsApp admin test catalog additions (desktop testing, July 2026).
 * Restores master catalog to pre-test baseline and rebuilds public site catalog.
 */
import { execSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASELINE_REF = process.env.CATALOG_BASELINE_REF || "a250ab1";
const MASTER = path.join(ROOT, "whatsapp-bot", "src", "data", "products.json");
const IMG_DIR = path.join(ROOT, "website", "assets", "images", "products");

function loadJsonFromGit(ref, file) {
  const raw = execSync(`git show ${ref}:${file}`, { cwd: ROOT, encoding: "utf-8" });
  return JSON.parse(raw);
}

async function main() {
  const baseline = loadJsonFromGit(BASELINE_REF, "whatsapp-bot/src/data/products.json");
  const current = JSON.parse(await readFile(MASTER, "utf-8"));
  const baselineIds = new Set(baseline.map((p) => p.id));
  const removed = current.filter((p) => !baselineIds.has(p.id));

  let deletedImages = 0;
  for (const p of removed) {
    const url = p.imageUrl || "";
    const base = path.basename(url);
    if (!base || base.includes("..")) continue;
    const file = path.join(IMG_DIR, base);
    try {
      await unlink(file);
      deletedImages++;
    } catch {
      /* image may already be gone */
    }
  }

  await writeFile(MASTER, JSON.stringify(baseline, null, 2) + "\n", "utf-8");

  execSync("node scripts/build-site-catalog.mjs", { cwd: ROOT, stdio: "inherit" });

  console.log(
    `Removed ${removed.length} test products (baseline ${BASELINE_REF}, was ${current.length}, now ${baseline.length}).`
  );
  console.log(`Deleted ${deletedImages} product images from website/assets/images/products/.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
