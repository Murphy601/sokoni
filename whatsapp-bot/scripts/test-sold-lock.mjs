/**
 * Sold items must never reappear as live stock.
 * Run: node whatsapp-bot/scripts/test-sold-lock.mjs
 */
import {
  isProductSold,
  isProductAvailable,
  preserveSoldState,
  markProductSoldFields,
  applySoldLocks,
  recordSoldSku,
  assertCanRestock,
  loadSoldRegistry,
  clearSoldRegistryCache,
  REGISTRY_PATH,
} from "../src/services/product-availability.js";
import { readFile, writeFile } from "node:fs/promises";

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

// Pure helpers
const live = { id: "a", inStock: true, name: "Phone" };
const sold = markProductSoldFields({ id: "b", inStock: true, name: "Sold phone" }, {
  orderId: "SKN-1",
  soldAt: 1000,
});
assert(isProductSold(sold), "sold product detected");
assert(!isProductAvailable(sold), "sold not available");
assert(isProductAvailable(live), "live available");
assert(!isProductSold(live), "live not sold");

const raced = preserveSoldState(sold, { ...sold, inStock: true, isSold: false, name: "Resurrected" });
assert(raced.isSold === true, "preserveSoldState keeps isSold");
assert(raced.inStock === false, "preserveSoldState keeps inStock false");
assert(raced.soldOrderId === "SKN-1", "preserveSoldState keeps order id");
assert(raced.name === "Resurrected", "preserveSoldState allows other field updates");

// Registry (temp write — restore after)
const backup = await readFile(REGISTRY_PATH, "utf-8");
try {
  clearSoldRegistryCache();
  await recordSoldSku("test-sku-sold-lock", { orderId: "SKN-TEST", soldAt: 42 });
  const reg = await loadSoldRegistry({ force: true });
  assert(Boolean(reg.skus["test-sku-sold-lock"]), "sku recorded in registry");

  const gate = await assertCanRestock("test-sku-sold-lock", { id: "test-sku-sold-lock", inStock: false });
  assert(gate.ok === false && gate.error === "product_sold", "restock blocked for tombstoned sku");

  const locked = await applySoldLocks([
    { id: "test-sku-sold-lock", inStock: true, name: "Should stay sold" },
    { id: "other", inStock: true, name: "Live" },
  ]);
  assert(locked[0].isSold === true && locked[0].inStock === false, "applySoldLocks forces sold");
  assert(locked[1].inStock === true && !locked[1].isSold, "applySoldLocks leaves others");

  // cleanup test sku from registry
  const cleaned = await loadSoldRegistry({ force: true });
  delete cleaned.skus["test-sku-sold-lock"];
  await writeFile(REGISTRY_PATH, JSON.stringify({ version: 1, skus: cleaned.skus, updatedAt: null }, null, 2) + "\n");
  clearSoldRegistryCache();
} catch (err) {
  await writeFile(REGISTRY_PATH, backup, "utf-8");
  clearSoldRegistryCache();
  throw err;
}

if (failures.length) {
  console.error("FAIL:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("OK: sold locks prevent resurrection (helpers + registry + restock gate).");
