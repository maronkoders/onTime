const db = require('../config/db');

async function findByPhone(phone) {
  const result = await db.query('SELECT * FROM clients WHERE phone = $1', [phone]);
  return result.rows[0] || null;
}

async function create({ phone, name, preferredTenantId }) {
  const result = await db.query(
    `INSERT INTO clients (phone, name, preferred_tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING *`,
    [phone, name, preferredTenantId]
  );
  return result.rows[0];
}

async function updateName(phone, name) {
  const result = await db.query(
    `UPDATE clients SET name = $1, updated_at = NOW() WHERE phone = $2 RETURNING *`,
    [name, phone]
  );
  return result.rows[0];
}

async function updatePreferredTenant(phone, tenantId) {
  const result = await db.query(
    `UPDATE clients SET preferred_tenant_id = $1, updated_at = NOW() WHERE phone = $2 RETURNING *`,
    [tenantId, phone]
  );
  return result.rows[0];
}

async function getOrCreate(phone, name, tenantId) {
  let client = await findByPhone(phone);
  if (!client) {
    client = await create({ phone, name, preferredTenantId: tenantId });
  } else {
    // Update preferred tenant if different
    if (tenantId && client.preferred_tenant_id !== tenantId) {
      client = await updatePreferredTenant(phone, tenantId);
    }
    // Update name if different and provided
    if (name && client.name !== name) {
      client = await updateName(phone, name);
    }
  }
  return client;
}

module.exports = {
  findByPhone,
  create,
  updateName,
  updatePreferredTenant,
  getOrCreate,
};
