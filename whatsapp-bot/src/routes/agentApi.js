import { Router } from "express";
import { randomUUID } from "node:crypto";
import { runAgentTurn, agentMeta } from "../services/ai-agent.js";

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
      pushWebHistory(sessionId, "assistant", result.reply);
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
