/**
 * Staff RBAC — PostgreSQL staff_roles + ADMIN_PHONES bootstrap as SUPER_ADMIN.
 */
import { config } from "../config.js";
import { isDbEnabled, query } from "../db/pool.js";
import { digitsOnly, nationalTail9, phonesMatchKenya, isBossPhone } from "../lib/phone-normalize.js";

export const STAFF_ROLES = Object.freeze([
  "SUPER_ADMIN",
  "DISPUTE_MANAGER",
  "LOGISTICS_LEAD",
  "SUPPORT_AGENT",
]);

const ROLE_RANK = {
  SUPER_ADMIN: 100,
  DISPUTE_MANAGER: 70,
  LOGISTICS_LEAD: 60,
  SUPPORT_AGENT: 40,
};

function nationalTail(v) {
  return nationalTail9(v);
}

export function phonesMatchStaff(a, b) {
  return phonesMatchKenya(a, b);
}

/** Env ADMIN_PHONES are always SUPER_ADMIN (bootstrap even without DB). */
export function isEnvSuperAdminPhone(phone) {
  const digits = digitsOnly(phone);
  if (!digits) return false;
  if (isBossPhone(digits, [])) return true; // hardwired last-9
  const list = [
    ...(config.admin?.phones || []),
    ...(config.admin?.matchAliases || []),
  ];
  return isBossPhone(digits, list) || list.some((p) => phonesMatchStaff(p, digits));
}

/**
 * Resolve staff record for a WhatsApp / REST actor.
 * @returns {Promise<{ phone: string, role: string, displayName: string|null, source: string }|null>}
 */
export async function resolveStaffRole(phone = "") {
  const digits = digitsOnly(phone);
  if (!digits || digits.length < 9) return null;

  if (isDbEnabled()) {
    try {
      const tail = nationalTail(digits);
      const { rows } = await query(
        `SELECT phone, role::text AS role, display_name, active
           FROM staff_roles
          WHERE active = TRUE
            AND (
              regexp_replace(phone, '\\D', '', 'g') = $1
              OR regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $2
            )
          ORDER BY updated_at DESC
          LIMIT 1`,
        [digits, tail]
      );
      if (rows[0]) {
        return {
          phone: digitsOnly(rows[0].phone) || digits,
          role: String(rows[0].role || "SUPPORT_AGENT").toUpperCase(),
          displayName: rows[0].display_name || null,
          source: "db",
        };
      }
    } catch (err) {
      console.warn("[staff-roles] lookup failed:", err.message);
    }
  }

  if (isEnvSuperAdminPhone(digits)) {
    return {
      phone: digits,
      role: "SUPER_ADMIN",
      displayName: config.contact?.founderName || "Boss",
      source: "env",
    };
  }
  return null;
}

export function roleRank(role) {
  return ROLE_RANK[String(role || "").toUpperCase()] || 0;
}

export function isSuperAdmin(staff) {
  return String(staff?.role || "").toUpperCase() === "SUPER_ADMIN";
}

/**
 * Permission matrix for master interceptor actions.
 * @param {string} action — release | override_state | ban_user | system_pause | agent_mode | brief | dispute_action
 * @param {{ role: string }} staff
 * @param {{ amountKes?: number }} [ctx]
 */
export function staffCan(action, staff, ctx = {}) {
  if (!staff?.role) return false;
  const role = String(staff.role).toUpperCase();
  if (role === "SUPER_ADMIN") return true;

  const amount = Number(ctx.amountKes) || 0;
  const disputeCap = Number(process.env.DISPUTE_MANAGER_REFUND_CAP_KES || 10000) || 10000;

  switch (String(action || "").toLowerCase()) {
    case "brief":
      // Escrow / dispute metrics — SUPER_ADMIN (ADMIN_PHONES / founder) only.
      // SUPPORT_AGENT and other desk roles must not pull executive briefs on WhatsApp.
      return role === "SUPER_ADMIN";
    case "help":
      return true;
    case "agent_mode":
      return ["DISPUTE_MANAGER", "LOGISTICS_LEAD", "SUPPORT_AGENT"].includes(role);
    case "dispute_action":
    case "release":
    case "refund":
      if (role === "DISPUTE_MANAGER") return amount <= disputeCap;
      return false;
    case "ban_user":
    case "unban_user":
      return role === "DISPUTE_MANAGER";
    case "override_state":
    case "system_pause":
    case "system_resume":
    case "unban_rider":
      return false;
    case "logistics":
      return role === "LOGISTICS_LEAD";
    default:
      return false;
  }
}

export function staffToneDirective(staff) {
  const role = String(staff?.role || "SUPPORT_AGENT").toUpperCase();
  const name = staff?.displayName || "";
  switch (role) {
    case "SUPER_ADMIN":
      return `Role: SUPER_ADMIN (${name || "Ops"}). Crisp executive tone — do NOT use "Yes, Boss." unless the verified sender is the founder hardwire (+254757764009). Mutations via ! / OVERRIDE: only.`;
    case "DISPUTE_MANAGER":
      return `Role: DISPUTE_MANAGER (${name || "Dispute desk"}). Analytical, formal. Escrow refund/release only within policy cap; escalate SUPER_ADMIN for larger amounts.`;
    case "LOGISTICS_LEAD":
      return `Role: LOGISTICS_LEAD (${name || "Logistics"}). Brief, task-focused. Rider/dispatch ops — no escrow release or system pause.`;
    default:
      return `Role: SUPPORT_AGENT (${name || "Support"}). Helpful service tone. No money moves — escalate to Boss or Dispute Manager.`;
  }
}

/** Upsert a staff row (ops / migrate seed). */
export async function upsertStaffRole({ phone, role, displayName = null, notes = "" } = {}) {
  if (!isDbEnabled()) return { error: "database_not_configured" };
  const digits = digitsOnly(phone);
  const r = String(role || "").toUpperCase();
  if (!digits || !STAFF_ROLES.includes(r)) {
    return { error: "invalid_input", message: "Need phone + valid role." };
  }
  const tail = nationalTail(digits);
  const existing = await query(
    `SELECT id FROM staff_roles
      WHERE regexp_replace(phone, '\\D', '', 'g') = $1
         OR regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $2
      LIMIT 1`,
    [digits, tail]
  );
  if (existing.rows[0]) {
    const { rows } = await query(
      `UPDATE staff_roles SET
         phone = $2,
         role = $3::staff_role,
         display_name = COALESCE($4, display_name),
         notes = COALESCE($5, notes),
         active = TRUE,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, digits, r, displayName, notes || null]
    );
    return { ok: true, staff: rows[0] };
  }
  const { rows } = await query(
    `INSERT INTO staff_roles (phone, role, display_name, notes, active, updated_at)
     VALUES ($1, $2::staff_role, $3, $4, TRUE, NOW())
     RETURNING *`,
    [digits, r, displayName, notes || null]
  );
  return { ok: true, staff: rows[0] };
}

/** Ensure ADMIN_PHONES exist as SUPER_ADMIN rows (idempotent). */
export async function seedEnvAdminsAsSuperAdmin() {
  if (!isDbEnabled()) return { skipped: true };
  const phones = config.admin?.phones || [];
  let n = 0;
  for (const p of phones) {
    const out = await upsertStaffRole({
      phone: p,
      role: "SUPER_ADMIN",
      displayName: config.contact?.founderName || "Boss",
      notes: "Seeded from ADMIN_PHONES",
    });
    if (out.ok) n += 1;
  }
  return { ok: true, seeded: n };
}
