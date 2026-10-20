import "dotenv/config";
import { findProductFromMessage } from "../src/services/catalog.js";
import { runAiAgent } from "../src/services/ai.js";

const msg =
  "Retro Handheld Game Console (400+ Games)\nKES 2,599\n\nCan I get more info on this?";
console.log("found:", (await findProductFromMessage(msg))?.name);
const retro = await runAiAgent("254711111110", msg);
console.log("\nRetro info:", retro.reply);
console.log("Retro tools:", (retro.tools || []).map((t) => t.tool).join(", "));

const tv = await runAiAgent("254711111111", "What about TVs?");
console.log("\nTVs:", tv.reply);
console.log("TV tools:", (tv.tools || []).map((t) => t.tool).join(", "));

const laundry = await runAiAgent("254711111112", "I want a laundry machine, give me the best recommendations");
console.log("\nLaundry:", laundry.reply);
console.log("Laundry tools:", (laundry.tools || []).map((t) => t.tool).join(", "));
