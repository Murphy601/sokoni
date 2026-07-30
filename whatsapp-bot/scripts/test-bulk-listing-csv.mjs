#!/usr/bin/env node
/**
 * Unit checks for bulk CSV → draft rows (no DB).
 * Run: node scripts/test-bulk-listing-csv.mjs
 */
import {
  parseCsv,
  csvTextToDraftRows,
  buildBulkCsvTemplate,
  BULK_CSV_MAX_ROWS,
} from "../src/services/bulk-listing-csv.js";

let failed = 0;
function assert(label, cond) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

const table = parseCsv('title,price_kes\n"Nike, vintage",2500\n');
assert("parses quoted comma", table[1]?.[0] === "Nike, vintage");
assert("parses price", table[1]?.[1] === "2500");

const tpl = buildBulkCsvTemplate();
const fromTpl = csvTextToDraftRows(tpl);
assert("template yields sample drafts", fromTpl.rows.length >= 3);
assert("first sample has Nike title", /Nike/i.test(fromTpl.rows[0]?.draft?.name || ""));
assert("seller-net price mapped", fromTpl.rows[0]?.draft?.sellerNetKes === 2500);
assert("condition mapped", fromTpl.rows[0]?.draft?.condition === "gently_used");

const bad = csvTextToDraftRows("foo,bar\n1,2\n");
assert("rejects missing title/price headers", bad.rows.length === 0);

const many = ["title,price_kes", ...Array.from({ length: BULK_CSV_MAX_ROWS + 5 }, (_, i) => `Item ${i},100`)].join(
  "\n"
);
const capped = csvTextToDraftRows(many);
assert(`caps at ${BULK_CSV_MAX_ROWS}`, capped.rows.length === BULK_CSV_MAX_ROWS);
assert("reports too many rows", capped.errors.some((e) => /Too many rows/i.test(e.message)));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
