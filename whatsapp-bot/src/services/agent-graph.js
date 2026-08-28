/**
 * LangGraph-style multi-agent graph for Sokoni Plug (Node, no Python LangGraph runtime).
 * Nodes: escalate → route specialist → tools (allowlisted) → knowledge RAG → reply.
 */
import {
  detectEscalation,
  routeSpecialist,
  specialistSystemHint,
  retrieveKnowledgeAsync,
  formatKnowledgeForPrompt,
  summarizeForHandoff,
  evaluateGoodwillVoucher,
} from "./agent-specialists.js";
import { runToolRouter, TOOL_NAMES, filterToolsForSpecialist } from "./ai-tools.js";
import { threadIdFromPhone } from "./commerce-ops.js";

/** Tool allowlists per specialist lane (LangGraph agent boundaries). */
export const SPECIALIST_TOOLS = {
  buyer: [
    "search_products",
    "browse_products",
    "browse_taxonomy",
    "get_product",
    "track_order",
    "list_orders",
    "store_info",
    "open_return_case",
    "create_checkout_link",
    "verify_payment_code",
  ],
  seller: [
    "store_info",
    "get_seller_onboarding",
    "get_seller_payout",
    "get_shipping_rates",
    "browse_taxonomy",
    "update_inventory",
    "dispatch_with_rider",
    "check_aup",
  ],
  dispute: [
    "track_order",
    "list_orders",
    "open_return_case",
    "propose_goodwill",
    "store_info",
    "verify_payment_code",
  ],
  logistics: ["track_order", "list_orders", "store_info", "get_shipping_rates", "dispatch_with_rider"],
  general: [...TOOL_NAMES],
};

/**
 * Run the multi-agent graph up to tool + knowledge assembly.
 * LLM / offline reply stays in ai-agent.js.
 */
export async function runAgentGraph({
  text,
  phone = "",
  customerKey = "",
  isSellerSession = false,
} = {}) {
  const escalation = detectEscalation(text);
  const specialist = routeSpecialist(text, { isSellerSession });
  const allow = SPECIALIST_TOOLS[specialist] || SPECIALIST_TOOLS.general;

  const rawTools = await runToolRouter(text, {
    phone,
    customerKey,
    specialist,
    allowedTools: allow,
  });
  const tools = filterToolsForSpecialist
    ? filterToolsForSpecialist(rawTools, allow)
    : rawTools.filter((t) => allow.includes(t.tool));

  const knowledge = await retrieveKnowledgeAsync(text, { limit: 3, specialist });
  const knowledgeBlock = formatKnowledgeForPrompt(knowledge);
  const handoffSummary = summarizeForHandoff({
    text,
    specialist,
    toolNames: tools.map((t) => t.tool),
  });
  const threadId = threadIdFromPhone(phone || customerKey);

  return {
    escalation,
    specialist,
    specialistHint: specialistSystemHint(specialist),
    tools,
    knowledge,
    knowledgeBlock,
    handoffSummary,
    threadId,
    graph: {
      framework: "langgraph-style",
      nodes: ["escalate", "route", "tools", "knowledge", "reply"],
      specialist,
      toolAllowlist: allow,
      threadId,
    },
  };
}

export { evaluateGoodwillVoucher };
