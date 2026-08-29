import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Always load whatsapp-bot/.env as source of truth. Default dotenv does not
// override existing process.env, so a polluted `pm2 restart --update-env` from
// a shell with a bad/OCR Consumer Key would win and break STK OAuth (HTTP 400)
// even when the .env file (and scripts/test-daraja-oauth.sh) were correct.
const __configDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: path.join(__configDir, "..", ".env"),
  override: true,
});

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
  /** WhatsApp + web chat AI (text only). Prefer Groq/Gemini for speed; OpenRouter free as fallback. */
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    // Named free model (fast) — avoid openrouter/free auto-router as primary (slow queues).
    model: process.env.OPENAI_MODEL || "google/gemma-4-31b-it:free",
    modelFallbacks: (process.env.OPENAI_MODEL_FALLBACKS ||
      "openrouter/free")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /**
   * Fast chat: Groq Cloud — set GROQ_API_KEY for production WhatsApp latency.
   * Default openai/gpt-oss-20b (replaces retired llama-3.1-8b-instant, Aug 2026).
   */
  groq: {
    apiKey: process.env.GROQ_API_KEY || "",
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    modelFallbacks: (process.env.GROQ_MODEL_FALLBACKS || "openai/gpt-oss-120b")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  /**
   * Chat routing: auto (Groq→OpenRouter) | groq | gemini | openrouter
   * Gemini chat only when AI_CHAT_PROVIDER=gemini or AI_CHAT_USE_GEMINI=true
   * (GEMINI_API_KEY alone is for listing vision — do not put it in the chat chain).
   * Temperature kept low (0.1–0.2) for consistent buyer/seller replies.
   */
  aiChat: {
    provider: process.env.AI_CHAT_PROVIDER || "auto",
    temperature: Number(process.env.AI_CHAT_TEMPERATURE ?? 0.15),
    /** Soft ceiling for chat completions (WhatsApp); clamped 200–800 in ai-agent. */
    maxTokens: Number(process.env.AI_CHAT_MAX_TOKENS ?? 480),
    useGemini:
      process.env.AI_CHAT_PROVIDER === "gemini" ||
      /^(1|true|yes|on)$/i.test(String(process.env.AI_CHAT_USE_GEMINI || "").trim()),
  },
  /**
   * Multi-Agent System fallback gateway (strangler fig).
   * Does NOT replace Cloudinary→HeyGen→Remotion, Groq chat, or listing vision primaries.
   * Shadow on by default when MAS_ENABLED; live assists need explicit flags.
   */
  mas: {
    enabled: process.env.MAS_ENABLED !== "false",
    shadow: process.env.MAS_SHADOW !== "false",
    mediaFallback: /^(1|true|yes|on)$/i.test(String(process.env.MAS_ENABLE_MEDIA_FALLBACK || "")),
    voiceAssist: /^(1|true|yes|on)$/i.test(String(process.env.MAS_ENABLE_VOICE_ASSIST || "")),
    moderationLive: /^(1|true|yes|on)$/i.test(String(process.env.MAS_ENABLE_MODERATION_LIVE || "")),
    chatFailover: /^(1|true|yes|on)$/i.test(String(process.env.MAS_ENABLE_CHAT_FAILOVER || "")),
    transactionalShadow: /^(1|true|yes|on)$/i.test(String(process.env.MAS_ENABLE_TX_SHADOW || "")),
    timeoutMs: Number(process.env.MAS_TIMEOUT_MS ?? 2000) || 2000,
  },
  /** Optional Google Gemini — listing vision + optional chat (opt-in via AI_CHAT_*). */
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    visionModel: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
    visionModels: (process.env.GEMINI_VISION_MODELS || "gemini-2.5-flash,gemini-2.0-flash-lite,gemini-2.0-flash")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    chatModel: process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash",
    chatBaseUrl:
      process.env.GEMINI_CHAT_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta/openai/",
  },
  /**
   * NVIDIA NIM (build.nvidia.com) — OpenAI-compatible VLMs for listing drafts
   * and buyer WhatsApp photo→stock match (free pool).
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
  /**
   * Buyer WhatsApp photo → similar stock (free vision only).
   * Order: OpenRouter free VLMs → NVIDIA free VLMs → optional Gemini.
   * Override with IMAGE_SEARCH_VISION_MODELS (comma list; must stay :free / openrouter/free).
   */
  imageSearch: {
    openrouterModels: (process.env.IMAGE_SEARCH_VISION_MODELS ||
      "openrouter/free,nvidia/nemotron-nano-12b-v2-vl:free,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    /** Set IMAGE_SEARCH_ALLOW_GEMINI=false to skip Gemini entirely when keys expire weekly. */
    allowGemini: process.env.IMAGE_SEARCH_ALLOW_GEMINI !== "false",
  },
  /** Seller listing photo AI only (sell page + WhatsApp catalog uploads — NOT chat). */
  catalog: {
    // Prefer free OpenRouter VLMs; code still falls through to NVIDIA NIM → Gemini.
    // Keep krea only if you add it via env (image-gen — skipped for photo→JSON).
    visionModel: process.env.CATALOG_VISION_MODEL || "openrouter/free",
    visionFallbacks: (process.env.CATALOG_VISION_FALLBACKS ||
      "nvidia/nemotron-nano-12b-v2-vl:free,nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
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
    /** Alias used by some menus — same as email */
    supportEmail: process.env.SUPPORT_EMAIL || "support@sokonimall.com",
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
    /** Buy Goods Till (PartyB). Org/Daraja H.O. is config.mpesa.shortcode (3439153). */
    mpesaTill: process.env.MPESA_TILL_NUMBER || "4775847",
    mpesaTillName: process.env.MPESA_TILL_NAME || "David Thuku Muiruri",
  },
  /** Safaricom Daraja — STK push + B2C seller payouts. */
  mpesa: (() => {
    const trim = (v) => String(v || "").trim().replace(/^['"]|['"]$/g, "");
    const envRaw = trim(process.env.MPESA_ENV).toLowerCase();
    const shortcode = trim(process.env.MPESA_SHORTCODE) || "3439153";
    // SHORTCODE 3439153 = org/Daraja H.O. (password). TILL 4775847 = PartyB.
    // Merchant store 4421485 is not used in STK.
    const partyB =
      trim(process.env.MPESA_PARTY_B) ||
      trim(process.env.MPESA_TILL_NUMBER) ||
      "4775847";
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
      /**
       * Business days after delivery before Ready for M-Pesa.
       * 0 = credit seller dashboard wallet immediately on delivery / buyer confirm.
       * Set ESCROW_HOLD_BUSINESS_DAYS=3 for a Depop-style hold.
       */
      escrowHoldBusinessDays: (() => {
        const raw = trim(process.env.ESCROW_HOLD_BUSINESS_DAYS);
        if (raw === "") return 0;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
      })(),
      /**
       * When true (default) and B2C is configured, seller Withdraw triggers Daraja B2C
       * immediately for Ready balances. If B2C is not configured, withdraw stays manual.
       */
      withdrawInstantB2c: !/^(0|false|no)$/i.test(
        trim(process.env.SELLER_WITHDRAW_INSTANT_B2C) || "true"
      ),
    };
  })(),
  /**
   * Paystack — buyer C2B (M-Pesa STK charge) + seller transfers.
   * PAYSTACK_ONLY=true (default) never falls back to Daraja STK / B2C.
   */
  paystack: (() => {
    const trim = (v) => String(v || "").trim().replace(/^['"]|['"]$/g, "");
    const railRaw = trim(process.env.SELLER_PAYOUT_RAIL).toLowerCase();
    const payoutRail =
      railRaw === "paystack" || railRaw === "b2c" || railRaw === "manual" || railRaw === "admin"
        ? railRaw === "manual"
          ? "admin"
          : railRaw
        : "paystack";
    const collectRaw = trim(process.env.BUYER_PAY_RAIL).toLowerCase();
    const collectRail =
      collectRaw === "paystack" || collectRaw === "daraja" || collectRaw === "manual"
        ? collectRaw
        : "paystack";
    const botBase = "https://bot.sokonimall.com";
    return {
      secretKey: trim(process.env.PAYSTACK_SECRET_KEY),
      publicKey: trim(process.env.PAYSTACK_PUBLIC_KEY),
      webhookUrl:
        trim(process.env.PAYSTACK_WEBHOOK_URL) || `${botBase}/api/webhooks/paystack`,
      payoutRail,
      collectRail,
      only: !/^(0|false|no)$/i.test(trim(process.env.PAYSTACK_ONLY) || "true"),
      collect: !/^(0|false|no)$/i.test(trim(process.env.PAYSTACK_COLLECT) || "true"),
      chargeEmail: trim(process.env.PAYSTACK_CHARGE_EMAIL),
      withdrawInstant: !/^(0|false|no)$/i.test(
        trim(process.env.SELLER_WITHDRAW_INSTANT_PAYSTACK) || "true"
      ),
      /** false = skip Transfer API (Starter Business) and queue admin #paid. */
      transfers: !/^(0|false|no)$/i.test(trim(process.env.PAYSTACK_TRANSFERS) || "true"),
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
    const phones = [
      ...(process.env.ADMIN_PHONES || "").split(","),
      process.env.ADMIN_WHATSAPP_NUMBER || "",
    ]
      .map((p) => String(p || "").replace(/\D/g, ""))
      .filter(Boolean);
    const unique = [...new Set(phones)];
    const alertPhone =
      unique[0] ||
      (process.env.BUSINESS_WHATSAPP_NUMBER || "").replace(/\D/g, "") ||
      "";
    if (unique.length === 0) {
      console.warn(
        "[config] ADMIN_PHONES / ADMIN_WHATSAPP_NUMBER not set — admin commands disabled; alerts go to business number only"
      );
    }
    return { phones: unique, primary: alertPhone };
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
