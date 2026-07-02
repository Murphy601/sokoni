import express from "express";
import { config } from "./config.js";
import { handleIncomingMessage } from "./handlers/webhookHandler.js";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: `${config.brand.name} WhatsApp bot` });
});

// Meta calls this once when you configure the webhook URL in the app dashboard.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Meta POSTs every inbound message/status update here.
app.post("/webhook", async (req, res) => {
  // Always ack fast — WhatsApp retries aggressively if you don't 200 quickly.
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages || [];
    for (const message of messages) {
      await handleIncomingMessage(message);
    }
  } catch (err) {
    console.error("Error handling webhook:", err);
  }
});

app.listen(config.port, () => {
  console.log(`${config.brand.name} WhatsApp bot listening on port ${config.port}`);
  if (!config.whatsapp.accessToken) {
    console.log("⚠️ WHATSAPP_ACCESS_TOKEN not set — running in dry-run mode (messages will be logged, not sent).");
  }
  if (!config.openai.apiKey) {
    console.log("⚠️ OPENAI_API_KEY not set — free-text replies will use a basic keyword-search fallback.");
  }
});
