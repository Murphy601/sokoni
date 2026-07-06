import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

const models = ["nvidia/nemotron-nano-9b-v2:free", "openai/gpt-oss-20b:free"];

for (const model of models) {
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a helpful shopping assistant. Reply in 1-2 short sentences." },
        { role: "user", content: "Is the Oraimo FreePods good for calls?" },
      ],
      max_tokens: 150,
    });
    console.log("===", model, "===");
    console.log(JSON.stringify(r.choices[0], null, 2));
  } catch (e) {
    console.log("FAIL", model, "->", e.error?.message || e.message);
  }
}
