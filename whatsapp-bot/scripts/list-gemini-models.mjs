import "dotenv/config";
import { config } from "../src/config.js";

const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models`, {
  headers: { "x-goog-api-key": config.gemini.apiKey },
});
const data = await r.json();
const vision = (data.models || [])
  .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
  .map((m) => m.name.replace("models/", ""))
  .filter((n) => /flash|pro|gemini/i.test(n));
console.log(vision.join("\n"));
