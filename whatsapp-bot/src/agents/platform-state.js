/**
 * Small heap snapshot the agents can read without a query.
 *
 * Chat does not have a socket room per person, and escrow is an order, not a
 * row of its own. This map tracks who signed in recently, which orders have a
 * payment in flight, and which riders are on a job. Counts only go out on the
 * bus. The maps themselves are capped so a busy day cannot grow the heap.
 */

const MAX_USERS = 400;
const MAX_ESCROWS = 150;
const MAX_RIDERS = 80;
const USER_TTL_MS = 30 * 60 * 1000;
const ESCROW_TTL_MS = 6 * 60 * 60 * 1000;
const RIDER_TTL_MS = 12 * 60 * 60 * 1000;

function dayKey(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function intId(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

class PlatformState {
  constructor() {
    this.recentUsers = new Map();
    this.escrows = new Map();
    this.riders = new Map();
    this.todayVolumeKes = 0;
    this.volumeDay = dayKey(Date.now());
    this.unresolvedDisputes = 0;
  }

  touchUser(userId, now = Date.now()) {
    const id = intId(userId);
    if (!id) return;
    this.#prune(now);
    this.recentUsers.delete(id);
    this.recentUsers.set(id, now);
    this.#cap(this.recentUsers, MAX_USERS);
  }

  trackEscrow(orderId, data = {}, now = Date.now()) {
    const id = String(orderId || "").slice(0, 40);
    if (!id) return;
    this.#prune(now);
    const amount = Number(data.amountKes);
    this.escrows.set(id, {
      status: String(data.status || "prompted").slice(0, 32),
      amountKes: Number.isFinite(amount) ? amount : null,
      checkoutId: data.checkoutId ? String(data.checkoutId).slice(0, 64) : null,
      updatedAt: now,
    });
    this.#cap(this.escrows, MAX_ESCROWS);
  }

  getEscrow(orderId) {
    return this.escrows.get(String(orderId || "")) || null;
  }

  trackRider(riderId, data = {}, now = Date.now()) {
    const id = intId(riderId);
    if (!id) return;
    this.#prune(now);
    this.riders.set(id, {
      orderId: data.orderId ? String(data.orderId).slice(0, 40) : null,
      status: String(data.status || "assigned").slice(0, 32),
      updatedAt: now,
    });
    this.#cap(this.riders, MAX_RIDERS);
  }

  addVolume(amountKes, now = Date.now()) {
    this.#rollDay(now);
    const amount = Number(amountKes);
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.todayVolumeKes = Math.round((this.todayVolumeKes + amount) * 100) / 100;
  }

  noteDispute() {
    this.unresolvedDisputes += 1;
  }

  getSnapshot(now = Date.now()) {
    this.#prune(now);
    return {
      activeUsers: this.recentUsers.size,
      pendingEscrows: this.escrows.size,
      liveRiders: this.riders.size,
      todayVolumeKes: this.todayVolumeKes,
      unresolvedDisputes: this.unresolvedDisputes,
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / (1024 * 1024)),
    };
  }

  resetForTests() {
    this.recentUsers.clear();
    this.escrows.clear();
    this.riders.clear();
    this.todayVolumeKes = 0;
    this.volumeDay = dayKey(Date.now());
    this.unresolvedDisputes = 0;
  }

  #rollDay(now) {
    const day = dayKey(now);
    if (day !== this.volumeDay) {
      this.volumeDay = day;
      this.todayVolumeKes = 0;
    }
  }

  #cap(map, max) {
    while (map.size > max) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }

  #prune(now) {
    this.#rollDay(now);
    for (const [id, seen] of this.recentUsers) {
      if (now - seen > USER_TTL_MS) this.recentUsers.delete(id);
    }
    for (const [id, row] of this.escrows) {
      if (now - row.updatedAt > ESCROW_TTL_MS) this.escrows.delete(id);
    }
    for (const [id, row] of this.riders) {
      if (now - row.updatedAt > RIDER_TTL_MS) this.riders.delete(id);
    }
  }
}

export const platformState = new PlatformState();
