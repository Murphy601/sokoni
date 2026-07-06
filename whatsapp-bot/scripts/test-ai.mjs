import "dotenv/config";
import { runAiAgent } from "../src/services/ai.js";
import { setProductContext } from "../src/services/session.js";

setProductContext("254700000000", {
  id: "pt-010",
  name: "Oraimo FreePods 4 True Wireless Earbuds",
  priceKes: 1999,
  rating: 4.5,
  reviews: 3200,
  fulfillment: "store",
});

const reply = await runAiAgent("254700000000", "Are they good for phone calls?");
console.log("REPLY:", reply);
