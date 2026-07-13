import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  timeout: 30_000,
});

const models = [
  process.env.OPENAI_MODEL || "google/gemma-4-31b-it:free",
  ...(process.env.OPENAI_MODEL_FALLBACKS || "qwen/qwen3-next-80b-a3b-instruct:free,meta-llama/llama-3.3-70b-instruct:free")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
];

for (const model of [...new Set(models)]) {
  try {
    const r = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a helpful shopping assistant. Reply in 1-2 short sentences." },
        { role: "user", content: "Sasa — nataka sandals" },
      ],
      max_tokens: 150,
    });
    console.log("OK", model, "->", r.choices[0]?.message?.content?.slice(0, 120));
  } catch (e) {
    console.log("FAIL", model, "->", e.error?.message || e.message);
  }
}
