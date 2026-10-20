#!/usr/bin/env node
/**
 * Upsert + verify a Sokoni boda rider (admin smoke).
 *
 *   cd ~/sokoni/whatsapp-bot
 *   node scripts/seed-boda-rider.mjs 2547XXXXXXXX "Jane Wanjiku" NAIROBI KMA123A
 */
import { upsertRiderProfile, setRiderVerificationStatus } from "../src/services/boda-fleet.js";
import { closePool } from "../src/db/pool.js";

const phone = process.argv[2];
const fullName = process.argv[3] || "Sokoni Rider";
const zone = process.argv[4] || "NAIROBI";
const plate = process.argv[5] || `KMA${String(Date.now()).slice(-3)}A`;

if (!phone) {
  console.error("Usage: node scripts/seed-boda-rider.mjs 2547… \"Full Name\" NAIROBI|THIKA PLATE");
  process.exit(1);
}

try {
  const created = await upsertRiderProfile({
    phone,
    fullName,
    operatingTown: zone,
    motorbikePlate: plate,
    stageLocation: zone === "THIKA" ? "Thika Town Stage" : "Nairobi Stage",
    nationalId: `ID${String(phone).replace(/\D/g, "").slice(-8)}`,
  });
  if (created.error) {
    console.error("FAIL upsert:", created);
    process.exit(1);
  }
  const verified = await setRiderVerificationStatus(created.rider.id, "VERIFIED");
  if (verified.error) {
    console.error("FAIL verify:", verified);
    process.exit(1);
  }
  console.log("OK rider:", verified.rider);
} finally {
  await closePool().catch(() => {});
}
