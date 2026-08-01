#!/usr/bin/env node
/**
 * Fail if any category/subcategory Unsplash URL returns non-image (broken → boutique fallback).
 * Run: node scripts/verify-browse-images.mjs
 */
import { CATEGORY_IMAGES, SUBCATEGORY_IMAGES } from "./browse-category-images.mjs";

const urls = [
  ...Object.entries(CATEGORY_IMAGES).map(([k, v]) => [`cat:${k}`, v]),
  ...Object.entries(SUBCATEGORY_IMAGES).map(([k, v]) => [`sub:${k}`, v]),
];

const unique = [];
const seen = new Set();
for (const [key, url] of urls) {
  if (seen.has(url)) continue;
  seen.add(url);
  unique.push([key, url]);
}

async function checkOne([key, url]) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) {
      return { ok: false, key, detail: `${res.status} ${type}`, url };
    }
    return { ok: true, key };
  } catch (err) {
    return { ok: false, key, detail: err.message, url };
  } finally {
    clearTimeout(timer);
  }
}

const CONCURRENCY = 12;
let failed = 0;
for (let i = 0; i < unique.length; i += CONCURRENCY) {
  const batch = unique.slice(i, i + CONCURRENCY);
  const results = await Promise.all(batch.map(checkOne));
  for (const r of results) {
    if (r.ok) console.log(`ok ${r.key}`);
    else {
      console.error(`FAIL ${r.key} → ${r.detail} ${r.url}`);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`\n${failed} image URL(s) failed`);
  process.exit(1);
}
console.log(`\nall ok (${unique.length} unique URLs)`);
