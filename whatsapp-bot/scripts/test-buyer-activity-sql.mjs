#!/usr/bin/env node
/**
 * Guards the buyer activity UNION against enum/text mismatches.
 * Fails if offer_status is selected without ::text (PG rejects UNION with offer_status enum).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const socialPath = path.join(__dirname, "../src/db/repositories/social.js");
const src = readFileSync(socialPath, "utf8");

const fnStart = src.indexOf("export async function listBuyerSocialActivity");
if (fnStart < 0) {
  console.error("FAIL: listBuyerSocialActivity not found");
  process.exit(1);
}
const slice = src.slice(fnStart, fnStart + 4500);

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

assert("casts offer status to text", /o\.status\s*::\s*text\s+AS\s+offer_status/.test(slice));
assert(
  "does not select bare enum status in UNION",
  !/o\.status\s+AS\s+offer_status/.test(slice.replace(/o\.status\s*::\s*text\s+AS\s+offer_status/g, ""))
);
assert("includes follow + like branches", /'follow'::text/.test(slice) && /'like'::text/.test(slice));

console.log(`\n${failed ? failed + " failed" : "All buyer activity SQL guards passed"}`);
process.exit(failed ? 1 : 0);
