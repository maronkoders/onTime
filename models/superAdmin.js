const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function findByUsername(username) {
  const result = await db.query('SELECT * FROM super_admins WHERE username = $1', [username]);
  return result.rows[0] || null;
}

async function create({ username, password }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await db.query(
    'INSERT INTO super_admins (username, password_hash) VALUES ($1, $2) RETURNING *',
    [username, passwordHash]
  );
  return result.rows[0];
}

async function verifyPassword(admin, password) {
  if (!admin || !admin.password_hash) return false;
  return await bcrypt.compare(password, admin.password_hash);
}

async function updatePassword(username, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const result = await db.query(
    'UPDATE super_admins SET password_hash = $1, updated_at = NOW() WHERE username = $2 RETURNING *',
    [passwordHash, username]
  );
  return result.rows[0];
}

module.exports = {
  findByUsername,
  create,
  verifyPassword,
  updatePassword
};
