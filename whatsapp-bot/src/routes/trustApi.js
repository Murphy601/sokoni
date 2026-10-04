import { Router } from "express";
import { listAllOrders } from "../services/orders.js";
import { tickerItems } from "../services/trust-ticker.js";

const router = Router();

let cache = { at: 0, items: [] };

/** GET /api/trust/ticker — recent escrow events, with no contact details. */
router.get("/ticker", (_req, res) => {
  const now = Date.now();
  if (now - cache.at > 30_000) {
    cache = { at: now, items: tickerItems(listAllOrders(), now) };
  }
  res.json({ ok: true, items: cache.items });
});

export default router;
