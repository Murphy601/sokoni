import "dotenv/config";
import { searchProducts } from "../src/services/catalog.js";

const queries = [
  "laundry machine",
  "What about TVs?",
  "Retro Handheld Game Console",
  "I want a laundry machine, give me the best recommendations",
];

for (const q of queries) {
  const r = await searchProducts({ keywords: q, fulfillment: "store", limit: 3 });
  console.log(q, "->", r.map((p) => p.name).join(" | ") || "NONE");
}
