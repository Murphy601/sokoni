/**
 * WhatsApp AI entry — Phase 7 delegates to unified agent core.
 */
import { runAgentTurn } from "./ai-agent.js";

export { agentMeta } from "./ai-agent.js";

/**
 * Runs one turn of the Sokoni Plug agent. Never throws — always returns text or null.
 */
export async function runAiAgent(sessionKey, userMessage, phone = "") {
  try {
    const result = await runAgentTurn({
      channel: "whatsapp",
      sessionKey,
      userMessage,
      phone,
      persist: true,
    });
    return result.handoff ? null : result.reply || null;
  } catch (err) {
    console.error("[ai] runAiAgent failed:", err.message);
    return "Something went wrong. Type *menu* to browse, or send your *SK-####* to track.";
  }
}
