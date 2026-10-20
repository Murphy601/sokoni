import { clientError } from "../lib/public-error.js";
import crypto from "node:crypto";
import { Router } from "express";
import { sendText, sendImage } from "../services/whatsapp.js";
import { adminTokenFromReq, isAdminTokenValid } from "../lib/admin-auth.js";

const router = Router();

function isTokenValid(token) {
  if (isAdminTokenValid(token)) return true;
  const sendToken = String(process.env.WHATSAPP_SEND_TOKEN || "").trim();
  if (!sendToken || !token) return false;
  const a = crypto.createHash("sha256").update(String(token)).digest();
  const b = crypto.createHash("sha256").update(sendToken).digest();
  return crypto.timingSafeEqual(a, b);
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
    res.status(502).json(clientError(err, "send_failed"));
  }
});

export default router;
