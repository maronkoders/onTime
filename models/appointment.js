const db = require('../config/db');

async function create({ tenantId, clientName, clientPhone, serviceId, startTime, endTime }) {
  const result = await db.query(
    `INSERT INTO appointments (tenant_id, client_name, client_phone, service_id, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [tenantId, clientName, clientPhone, serviceId, startTime, endTime]
  );
  return result.rows[0];
}

async function findById(id) {
  const result = await db.query(
    `SELECT a.*, s.name as service_name, s.duration_minutes, s.price,
            t.name as salon_name
     FROM appointments a
     LEFT JOIN services s ON a.service_id = s.id
     LEFT JOIN tenants t ON a.tenant_id = t.id
     WHERE a.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function findByTenantAndDate(tenantId, dateStr) {
  // dateStr is YYYY-MM-DD in UTC
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;
  const result = await db.query(
    `SELECT a.*, s.name as service_name, s.duration_minutes, s.price
     FROM appointments a
     LEFT JOIN services s ON a.service_id = s.id
     WHERE a.tenant_id = $1
       AND a.start_time >= $2
       AND a.start_time <= $3
       AND a.status = 'confirmed'
     ORDER BY a.start_time`,
    [tenantId, startOfDay, endOfDay]
  );
  return result.rows;
}

async function findUpcomingByTenant(tenantId, days = 7) {
  const result = await db.query(
    `SELECT a.*, s.name as service_name, s.duration_minutes, s.price
     FROM appointments a
     LEFT JOIN services s ON a.service_id = s.id
     WHERE a.tenant_id = $1
       AND a.start_time >= NOW()
       AND a.start_time <= NOW() + INTERVAL '${days} days'
       AND a.status = 'confirmed'
     ORDER BY a.start_time`,
    [tenantId]
  );
  return result.rows;
}

async function findByClientPhone(clientPhone) {
  const result = await db.query(
    `SELECT a.*, s.name as service_name, s.duration_minutes, s.price,
            t.name as salon_name
     FROM appointments a
     LEFT JOIN services s ON a.service_id = s.id
     LEFT JOIN tenants t ON a.tenant_id = t.id
     WHERE a.client_phone = $1
       AND a.start_time >= (NOW() AT TIME ZONE 'UTC')
       AND a.status = 'confirmed'
     ORDER BY a.start_time`,
    [clientPhone]
  );
  return result.rows;
}

async function cancel(id, tenantId) {
  const result = await db.query(
    `UPDATE appointments SET status = 'cancelled'
     WHERE id = $1 AND tenant_id = $2 AND status = 'confirmed'
     RETURNING *`,
    [id, tenantId]
  );
  return result.rows[0] || null;
}

async function cancelByClient(id, clientPhone) {
  const result = await db.query(
    `UPDATE appointments SET status = 'cancelled'
     WHERE id = $1 AND client_phone = $2 AND status = 'confirmed'
     RETURNING *`,
    [id, clientPhone]
  );
  return result.rows[0] || null;
}

async function getConfirmedForTenantOnDate(tenantId, dateStr) {
  // For scheduler - get confirmed appointments for a specific date
  // dateStr should correspond to UTC range for that Harare date
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;
  const result = await db.query(
    `SELECT * FROM appointments
     WHERE tenant_id = $1
       AND start_time >= $2
       AND start_time <= $3
       AND status = 'confirmed'
     ORDER BY start_time`,
    [tenantId, startOfDay, endOfDay]
  );
  return result.rows;
}

async function findByTenant(tenantId) {
  const result = await db.query(
    `SELECT a.*, s.name as service_name, s.duration_minutes, s.price
     FROM appointments a
     LEFT JOIN services s ON a.service_id = s.id
     WHERE a.tenant_id = $1
     ORDER BY a.start_time DESC`,
    [tenantId]
  );
  return result.rows;
}

async function findUpcomingByClientPhone(clientPhone) {
  const result = await db.query(
    `SELECT a.*, s.name as service_name, s.duration_minutes, s.price,
            t.name as salon_name, t.booking_code
     FROM appointments a
     LEFT JOIN services s ON a.service_id = s.id
     LEFT JOIN tenants t ON a.tenant_id = t.id
     WHERE a.client_phone = $1
       AND a.start_time >= NOW()
       AND a.status = 'confirmed'
     ORDER BY a.start_time
     LIMIT 1`,
    [clientPhone]
  );
  return result.rows[0] || null;
}

async function reschedule(appointmentId, { newDate, newStartTime, newEndTime }) {
  const result = await db.query(
    `UPDATE appointments 
     SET start_time = $1, end_time = $2, updated_at = NOW()
     WHERE id = $3 AND status = 'confirmed'
     RETURNING *`,
    [newStartTime, newEndTime, appointmentId]
  );
  return result.rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByTenant,
  findByTenantAndDate,
  findUpcomingByTenant,
  findByClientPhone,
  findUpcomingByClientPhone,
  reschedule,
  cancel,
  cancelByClient,
  getConfirmedForTenantOnDate,
};
