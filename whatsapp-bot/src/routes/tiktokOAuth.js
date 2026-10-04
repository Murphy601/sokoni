import { Router } from "express";
import {
  buildAuthorizationUrl,
  consumeOAuthState,
  exchangeAuthorizationCode,
  getConnectionStatus,
  isSetupTokenValid,
} from "../services/tiktok-auth.js";

const router = Router();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(title, body) {
  const safeTitle = escapeHtml(title);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1B1035}
.ok{color:#128C7E}.err{color:#c0392b}code{background:#f4f4f4;padding:.2em .4em;border-radius:4px}</style></head>
<body><h1>${safeTitle}</h1>${body}</body></html>`;
}

/** One-time connect — open with setup token (backend only). */
router.get("/connect", (req, res) => {
  if (!isSetupTokenValid(req.query.token)) {
    return res.status(403).send(htmlPage("Forbidden", "<p class='err'>Invalid or missing setup token.</p>"));
  }
  try {
    const { url } = buildAuthorizationUrl();
    return res.redirect(url);
  } catch (err) {
    console.error("[tiktok] connect failed:", err.message);
    return res.status(500).send(htmlPage("Error", "<p class='err'>Could not start TikTok connect.</p>"));
  }
});

/** TikTok URL-prefix verification file (Content Posting / URL properties). */
router.get("/callback/:verifyFile", (req, res, next) => {
  const { verifyFile } = req.params;
  if (!/^tiktok[a-zA-Z0-9]+\.txt$/.test(verifyFile)) return next();
  const signature = process.env.TIKTOK_VERIFY_SIGNATURE?.trim();
  if (!signature) return res.status(404).type("text/plain").send("Not found");
  return res.type("text/plain").send(signature);
});

/** TikTok OAuth redirect target — must match TIKTOK_REDIRECT_URI in developer portal. */
router.get("/callback", async (req, res) => {
  const { code, state, error, error_description: desc } = req.query;

  if (error) {
    return res.status(400).send(
      htmlPage(
        "TikTok denied",
        `<p class='err'>${escapeHtml(String(error).slice(0, 80))}: ${escapeHtml(String(desc || "").slice(0, 200))}</p>`
      )
    );
  }
  if (!code || !consumeOAuthState(state)) {
    return res.status(400).send(htmlPage("Invalid callback", "<p class='err'>Missing or expired OAuth state. Try connect again.</p>"));
  }

  try {
    const tokens = await exchangeAuthorizationCode(code);
    return res.send(
      htmlPage(
        "TikTok connected",
        `<p class="ok">✅ Sokoni is linked to your TikTok account.</p>
         <p>Access token auto-refreshes — you do not need to update <code>.env</code> manually.</p>
         <p>Open ID: <code>${escapeHtml(tokens.openId || "—")}</code></p>
         <p>Scopes: <code>${escapeHtml(tokens.scope || "—")}</code></p>
         <p>You can close this tab.</p>`
      )
    );
  } catch (err) {
    console.error("[tiktok] callback failed:", err.message);
    return res.status(500).send(htmlPage("Connect failed", "<p class='err'>Could not finish TikTok connect.</p>"));
  }
});

/** Backend status check (requires setup token). */
router.get("/status", (req, res) => {
  if (!isSetupTokenValid(req.query.token)) {
    return res.status(403).json({ error: "forbidden" });
  }
  return res.json(getConnectionStatus());
});

export default router;
