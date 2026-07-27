import { Router } from "express";
import { config } from "../config.js";
import { sendText, sendImage } from "../services/whatsapp.js";

const router = Router();

function isTokenValid(token) {
  const expected =
    process.env.ADMIN_SETUP_TOKEN ||
    process.env.SUPPLIER_ADMIN_TOKEN ||
    process.env.WHATSAPP_SEND_TOKEN ||
    config.tiktok?.setupToken ||
    "";
  return expected && token === expected;
}

function requireToken(req, res, next) {
  const token = req.query.token || req.headers["x-sokoni-token"];
  if (!isTokenValid(token)) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

router.use(requireToken);

/** POST /api/whatsapp/send — internal VM-to-bot message dispatch (replaces localhost:5001 Baileys pattern). */
router.post("/send", async (req, res) => {
  const { phone, to, text, imageUrl, caption } = req.body || {};
  const target = phone || to;
  if (!target || !text) {
    return res.status(400).json({ error: "missing_fields", message: "phone (or to) and text are required" });
  }
  try {
    if (imageUrl) {
      const resp = await sendImage(target, { link: imageUrl, caption: caption || text });
      return res.json({ success: true, messageId: resp?.id || null });
    }
    const resp = await sendText(target, text);
    res.json({ success: true, messageId: resp?.id || null });
  } catch (err) {
    res.status(502).json({ error: "send_failed", message: err.message });
  }
});

export default router;
