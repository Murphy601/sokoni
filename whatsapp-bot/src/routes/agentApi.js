import { Router } from "express";
import { randomUUID } from "node:crypto";
import { runAgentTurn, agentMeta } from "../services/ai-agent.js";
import { synthesizeNeuralSpeech, neuralTtsMeta } from "../services/neural-tts.js";

const router = Router();
const webSessions = new Map();
const MAX_WEB_SESSIONS = 500;

function trimSessions() {
  if (webSessions.size <= MAX_WEB_SESSIONS) return;
  const keys = [...webSessions.keys()].slice(0, webSessions.size - MAX_WEB_SESSIONS);
  for (const k of keys) webSessions.delete(k);
}

function getWebHistory(sessionId) {
  if (!sessionId || !webSessions.has(sessionId)) return [];
  return webSessions.get(sessionId).history || [];
}

function pushWebHistory(sessionId, role, content) {
  if (!sessionId) return;
  if (!webSessions.has(sessionId)) {
    webSessions.set(sessionId, { history: [], createdAt: Date.now() });
  }
  const s = webSessions.get(sessionId);
  s.history.push({ role, content });
  if (s.history.length > 20) s.history.splice(0, s.history.length - 20);
  trimSessions();
}

router.get("/meta", (_req, res) => {
  res.json(agentMeta());
});

/**
 * POST /api/agent/speak — neural TTS for Ask Voice replies.
 * Returns audio/mpeg|wav when a provider is configured; otherwise JSON { fallback: "browser" }.
 * Never exposes API keys to the client.
 */
router.post("/speak", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "missing_text" });

    const meta = neuralTtsMeta();
    if (!meta.configured) {
      return res.json({ fallback: "browser", reason: "no_provider", tts: meta });
    }

    const audio = await synthesizeNeuralSpeech(text);
    if (!audio?.buffer?.length) {
      return res.json({ fallback: "browser", reason: "synth_failed", tts: meta });
    }

    res.setHeader("Content-Type", audio.contentType || "audio/mpeg");
    res.setHeader("X-Sokoni-Tts-Provider", audio.provider || "unknown");
    res.setHeader("Cache-Control", "no-store");
    return res.send(audio.buffer);
  } catch (err) {
    console.error("[agent/speak]", err.message);
    return res.json({ fallback: "browser", reason: "error", message: err.message });
  }
});

/** POST /api/agent/chat — web (and API) discovery + tracking */
router.post("/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "missing_message" });

    let sessionId = String(req.body?.sessionId || "").trim();
    if (!sessionId) sessionId = randomUUID();

    const phone = String(req.body?.phone || "").replace(/\D/g, "");
    const history = getWebHistory(sessionId);

    const result = await runAgentTurn({
      channel: "web",
      sessionKey: sessionId,
      userMessage: message,
      phone,
      history,
      persist: false,
    });

    if (result.reply) {
      pushWebHistory(sessionId, "user", message);
      // Never store leaked instruction text in session history
      if (!/we need to answer|under \d+ words|strict conversational/i.test(result.reply)) {
        pushWebHistory(sessionId, "assistant", result.reply);
      }
    }

    res.json({
      sessionId,
      reply: result.reply,
      products: result.products || [],
      tracking: result.tracking || null,
      tools: (result.tools || []).map((t) => t.tool),
      offline: Boolean(result.offline),
      meta: agentMeta(),
    });
  } catch (err) {
    console.error("[agent/chat]", err.message);
    res.status(500).json({ error: "agent_failed", message: err.message });
  }
});

export default router;
