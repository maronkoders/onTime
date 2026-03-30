const db = require('../config/db');

async function findByTenant(tenantId) {
  const result = await db.query(
    'SELECT * FROM services WHERE tenant_id = $1 ORDER BY id',
    [tenantId]
  );
  return result.rows;
}

async function findById(id) {
  const result = await db.query('SELECT * FROM services WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function create({ tenantId, name, durationMinutes, price }) {
  const result = await db.query(
    `INSERT INTO services (tenant_id, name, duration_minutes, price)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [tenantId, name, durationMinutes, price]
  );
  return result.rows[0];
}

async function remove(id, tenantId) {
  const result = await db.query(
    'DELETE FROM services WHERE id = $1 AND tenant_id = $2 RETURNING *',
    [id, tenantId]
  );
  return result.rows[0] || null;
}

async function removeByName(name, tenantId) {
  const result = await db.query(
    'DELETE FROM services WHERE LOWER(name) = LOWER($1) AND tenant_id = $2 RETURNING *',
    [name, tenantId]
  );
  return result.rows[0] || null;
}

module.exports = {
  findByTenant,
  findById,
  create,
  remove,
  removeByName,
};
