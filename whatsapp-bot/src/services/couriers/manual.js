/**
 * Manual courier adapter — hub scans and admin-entered tracking refs.
 * Real Fargo / Pickup Mtaani / Sendy APIs plug in as sibling adapters.
 */
export const manualCourier = {
  id: "manual",
  displayName: "Sokoni Hub / Manual",
  supportsPrepaidLabel: true,

  createShipment(order) {
    return {
      dropOffCode: order.dropOffCode || order.id,
      labelUrl: order.labelUrl || null,
      trackingRef: order.courierTrackingRef || order.id,
      instructions:
        "Attach prepaid label, drop at nearest Sokoni hub. Hub scan updates tracking automatically.",
    };
  },

  trackingUrl(trackingRef) {
    if (!trackingRef) return null;
    return null;
  },

  formatStatus(status) {
    return status;
  },
};
