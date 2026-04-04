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

async function update(id, tenantId, { name, durationMinutes, price }) {
  // Build dynamic query based on provided fields
  const updates = [];
  const values = [];
  let paramCount = 1;
  
  if (name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(name);
  }
  if (durationMinutes !== undefined) {
    updates.push(`duration_minutes = $${paramCount++}`);
    values.push(durationMinutes);
  }
  if (price !== undefined) {
    updates.push(`price = $${paramCount++}`);
    values.push(price);
  }
  
  if (updates.length === 0) {
    return null;
  }
  
  values.push(id, tenantId);
  const query = `UPDATE services SET ${updates.join(', ')} WHERE id = $${paramCount++} AND tenant_id = $${paramCount} RETURNING *`;
  
  const result = await db.query(query, values);
  return result.rows[0] || null;
}

module.exports = {
  findByTenant,
  findById,
  create,
  remove,
  removeByName,
  update,
};
