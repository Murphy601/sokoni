import {
  findProductFromWebsiteMessage,
  findProductFromMessage,
} from "../src/services/catalog.js";
import { resolveProductQuery } from "../src/services/product-router.js";

const cases = [
  'Hi Sokoni, tell me more about "Apple Watch Series 9 GPS 41mm" (≈ KES 42,770).',
  'Hi Sokoni, I\'d like to order "Tecno Spark 20C 128GB + 4GB RAM" (KES 13,599) — Pay on Delivery.',
  "I want BRUT 1 litre perfume oil",
  "apple watch series 9",
];

for (const msg of cases) {
  const web = await findProductFromWebsiteMessage(msg);
  const route = await resolveProductQuery(msg);
  console.log("\n---", msg.slice(0, 60), "...");
  console.log("website:", web?.name || "NONE", web?.id || "");
  console.log("router:", route.action, route.kind || route.product?.name || route.matches?.[0] || "");
}
