import { Router } from "express";
import { sendText, sendImage } from "../services/whatsapp.js";
import { adminTokenFromReq, isAdminTokenValid } from "../lib/admin-auth.js";

const router = Router();

function isTokenValid(token) {
  if (isAdminTokenValid(token)) return true;
  const sendToken = process.env.WHATSAPP_SEND_TOKEN || "";
  return Boolean(sendToken && token && token === sendToken);
}

function requireToken(req, res, next) {
  if (!isTokenValid(adminTokenFromReq(req))) {
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
