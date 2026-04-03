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

async function findByName(name) {
  const result = await db.query('SELECT * FROM tenants WHERE LOWER(name) = LOWER($1)', [name]);
  return result.rows[0] || null;
}

async function getAll() {
  const result = await db.query('SELECT * FROM tenants ORDER BY id');
  return result.rows;
}

// Subscription management
async function isSubscriptionValid(tenantId) {
  const tenant = await findById(tenantId);
  if (!tenant) return false;
  
  // If manually deactivated, return false
  if (tenant.is_active === false) return false;
  
  const now = new Date();
  
  // Check trial period
  if (tenant.subscription_status === 'trial' && tenant.trial_ends_at) {
    return new Date(tenant.trial_ends_at) > now;
  }
  
  // Check subscription period
  if (tenant.subscription_status === 'active' && tenant.subscription_ends_at) {
    return new Date(tenant.subscription_ends_at) > now;
  }
  
  return false;
}

function getSubscriptionStatus(tenant) {
  if (!tenant) return { valid: false, reason: 'Not found' };
  
  if (tenant.is_active === false) {
    return { valid: false, reason: 'Account deactivated' };
  }
  
  const now = new Date();
  
  if (tenant.subscription_status === 'trial') {
    if (tenant.trial_ends_at && new Date(tenant.trial_ends_at) <= now) {
      return { valid: false, reason: 'Trial expired', trialEnded: true };
    }
    return { 
      valid: true, 
      reason: 'Trial active', 
      trialEndsAt: tenant.trial_ends_at 
    };
  }
  
  if (tenant.subscription_status === 'active') {
    if (tenant.subscription_ends_at && new Date(tenant.subscription_ends_at) <= now) {
      return { valid: false, reason: 'Subscription expired', subscriptionEnded: true };
    }
    return { 
      valid: true, 
      reason: 'Subscription active', 
      subscriptionEndsAt: tenant.subscription_ends_at 
    };
  }
  
  return { valid: false, reason: 'No active subscription' };
}

async function activateTenant(tenantId) {
  const result = await db.query(
    'UPDATE tenants SET is_active = TRUE WHERE id = $1 RETURNING *',
    [tenantId]
  );
  return result.rows[0];
}

async function deactivateTenant(tenantId) {
  const result = await db.query(
    'UPDATE tenants SET is_active = FALSE WHERE id = $1 RETURNING *',
    [tenantId]
  );
  return result.rows[0];
}

async function extendTrial(tenantId, days) {
  const result = await db.query(
    `UPDATE tenants 
     SET trial_ends_at = COALESCE(trial_ends_at, NOW()) + INTERVAL '${days} days',
         subscription_status = 'trial'
     WHERE id = $1 RETURNING *`,
    [tenantId]
  );
  return result.rows[0];
}

async function activateSubscription(tenantId, days) {
  const result = await db.query(
    `UPDATE tenants 
     SET subscription_ends_at = NOW() + INTERVAL '${days} days',
         subscription_status = 'active',
         is_active = TRUE
     WHERE id = $1 RETURNING *`,
    [tenantId]
  );
  return result.rows[0];
}

module.exports = {
  findByPhone,
  findByBookingCode,
  findById,
  create,
  updateWorkingHours,
  findByName,
  getAll,
  isSubscriptionValid,
  getSubscriptionStatus,
  activateTenant,
  deactivateTenant,
  extendTrial,
  activateSubscription,
};
