import {
  sendWelcome,
  sendMainMenu,
  isCategoryMenuId,
  sendCategorySubmenu,
  isSubcategoryRowId,
  sendProductsForSubcategory,
  sendDealsOfTheDay,
  sendInternationalMenu,
  sendInternationalTrending,
  sendTrackOrderMenu,
  sendTrackingInfo,
  sendHumanHandoff,
  sendHowItWorks,
  sendProductFollowUpContext,
} from "../services/menu.js";
import { sendText } from "../services/whatsapp.js";
import { runAiAgent } from "../services/ai.js";
import { pushMessage, setProductContext } from "../services/session.js";

const RESET_KEYWORDS = new Set(["menu", "hi", "hello", "start", "hey", "habari"]);

/**
 * Extracts a normalized { from, kind, text, interactiveId } shape from a raw
 * WhatsApp Cloud API webhook payload for a single message.
 */
function parseMessage(message) {
  const from = message.from;
  if (message.type === "text") {
    return { from, kind: "text", text: message.text.body };
  }
  if (message.type === "interactive") {
    const interactive = message.interactive;
    if (interactive.type === "list_reply") {
      return { from, kind: "interactive", interactiveId: interactive.list_reply.id };
    }
    if (interactive.type === "button_reply") {
      return { from, kind: "interactive", interactiveId: interactive.button_reply.id };
    }
  }
  return { from, kind: "unsupported" };
}

async function handleInteractive(from, id) {
  if (id === "menu_main") return sendMainMenu(from);
  if (isCategoryMenuId(id)) return sendCategorySubmenu(from, id);
  if (isSubcategoryRowId(id)) return sendProductsForSubcategory(from, id);
  if (id === "deals_today") return sendDealsOfTheDay(from);
  if (id === "intl_shop") return sendInternationalMenu(from);
  if (id === "intl_trending") return sendInternationalTrending(from);
  if (id === "intl_custom") {
    return sendText(from, "Tell me what you're looking for and I'll search AliExpress, Temu and Amazon for you! 🌍");
  }
  if (id === "track_order") return sendTrackOrderMenu(from);
  if (id.startsWith("track_")) return sendTrackingInfo(from, id);
  if (id === "human_handoff") return sendHumanHandoff(from);
  if (id === "how_it_works") return sendHowItWorks(from);
  if (id.startsWith("ask_ai_")) {
    const product = await sendProductFollowUpContext(id);
    if (product) {
      setProductContext(from, product);
      pushMessage(
        from,
        "system",
        `The customer wants to ask about this specific product: ${JSON.stringify(product)}`
      );
    }
    return sendText(from, "Sure — what would you like to know about it? 🤔");
  }
  return sendMainMenu(from);
}

export async function handleIncomingMessage(message) {
  const parsed = parseMessage(message);
  if (parsed.kind === "unsupported") return;
  const { from } = parsed;

  if (parsed.kind === "interactive") {
    return handleInteractive(from, parsed.interactiveId);
  }

  const text = parsed.text.trim();
  const normalized = text.toLowerCase();
  if (RESET_KEYWORDS.has(normalized)) {
    return sendWelcome(from);
  }

  const reply = await runAiAgent(from, text);
  return sendText(from, reply);
}
