const db = require('../config/db');

async function getAll() {
  const result = await db.query(
    'SELECT * FROM subscription_fees ORDER BY duration_days ASC'
  );
  return result.rows;
}

async function findById(id) {
  const result = await db.query(
    'SELECT * FROM subscription_fees WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

async function create({ name, durationDays, price, description }) {
  const result = await db.query(
    `INSERT INTO subscription_fees (name, duration_days, price, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [name, durationDays, price, description]
  );
  return result.rows[0];
}

async function update(id, { name, durationDays, price, description }) {
  const result = await db.query(
    `UPDATE subscription_fees
     SET name = $1, duration_days = $2, price = $3, description = $4, updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [name, durationDays, price, description, id]
  );
  return result.rows[0] || null;
}

async function remove(id) {
  const result = await db.query(
    'DELETE FROM subscription_fees WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0] || null;
}

async function getDefaultFee() {
  const result = await db.query(
    'SELECT * FROM subscription_fees ORDER BY duration_days ASC LIMIT 1'
  );
  return result.rows[0] || null;
}

module.exports = {
  getAll,
  findById,
  create,
  update,
  remove,
  getDefaultFee,
};
