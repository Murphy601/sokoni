import { query } from "../pool.js";

/** Mirror JSON order shipment fields into Postgres when DATABASE_URL is set. */
export async function upsertShipmentFromOrder(order) {
  if (!order?.id) return null;

  const trackingCode = order.id;
  const row = await query(
    `SELECT o.id
     FROM orders o
     WHERE o.tracking_code = $1
     LIMIT 1`,
    [trackingCode]
  );
  const orderPk = row.rows[0]?.id;
  if (!orderPk) return null;

  await query(
    `INSERT INTO shipments (
       order_id, status, courier, tracking_ref, drop_off_code, label_url,
       rider_name, rider_phone, eta_note, metadata, dispatched_at, delivered_at
     ) VALUES (
       $1, $2::shipment_status, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12
     )
     ON CONFLICT DO NOTHING`,
    [
      orderPk,
      order.shipmentStatus || "pending",
      order.courierName || null,
      order.courierTrackingRef || order.id,
      order.dropOffCode || order.id,
      order.labelUrl || null,
      order.riderName || null,
      order.riderPhone || null,
      order.transitEta || null,
      JSON.stringify({
        dropOffHub: order.dropOffHub || null,
        shipmentHistory: (order.shipmentHistory || []).slice(-10),
      }),
      order.inTransitAt ? new Date(order.inTransitAt) : null,
      order.shipmentDeliveredAt ? new Date(order.shipmentDeliveredAt) : null,
    ]
  );

  return orderPk;
}
