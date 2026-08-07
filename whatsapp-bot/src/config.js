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
  /** WhatsApp + web chat AI (text only — keep on free OpenRouter models). */
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    model: process.env.OPENAI_MODEL || "openrouter/free",
    modelFallbacks: (process.env.OPENAI_MODEL_FALLBACKS ||
      "google/gemma-4-26b-a4b-it:free")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /** Optional Google Gemini direct API — listing-photo fallback (not WhatsApp chat). */
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    visionModel: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
    visionModels: (process.env.GEMINI_VISION_MODELS || "gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.0-flash")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /**
   * NVIDIA NIM (build.nvidia.com) — OpenAI-compatible VLMs for listing drafts.
   * Used only as fallback after OpenRouter catalog vision fails / runs out of tokens.
   */
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY || "",
    baseUrl: (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
    visionModels: (process.env.NVIDIA_VISION_MODELS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    maxAttempts: Number(process.env.NVIDIA_VISION_MAX_ATTEMPTS) || 4,
  },
  /** Seller listing photo AI only (sell page + WhatsApp catalog uploads — NOT chat). */
  catalog: {
    // Primary must be multimodal vision/chat. Keep krea as a configured OpenRouter fallback
    // (image-gen — listing-generator skips it for photo→JSON and continues to the next).
    visionModel: process.env.CATALOG_VISION_MODEL || "google/gemini-2.5-flash",
    visionFallbacks: (process.env.CATALOG_VISION_FALLBACKS ||
      "google/gemini-2.0-flash-001,krea/krea-2-medium-turbo")
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
   * Main store settings. Phase 5: 100% prepaid escrow for local catalog.
   * Daraja STK push plugs in via prepaid-checkout.js when MPESA_* env vars are set.
   */
  contact: {
    phone: process.env.BUSINESS_WHATSAPP_NUMBER || "254117422428",
    phoneDisplay: process.env.BUSINESS_PHONE_DISPLAY || "+254 117 422 428",
    email: process.env.SUPPORT_EMAIL || "support@sokonimall.com",
    founderName: process.env.FOUNDER_NAME || "David Thuku Muiruri",
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
    /** Phase 5 — local catalog is prepaid-only (set PREPAID_ONLY=false to allow legacy COD). */
    prepaidOnly: process.env.PREPAID_ONLY !== "false",
    markupKes: Number(process.env.STORE_MARKUP_KES) || 100,
    businessNumber: process.env.BUSINESS_WHATSAPP_NUMBER || "254117422428",
    codAreas: process.env.STORE_COD_AREAS || "Kenya countrywide",
    deliveryNote:
      process.env.STORE_DELIVERY_NOTE ||
      "Countrywide via Sokoni Mashinani hubs + courier. Sellers dispatch after prepaid escrow. Funds held until delivery confirmed.",
    /** Production Daraja shortcode / PartyB (SOKONIMA). Legacy personal till 4775847 retired. */
    mpesaTill: process.env.MPESA_TILL_NUMBER || "3439153",
    mpesaTillName: process.env.MPESA_TILL_NAME || "SOKONIMA",
  },
  /** Safaricom Daraja — STK push + B2C seller payouts. */
  mpesa: (() => {
    const trim = (v) => String(v || "").trim().replace(/^['"]|['"]$/g, "");
    const envRaw = trim(process.env.MPESA_ENV).toLowerCase();
    const shortcode = trim(process.env.MPESA_SHORTCODE) || "3439153";
    // Buy Goods: SHORTCODE = Daraja H.O. / password BusinessShortCode;
    // TILL_NUMBER (PartyB) = store till where funds land — may differ from SHORTCODE.
    const partyB =
      trim(process.env.MPESA_PARTY_B) ||
      trim(process.env.MPESA_TILL_NUMBER) ||
      shortcode;
    const botBase = "https://bot.sokonimall.com";
    const b2cShortcode = trim(process.env.MPESA_B2C_SHORTCODE) || shortcode;
    return {
      consumerKey: trim(process.env.MPESA_CONSUMER_KEY),
      consumerSecret: trim(process.env.MPESA_CONSUMER_SECRET),
      passkey: trim(process.env.MPESA_PASSKEY),
      shortcode,
      partyB,
      // Prefer /daraja/callback — Safaricom often rejects callback URLs containing "mpesa".
      callbackUrl:
        trim(process.env.MPESA_CALLBACK_URL) || `${botBase}/api/payments/daraja/callback`,
      env: envRaw === "production" || envRaw === "prod" ? "production" : "sandbox",
      transactionType: trim(process.env.MPESA_TRANSACTION_TYPE) || "CustomerBuyGoodsOnline",
      /** B2C (BusinessPayment) — seller escrow disbursement. */
      b2cShortcode,
      initiatorName: trim(process.env.MPESA_INITIATOR_NAME),
      /** Pre-encrypted initiator password (Daraja portal / openssl). Preferred. */
      securityCredential: trim(process.env.MPESA_SECURITY_CREDENTIAL),
      /** Plain initiator password — encrypted at runtime if cert path is set. */
      initiatorPassword: trim(process.env.MPESA_INITIATOR_PASSWORD),
      certPath: trim(process.env.MPESA_CERT_PATH),
      b2cCommandId: trim(process.env.MPESA_B2C_COMMAND_ID) || "BusinessPayment",
      b2cResultUrl:
        trim(process.env.MPESA_B2C_RESULT_URL) || `${botBase}/api/payments/daraja/b2c/result`,
      b2cTimeoutUrl:
        trim(process.env.MPESA_B2C_TIMEOUT_URL) || `${botBase}/api/payments/daraja/b2c/timeout`,
      /** When true, owed settlements are auto-sent via B2C after escrow hold. */
      b2cAuto: /^(1|true|yes)$/i.test(trim(process.env.MPESA_B2C_AUTO) || ""),
    };
  })(),
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
  /** PostgreSQL — Phase 1 marketplace database (optional; JSON catalog fallback when unset). */
  database: {
    url: process.env.DATABASE_URL || "",
    poolMax: Number(process.env.DATABASE_POOL_MAX) || 10,
  },
  /**
   * Buyer social auth mode:
   * - soft (default): if phone+sessionToken present, enforce identity; else allow legacy client IDs
   * - hard: require buyer WhatsApp session on social write actions
   * - off: disable buyer session checks
   */
  buyerAuth: {
    mode: (process.env.BUYER_AUTH_MODE || "soft").trim().toLowerCase(),
  },
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
