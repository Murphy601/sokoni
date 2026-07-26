import { query } from "../pool.js";

export async function ensureDefaultSeller() {
  const { rows } = await query(`SELECT id FROM sellers WHERE slug = 'sokoni-store' LIMIT 1`);
  if (rows[0]) return rows[0].id;

  const { rows: inserted } = await query(
    `INSERT INTO sellers (business_name, slug, city, is_verified, is_active)
     VALUES ($1, $2, $3, TRUE, TRUE)
     RETURNING id`,
    ["Sokoni Store", "sokoni-store", "Kenya"]
  );
  return inserted[0].id;
}

export async function getSellerBySlug(slug) {
  const { rows } = await query(`SELECT * FROM sellers WHERE slug = $1 LIMIT 1`, [slug]);
  return rows[0] || null;
}

export async function getSellerById(id) {
  const { rows } = await query(`SELECT * FROM sellers WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}
