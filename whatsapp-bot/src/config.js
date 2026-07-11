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
  port: Number(process.env.PORT) || 3001,
  /** WAHA — WhatsApp HTTP API (self-hosted, not Meta Cloud API). */
  waha: {
    apiUrl: (process.env.WAHA_API_URL || process.env.WAHA_URL || "").replace(/\/$/, ""),
    apiKey: process.env.WAHA_API_KEY || "",
    session: process.env.WAHA_SESSION || "default",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    model: process.env.OPENAI_MODEL || "google/gemini-2.5-flash",
    modelFallbacks: (process.env.OPENAI_MODEL_FALLBACKS ||
      "openai/gpt-4o-mini,google/gemini-2.5-flash-lite,nvidia/nemotron-nano-9b-v2:free")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /** WhatsApp admin catalog intake (photos + #add / #price). */
  catalog: {
    visionModel: process.env.CATALOG_VISION_MODEL || "google/gemini-2.5-flash",
    visionFallbacks: (process.env.CATALOG_VISION_FALLBACKS || "google/gemini-2.0-flash-exp:free,google/gemini-2.5-flash-lite")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    autoPush: process.env.CATALOG_AUTO_PUSH === "true",
    publishDebounceMs: Number(process.env.CATALOG_PUBLISH_DEBOUNCE_MS) || 30_000,
  },
  affiliates: {
    kilimall: process.env.KILIMALL_AFFILIATE_ID || "demo-kilimall",
    jumia: process.env.JUMIA_AFFILIATE_ID || "demo-jumia",
    aliexpress: process.env.ALIEXPRESS_AFFILIATE_ID || "demo-aliexpress",
    temu: process.env.TEMU_AFFILIATE_ID || "demo-temu",
    amazon: process.env.AMAZON_AFFILIATE_TAG || "demo-amazon",
  },
  /**
   * Main store settings. Sokoni sells at its own price (supplier cost + markup)
   * and the customer pays on delivery (cash/M-Pesa to the rider).
   */
  contact: {
    phone: process.env.BUSINESS_WHATSAPP_NUMBER || "254117422428",
    phoneDisplay: process.env.BUSINESS_PHONE_DISPLAY || "+254 117 422 428",
    email: process.env.SUPPORT_EMAIL || "support@sokonimall.com",
    founderName: process.env.MPESA_TILL_NAME || "David Thuku Muiruri",
    location: process.env.BUSINESS_LOCATION || "Sokoni Mall Startup Hub, Nairobi, Kenya",
  },
  offers: {
    maxDiscountPercent: Number(process.env.MAX_OFFER_PERCENT) || 3,
    promoCode: process.env.PROMO_CODE || "SOKONI3",
  },
  businessHours: {
    timezone: process.env.BUSINESS_TIMEZONE || "Africa/Nairobi",
    humanSupportStart: process.env.HUMAN_SUPPORT_START || "07:30",
    humanSupportEnd: process.env.HUMAN_SUPPORT_END || "21:00",
  },
  store: {
    markupKes: Number(process.env.STORE_MARKUP_KES) || 100,
    businessNumber: process.env.BUSINESS_WHATSAPP_NUMBER || "254117422428",
    codAreas: process.env.STORE_COD_AREAS || "Nairobi & environs",
    deliveryNote:
      process.env.STORE_DELIVERY_NOTE ||
      "Delivery in 1-3 days within Nairobi; countrywide via courier. Pay via M-Pesa Till on delivery only.",
    mpesaTill: process.env.MPESA_TILL_NUMBER || "4775847",
    mpesaTillName: process.env.MPESA_TILL_NAME || "David Thuku Muiruri",
  },
  adminNotifyUrl: process.env.ADMIN_NOTIFY_URL || "",
  /**
   * Admin console phone(s). Set ADMIN_PHONES to a number DIFFERENT from the bot
   * so the owner can manage the shop from their own WhatsApp. Messages from
   * these numbers are treated as admin commands, and order/handoff alerts are
   * sent here. Defaults to the business number (self-chat) if unset.
   */
  admin: (() => {
    const phones = (process.env.ADMIN_PHONES || "")
      .split(",")
      .map((p) => p.replace(/\D/g, ""))
      .filter(Boolean);
    const alertPhone =
      phones[0] ||
      (process.env.BUSINESS_WHATSAPP_NUMBER || "").replace(/\D/g, "") ||
      "";
    if (phones.length === 0) {
      console.warn(
        "[config] ADMIN_PHONES not set — admin commands disabled; alerts go to business number only"
      );
    }
    return { phones, primary: alertPhone };
  })(),
  /** Public URL where product images are hosted (needed for WhatsApp image messages). */
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || "http://localhost:8080").replace(/\/$/, ""),
  /** Bot HTTPS base — serves /catalog-images for WhatsApp (immediate after admin upload). */
  botPublicUrl: (process.env.BOT_PUBLIC_URL || "https://bot.sokonimall.com").replace(/\/$/, ""),
  /** TikTok Content Posting API (backend cron only — not exposed on website). */
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    /** Optional one-time bootstrap; persisted tokens live in data/tiktok-oauth.json */
    accessToken: process.env.TIKTOK_ACCESS_TOKEN || "",
    refreshToken: process.env.TIKTOK_REFRESH_TOKEN || "",
    redirectUri:
      process.env.TIKTOK_REDIRECT_URI ||
      `http://localhost:${Number(process.env.PORT) || 3001}/admin/tiktok/callback`,
    scopes: process.env.TIKTOK_SCOPES || "user.info.basic,video.publish",
    /** Secret for /admin/tiktok/connect and /status (backend setup only). */
    setupToken: process.env.TIKTOK_SETUP_TOKEN || "",
    cronEnabled: process.env.TIKTOK_CRON_ENABLED === "true",
    /** Post times in EAT — 8:00 AM, 1:00 PM, 7:30 PM by default */
    postTimes: (process.env.TIKTOK_POST_TIMES || "08:00,13:00,19:30")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    timezone: process.env.TIKTOK_TIMEZONE || "Africa/Nairobi",
    /** Sandbox/unaudited apps must use SELF_ONLY until TikTok app audit passes. */
    privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
  },
};
