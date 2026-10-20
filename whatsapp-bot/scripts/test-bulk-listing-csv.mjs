import assert from "node:assert/strict";
import {
  buildBulkCsvTemplate,
  csvTextToDraftRows,
  bulkCsvUiHelp,
  BULK_CSV_HEADERS,
} from "../src/services/bulk-listing-csv.js";

const template = buildBulkCsvTemplate();
assert.ok(template.includes("subcategory"));
assert.ok(template.includes("vibe_tags"));
assert.ok(template.includes("pit_to_pit_in"));
assert.ok(!template.includes("# price_kes"));
assert.ok(!template.includes("# condition:"));
assert.ok(!/#\s/.test(template.split("\n").slice(1).join("\n")));

const parsed = csvTextToDraftRows(template);
assert.equal(parsed.rows.length, 3);
assert.equal(parsed.errors.length, 0);
assert.equal(parsed.rows[0].draft.name, "Vintage Nike Windbreaker");
assert.equal(parsed.rows[0].draft.sellerNetKes, 2500);
assert.equal(parsed.rows[0].draft.category, "fashion");
assert.equal(parsed.rows[0].draft.browseCategory, "men");
assert.equal(parsed.rows[0].draft.browseSubCategory, "outerwear");
assert.ok(parsed.rows[0].draft.tags.includes("vintage"));
assert.equal(parsed.rows[0].draft.pitToPitIn, 22);
assert.equal(parsed.rows[1].draft.browseCategory, "women");
assert.equal(parsed.rows[1].draft.browseSubCategory, "jeans");
assert.equal(parsed.rows[2].draft.shippingKes, 300);
assert.equal(parsed.rows[2].draft.browseSubCategory, "sneakers");

const legacy = csvTextToDraftRows(`title,price_kes,category,size,condition,description,color,brand,shipping_kes,tags
Vintage Tee,1200,fashion,M,gently_used,Soft cotton,black,Nike,200,"vintage,streetwear"
# price_kes = instruction junk
Bad Row,,,
`);
assert.equal(legacy.rows.length, 1);
assert.equal(legacy.rows[0].draft.category, "fashion");
assert.ok(legacy.errors.length >= 1);

const menCsv = csvTextToDraftRows(`title,price_kes,category,subcategory,size,condition,color,brand,shipping_kes,vibe_tags,description
"Cool Hoodie",3000,Men,Hoodies,L,like_new,Black,Nike,250,"streetwear","Warm fleece"
`);
assert.equal(menCsv.rows[0].draft.browseCategory, "men");
assert.equal(menCsv.rows[0].draft.category, "fashion");
assert.equal(menCsv.rows[0].draft.browseSubCategory, "hoodies");

const help = bulkCsvUiHelp();
assert.equal(help.maxRows, 50);
assert.deepEqual(help.headers, BULK_CSV_HEADERS);
assert.ok(help.tips.length >= 5);

console.log("bulk-listing-csv tests passed");
