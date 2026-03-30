const db = require('../config/db');

async function findByPhone(phone) {
  const result = await db.query('SELECT * FROM tenants WHERE owner_phone = $1', [phone]);
  return result.rows[0] || null;
}

async function findByBookingCode(code) {
  const result = await db.query('SELECT * FROM tenants WHERE booking_code = $1', [code.toUpperCase()]);
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await db.query('SELECT * FROM tenants WHERE id = $1', [id]);
  return result.rows[0] || null;
}

async function create({ name, location, ownerPhone, bookingCode, workingHours }) {
  const result = await db.query(
    `INSERT INTO tenants (name, location, owner_phone, booking_code, working_hours)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name, location, ownerPhone, bookingCode, JSON.stringify(workingHours)]
  );
  return result.rows[0];
}

async function updateWorkingHours(tenantId, workingHours) {
  const result = await db.query(
    'UPDATE tenants SET working_hours = $1 WHERE id = $2 RETURNING *',
    [JSON.stringify(workingHours), tenantId]
  );
  return result.rows[0];
}

async function getAll() {
  const result = await db.query('SELECT * FROM tenants ORDER BY id');
  return result.rows;
}

module.exports = {
  findByPhone,
  findByBookingCode,
  findById,
  create,
  updateWorkingHours,
  getAll,
};
