/**
 * Smoke test: photo uploads must ADD separate rows, not merge by similar names.
 * Run: node whatsapp-bot/scripts/test-catalog-upsert.mjs
 */
import { createHash } from "node:crypto";

const UPSERT_MATCH = { ALWAYS_ADD: "always-add", REF: "ref", ID: "id" };

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function imageContentHash(buffer) {
  if (!buffer?.length) return null;
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

function simulateAlwaysAdd(products, { name, uploadMessageId, imageBuffer }) {
  const imgHash = imageContentHash(imageBuffer);
  let existing = null;
  if (uploadMessageId) existing = products.find((p) => p.uploadMessageId === uploadMessageId) || null;
  if (!existing && imgHash) existing = products.find((p) => p.imageHash === imgHash) || null;

  if (existing) return { products, action: "updated", id: existing.id };

  const id = `fa-${String(products.length + 1).padStart(3, "0")}`;
  let displayName = name;
  const base = normalizeName(name);
  const siblings = products.filter((p) => normalizeName(p.name) === base);
  if (siblings.length) displayName = `${name} (${siblings.length + 1})`;

  products.push({
    id,
    name: displayName,
    uploadMessageId: uploadMessageId || undefined,
    imageHash: imgHash || undefined,
  });
  return { products, action: "added", id };
}

const products = [];
const r1 = simulateAlwaysAdd(products, {
  name: "Women Sandals",
  uploadMessageId: "msg_001",
  imageBuffer: Buffer.from("photo-a"),
});
const r2 = simulateAlwaysAdd(products, {
  name: "Women Sandals",
  uploadMessageId: "msg_002",
  imageBuffer: Buffer.from("photo-b"),
});
const r3 = simulateAlwaysAdd(products, {
  name: "Women Sandals",
  uploadMessageId: "msg_001",
  imageBuffer: Buffer.from("photo-a"),
});

const ok =
  r1.action === "added" &&
  r2.action === "added" &&
  r3.action === "updated" &&
  products.length === 2 &&
  r1.id !== r2.id;

if (!ok) {
  console.error("FAIL", { r1, r2, r3, count: products.length });
  process.exit(1);
}
console.log("OK: each photo message adds a row; retry updates same message only.");
console.log("  ", r1.id, r2.id, products.map((p) => p.name).join(" | "));
