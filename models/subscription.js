const db = require('../config/db');

async function create({ tenantId, startDate, expiryDate, subscriptionStatus = 'trial', subscriptionFeeId = null, amountPaid = null }) {
  const result = await db.query(
    `INSERT INTO subscriptions (tenant_id, start_date, expiry_date, subscription_status, subscription_fee_id, amount_paid, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING *`,
    [tenantId, startDate, expiryDate, subscriptionStatus, subscriptionFeeId, amountPaid]
  );
  return result.rows[0];
}

async function findByTenantId(tenantId) {
  const result = await db.query(
    'SELECT * FROM subscriptions WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );
  return result.rows;
}

async function findActiveByTenantId(tenantId) {
  const result = await db.query(
    `SELECT * FROM subscriptions 
     WHERE tenant_id = $1 
     AND subscription_status IN ('trial', 'active')
     AND expiry_date > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  );
  return result.rows[0] || null;
}

async function getDaysRemaining(tenantId) {
  const subscription = await findActiveByTenantId(tenantId);
  if (!subscription) return 0;
  
  const now = new Date();
  const expiry = new Date(subscription.expiry_date);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

async function getSubscriptionInfo(tenantId) {
  const subscription = await findActiveByTenantId(tenantId);
  if (!subscription) {
    return {
      hasActiveSubscription: false,
      status: 'expired',
      daysRemaining: 0,
      expiryDate: null
    };
  }
  
  const now = new Date();
  const expiry = new Date(subscription.expiry_date);
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return {
    hasActiveSubscription: true,
    status: subscription.subscription_status,
    daysRemaining: Math.max(0, diffDays),
    expiryDate: subscription.expiry_date,
    isExpiringSoon: diffDays <= 7
  };
}

async function updateStatus(subscriptionId, status) {
  const result = await db.query(
    `UPDATE subscriptions 
     SET subscription_status = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, subscriptionId]
  );
  return result.rows[0];
}

async function getExpiringSubscriptions(daysBeforeExpiry = 7) {
  const result = await db.query(
    `SELECT s.*, t.name as tenant_name, t.owner_phone
     FROM subscriptions s
     JOIN tenants t ON s.tenant_id = t.id
     WHERE s.subscription_status IN ('trial', 'active')
     AND s.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '${daysBeforeExpiry} days'
     AND (s.last_reminder_sent IS NULL OR s.last_reminder_sent < NOW() - INTERVAL '1 day')
     ORDER BY s.expiry_date ASC`
  );
  return result.rows;
}

async function markReminderSent(subscriptionId) {
  await db.query(
    'UPDATE subscriptions SET last_reminder_sent = NOW() WHERE id = $1',
    [subscriptionId]
  );
}

module.exports = {
  create,
  findByTenantId,
  findActiveByTenantId,
  getDaysRemaining,
  getSubscriptionInfo,
  updateStatus,
  getExpiringSubscriptions,
  markReminderSent
};
