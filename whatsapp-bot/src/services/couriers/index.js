import { manualCourier } from "./manual.js";

/** Courier registry — swap stubs for live API adapters per partner. */
const REGISTRY = {
  manual: manualCourier,
  sokoni: manualCourier,
  fargo: { ...manualCourier, id: "fargo", displayName: "Fargo Courier" },
  pickup_mtaani: { ...manualCourier, id: "pickup_mtaani", displayName: "Pickup Mtaani" },
  sendy: { ...manualCourier, id: "sendy", displayName: "Sendy" },
  g4s: { ...manualCourier, id: "g4s", displayName: "G4S" },
  wells_fargo: { ...manualCourier, id: "wells_fargo", displayName: "Wells Fargo Courier" },
};

export function listCouriers() {
  return Object.values(REGISTRY).map((c) => ({ id: c.id, displayName: c.displayName }));
}

export function getCourierAdapter(name = "manual") {
  const key = String(name || "manual")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  return REGISTRY[key] || manualCourier;
}

export function createCourierShipment(order, courierName = "manual") {
  const adapter = getCourierAdapter(courierName);
  return adapter.createShipment(order);
}
