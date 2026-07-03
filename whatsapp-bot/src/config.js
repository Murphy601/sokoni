import "dotenv/config";

/**
 * Central config, read once from environment variables. Missing values are left
 * empty on purpose so the app can run in dry-run/demo mode (see whatsapp.js and
 * ai.js) without real credentials while you develop the conversation flow.
 */
export const config = {
  brand: {
    name: "Sokoni",
    tagline: "Your Market, On WhatsApp.",
  },
  port: Number(process.env.PORT) || 3000,
  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
    apiVersion: process.env.WHATSAPP_API_VERSION || "v21.0",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  affiliates: {
    kilimall: process.env.KILIMALL_AFFILIATE_ID || "demo-kilimall",
    jumia: process.env.JUMIA_AFFILIATE_ID || "demo-jumia",
    aliexpress: process.env.ALIEXPRESS_AFFILIATE_ID || "demo-aliexpress",
    temu: process.env.TEMU_AFFILIATE_ID || "demo-temu",
    amazon: process.env.AMAZON_AFFILIATE_TAG || "demo-amazon",
  },
  adminNotifyUrl: process.env.ADMIN_NOTIFY_URL || "",
};
