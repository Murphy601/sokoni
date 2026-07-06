import { Router } from "express";
import {
  buildAuthorizationUrl,
  consumeOAuthState,
  exchangeAuthorizationCode,
  getConnectionStatus,
  isSetupTokenValid,
} from "../services/tiktok-auth.js";

const router = Router();

function htmlPage(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1B1035}
.ok{color:#128C7E}.err{color:#c0392b}code{background:#f4f4f4;padding:.2em .4em;border-radius:4px}</style></head>
<body><h1>${title}</h1>${body}</body></html>`;
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
    return res.status(500).send(htmlPage("Error", `<p class='err'>${err.message}</p>`));
  }
});

/** TikTok OAuth redirect target — must match TIKTOK_REDIRECT_URI in developer portal. */
router.get("/callback", async (req, res) => {
  const { code, state, error, error_description: desc } = req.query;

  if (error) {
    return res.status(400).send(htmlPage("TikTok denied", `<p class='err'>${error}: ${desc || ""}</p>`));
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
         <p>Open ID: <code>${tokens.openId || "—"}</code></p>
         <p>Scopes: <code>${tokens.scope || "—"}</code></p>
         <p>You can close this tab.</p>`
      )
    );
  } catch (err) {
    return res.status(500).send(htmlPage("Connect failed", `<p class='err'>${err.message}</p>`));
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
