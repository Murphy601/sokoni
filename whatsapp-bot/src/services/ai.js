/**
 * WhatsApp AI entry — Phase 7 delegates to unified Sokoni Plug agent core.
 */
import { runAgentTurn } from "./ai-agent.js";

export { agentMeta } from "./ai-agent.js";

/**
 * Runs one turn of the Sokoni Plug agent. Never throws.
 * @returns {Promise<{ reply: string|null, products: Array, tools: Array, handoff?: boolean, offline?: boolean }>}
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
    if (result.handoff) {
      return { reply: null, products: [], tools: result.tools || [], handoff: true };
    }
    return {
      reply: result.reply || null,
      products: result.products || [],
      tools: result.tools || [],
      offline: Boolean(result.offline),
    };
  } catch (err) {
    console.error("[ai] runAiAgent failed:", err.message);
    return {
      reply: "Something went wrong. Type *menu* to browse, or send your *SKN-####* (or older *SK-####*) to track.",
      products: [],
      tools: [],
    };
  }
}
