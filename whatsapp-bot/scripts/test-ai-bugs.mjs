import "dotenv/config";
import { findProductFromMessage } from "../src/services/catalog.js";
import { runAiAgent } from "../src/services/ai.js";

const msg =
  "Retro Handheld Game Console (400+ Games)\nKES 2,599\n\nCan I get more info on this?";
console.log("found:", (await findProductFromMessage(msg))?.name);
const retro = await runAiAgent("254711111110", msg);
console.log("\nRetro info:", retro);

const tv = await runAiAgent("254711111111", "What about TVs?");
console.log("\nTVs:", tv);

const laundry = await runAiAgent("254711111112", "I want a laundry machine, give me the best recommendations");
console.log("\nLaundry:", laundry);
