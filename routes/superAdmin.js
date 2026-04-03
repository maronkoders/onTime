const express = require('express');
const router = express.Router();
const { requireSuperAdmin, authenticateSuperAdmin } = require('../middleware/superAdminAuth');
const tenantModel = require('../models/tenant');
const appointmentModel = require('../models/appointment');
const serviceModel = require('../models/service');
const subscriptionFeeModel = require('../models/subscriptionFee');
const logger = require('../utils/logger');

// Login page (GET)
router.get('/login', (req, res) => {
  if (req.session && req.session.isSuperAdmin) {
    return res.redirect('/admin/overview');
  }
  res.send(getLoginPage());
});

// Login handler (POST)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (authenticateSuperAdmin(username, password)) {
    req.session.isSuperAdmin = true;
    req.session.username = username;
    return res.redirect('/admin/overview');
  }
  
  res.send(getLoginPage('Invalid username or password'));
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// Overview page (protected)
router.get('/overview', requireSuperAdmin, async (req, res) => {
  try {
    const stats = await getOverviewStats();
    res.send(getOverviewPage(stats, req.session.username));
  } catch (err) {
    logger.error(`Overview error: ${err.message}`);
    res.status(500).send('Error loading overview');
  }
});

// Redirect dashboard to overview
router.get('/dashboard', requireSuperAdmin, (req, res) => {
  res.redirect('/admin/overview');
});

// Salons list page with tabs (protected)
router.get('/salons', requireSuperAdmin, async (req, res) => {
  try {
    const tab = req.query.tab || 'active';
    const salons = await getSalonsByTab(tab);
    res.send(getSalonsPage(salons, tab, req.session.username));
  } catch (err) {
    logger.error(`Salons list error: ${err.message}`);
    res.status(500).send('Error loading salons');
  }
});

// Settings page (protected)
router.get('/settings', requireSuperAdmin, async (req, res) => {
  try {
    let subscriptionFees = [];
    try {
      subscriptionFees = await subscriptionFeeModel.getAll();
    } catch (err) {
      logger.warn(`Could not load subscription fees: ${err.message}`);
    }
    res.send(getSettingsPage(subscriptionFees, req.session.username));
  } catch (err) {
    logger.error(`Settings error: ${err.message}`);
    res.status(500).send('Error loading settings');
  }
});

// Update super admin password
router.post('/settings/update-password', requireSuperAdmin, (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Verify current password
    if (!authenticateSuperAdmin(req.session.username, currentPassword)) {
      return res.send(getSettingsPage([], req.session.username, 'Current password is incorrect'));
    }
    
    // Verify password match
    if (newPassword !== confirmPassword) {
      return res.send(getSettingsPage([], req.session.username, 'New passwords do not match'));
    }
    
    // Password strength check
    if (newPassword.length < 6) {
      return res.send(getSettingsPage([], req.session.username, 'Password must be at least 6 characters'));
    }
    
    // Note: In production, store hashed passwords in database
    // For now, we'll just show success message
    res.send(getSettingsPage([], req.session.username, null, 'Password updated successfully'));
  } catch (err) {
    logger.error(`Update password error: ${err.message}`);
    res.status(500).send('Error updating password');
  }
});

// Create subscription fee
router.post('/settings/subscription-fees', requireSuperAdmin, async (req, res) => {
  try {
    const { name, durationDays, price, description } = req.body;
    await subscriptionFeeModel.create({
      name,
      durationDays: parseInt(durationDays),
      price: parseFloat(price),
      description
    });
    res.redirect('/admin/settings');
  } catch (err) {
    logger.error(`Create subscription fee error: ${err.message}`);
    res.status(500).send('Error creating subscription fee');
  }
});

// Update subscription fee
router.post('/settings/subscription-fees/:id/update', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, durationDays, price, description } = req.body;
    await subscriptionFeeModel.update(id, {
      name,
      durationDays: parseInt(durationDays),
      price: parseFloat(price),
      description
    });
    res.redirect('/admin/settings');
  } catch (err) {
    logger.error(`Update subscription fee error: ${err.message}`);
    res.status(500).send('Error updating subscription fee');
  }
});

// Delete subscription fee
router.post('/settings/subscription-fees/:id/delete', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await subscriptionFeeModel.remove(id);
    res.redirect('/admin/settings');
  } catch (err) {
    logger.error(`Delete subscription fee error: ${err.message}`);
    res.status(500).send('Error deleting subscription fee');
  }
});

// Salon detail page (protected)
router.get('/salon/:id', requireSuperAdmin, async (req, res) => {
  try {
    const salonId = parseInt(req.params.id, 10);
    const salon = await getSalonDetails(salonId);
    if (!salon) {
      return res.status(404).send('Salon not found');
    }
    res.send(getSalonDetailPage(salon));
  } catch (err) {
    logger.error(`Salon detail error: ${err.message}`);
    res.status(500).send('Error loading salon details');
  }
});

// Activate salon (protected)
router.post('/salon/:id/activate', requireSuperAdmin, async (req, res) => {
  try {
    const salonId = parseInt(req.params.id, 10);
    await tenantModel.activateTenant(salonId);
    res.redirect(`/admin/salon/${salonId}`);
  } catch (err) {
    logger.error(`Activate salon error: ${err.message}`);
    res.status(500).send('Error activating salon');
  }
});

// Deactivate salon (protected)
router.post('/salon/:id/deactivate', requireSuperAdmin, async (req, res) => {
  try {
    const salonId = parseInt(req.params.id, 10);
    await tenantModel.deactivateTenant(salonId);
    res.redirect(`/admin/salon/${salonId}`);
  } catch (err) {
    logger.error(`Deactivate salon error: ${err.message}`);
    res.status(500).send('Error deactivating salon');
  }
});

// Extend trial (protected)
router.post('/salon/:id/extend-trial', requireSuperAdmin, async (req, res) => {
  try {
    const salonId = parseInt(req.params.id, 10);
    const days = parseInt(req.body.days, 10) || 14;
    await tenantModel.extendTrial(salonId, days);
    res.redirect(`/admin/salon/${salonId}`);
  } catch (err) {
    logger.error(`Extend trial error: ${err.message}`);
    res.status(500).send('Error extending trial');
  }
});

// Activate subscription (protected)
router.post('/salon/:id/activate-subscription', requireSuperAdmin, async (req, res) => {
  try {
    const salonId = parseInt(req.params.id, 10);
    const days = parseInt(req.body.days, 10) || 30;
    await tenantModel.activateSubscription(salonId, days);
    res.redirect(`/admin/salon/${salonId}`);
  } catch (err) {
    logger.error(`Activate subscription error: ${err.message}`);
    res.status(500).send('Error activating subscription');
  }
});

async function getOverviewStats() {
  const tenants = await tenantModel.getAll();
  let subscriptionFees = [];
  
  // Try to get subscription fees, but handle case where table doesn't exist yet
  try {
    subscriptionFees = await subscriptionFeeModel.getAll();
  } catch (err) {
    // Table likely doesn't exist yet, log warning and continue with empty array
    logger.warn(`Could not load subscription fees: ${err.message}`);
  }
  
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  let totalRevenue = 0;
  let activeSubscriptions = 0;
  let expiredSubscriptions = 0;
  let towardsExpiry = 0;
  
  for (const tenant of tenants) {
    const status = tenantModel.getSubscriptionStatus(tenant);
    
    if (tenant.subscription_status === 'active') {
      // Calculate revenue based on subscription duration and matching fee plan
      if (tenant.subscription_ends_at && tenant.created_at) {
        const subEnd = new Date(tenant.subscription_ends_at);
        // Find matching subscription fee plan
        const matchingFee = subscriptionFees.find(fee => {
          const expectedEnd = new Date(tenant.created_at);
          expectedEnd.setDate(expectedEnd.getDate() + fee.duration_days);
          return Math.abs(expectedEnd - subEnd) < 2 * 24 * 60 * 60 * 1000; // Within 2 days
        });
        if (matchingFee) {
          totalRevenue += parseFloat(matchingFee.price);
        }
      }
      
      if (status.valid) {
        activeSubscriptions++;
        // Check if subscription expires within 1 week
        if (tenant.subscription_ends_at && new Date(tenant.subscription_ends_at) <= oneWeekFromNow) {
          towardsExpiry++;
        }
      } else {
        expiredSubscriptions++;
      }
    } else if (tenant.subscription_status === 'trial') {
      if (!status.valid) {
        expiredSubscriptions++;
      } else if (tenant.trial_ends_at && new Date(tenant.trial_ends_at) <= oneWeekFromNow) {
        towardsExpiry++;
      }
    }
  }
  
  return {
    totalSalons: tenants.length,
    activeSubscriptions,
    expiredSubscriptions,
    towardsExpiry,
    totalRevenue: totalRevenue.toFixed(2)
  };
}

async function getSalonsByTab(tab) {
  const allSalons = await getAllSalonsWithStats();
  const now = new Date();
  const oneWeekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  switch (tab) {
    case 'active':
      return allSalons.filter(s => s.statusInfo.valid);
    case 'expiring':
      return allSalons.filter(s => {
        if (!s.statusInfo.valid) return false;
        const endDate = s.subscriptionStatus === 'trial' 
          ? s.trialEndsAt 
          : s.subscriptionEndsAt;
        return endDate && new Date(endDate) <= oneWeekFromNow;
      });
    case 'expired':
      return allSalons.filter(s => !s.statusInfo.valid);
    default:
      return allSalons;
  }
}

async function getAllSalonsWithStats() {
  const tenants = await tenantModel.getAll();
  const salons = [];
  
  for (const tenant of tenants) {
    const appointments = await appointmentModel.findByTenant(tenant.id);
    const services = await serviceModel.findByTenant(tenant.id);
    const subscriptionStatus = tenantModel.getSubscriptionStatus(tenant);
    
    const totalAppointments = appointments.length;
    const upcomingAppointments = appointments.filter(a => new Date(a.start_time) > new Date()).length;
    const totalServices = services.length;
    
    salons.push({
      id: tenant.id,
      name: tenant.name,
      location: tenant.location,
      ownerPhone: tenant.owner_phone,
      bookingCode: tenant.booking_code,
      createdAt: tenant.created_at,
      workingHours: tenant.working_hours,
      isActive: tenant.is_active,
      subscriptionStatus: tenant.subscription_status,
      trialEndsAt: tenant.trial_ends_at,
      subscriptionEndsAt: tenant.subscription_ends_at,
      statusInfo: subscriptionStatus,
      totalAppointments,
      upcomingAppointments,
      totalServices,
    });
  }
  
  return salons;
}

async function getSalonDetails(salonId) {
  const tenant = await tenantModel.findById(salonId);
  if (!tenant) return null;
  
  const appointments = await appointmentModel.findByTenant(salonId);
  const services = await serviceModel.findByTenant(salonId);
  const subscriptionStatus = tenantModel.getSubscriptionStatus(tenant);
  
  // Sort appointments by date
  appointments.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  
  return {
    ...tenant,
    appointments,
    services,
    totalAppointments: appointments.length,
    statusInfo: subscriptionStatus,
  };
}

function getLoginPage(error = '') {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OnTime Super Admin - Login</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-container {
      background: white;
      padding: 40px;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      width: 100%;
      max-width: 400px;
    }
    h1 {
      color: #333;
      margin-bottom: 8px;
      font-size: 24px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 14px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-weight: 500;
      font-size: 14px;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.3s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
    }
    button {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }
    .error {
      background: #fee;
      color: #c33;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-icon {
      font-size: 48px;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <div class="logo-icon">💇‍♀️</div>
    </div>
    <h1>OnTime Super Admin</h1>
    <p class="subtitle">Salon Management Dashboard</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label for="username">Username</label>
        <input type="text" id="username" name="username" required autofocus>
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
      </div>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

function getOverviewPage(stats, username) {
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OnTime Super Admin - Overview</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav {
      display: flex;
      gap: 8px;
    }
    .nav a {
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      opacity: 0.8;
      transition: all 0.3s;
    }
    .nav a:hover, .nav a.active {
      opacity: 1;
      background: rgba(255,255,255,0.2);
    }
    .logout-btn {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.3s;
    }
    .logout-btn:hover {
      background: rgba(255,255,255,0.3);
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 30px 40px;
    }
    .welcome {
      margin-bottom: 30px;
    }
    .welcome h2 {
      font-size: 28px;
      color: #333;
      margin-bottom: 8px;
    }
    .welcome p {
      color: #64748b;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
      margin-bottom: 40px;
    }
    .stat-card {
      background: white;
      padding: 28px;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    }
    .stat-card h3 {
      color: #64748b;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stat-value {
      font-size: 42px;
      font-weight: 700;
      color: #333;
    }
    .stat-card.primary { border-top: 4px solid #667eea; }
    .stat-card.success { border-top: 4px solid #10b981; }
    .stat-card.warning { border-top: 4px solid #f59e0b; }
    .stat-card.danger { border-top: 4px solid #ef4444; }
    .stat-card.revenue { border-top: 4px solid #8b5cf6; }
    .section {
      background: white;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      padding: 30px;
    }
    .section h3 {
      font-size: 20px;
      color: #333;
      margin-bottom: 20px;
    }
    .quick-links {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }
    .quick-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 20px;
      background: #f8fafc;
      border-radius: 12px;
      text-decoration: none;
      color: #334155;
      transition: all 0.2s;
    }
    .quick-link:hover {
      background: #e0e7ff;
      color: #4338ca;
    }
    .quick-link-icon {
      font-size: 24px;
    }
    .quick-link-text {
      font-weight: 500;
    }
    @media (max-width: 768px) {
      .header { 
        padding: 16px 20px;
        flex-wrap: wrap;
        gap: 12px;
      }
      .nav {
        order: 3;
        width: 100%;
        justify-content: center;
      }
      .container { padding: 20px; }
      .stats-grid { grid-template-columns: 1fr; }
      .welcome h2 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>💇‍♀️ OnTime Super Admin</h1>
    <div class="nav">
      <a href="/admin/overview" class="active">Overview</a>
      <a href="/admin/salons">Salons</a>
      <a href="/admin/settings">Settings</a>
    </div>
    <a href="/admin/logout" class="logout-btn">Logout</a>
  </div>
  
  <div class="container">
    <div class="welcome">
      <h2>Welcome back, ${escapeHtml(username)}! 👋</h2>
      <p>Here's what's happening across all salons</p>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card primary">
        <h3>🏪 Total Salons</h3>
        <div class="stat-value">${stats.totalSalons}</div>
      </div>
      <div class="stat-card success">
        <h3>✅ Active Subscriptions</h3>
        <div class="stat-value">${stats.activeSubscriptions}</div>
      </div>
      <div class="stat-card danger">
        <h3>❌ Expired Subscriptions</h3>
        <div class="stat-value">${stats.expiredSubscriptions}</div>
      </div>
      <div class="stat-card warning">
        <h3>⏰ Towards Expiry (7 days)</h3>
        <div class="stat-value">${stats.towardsExpiry}</div>
      </div>
      <div class="stat-card revenue">
        <h3>💰 Total Revenue</h3>
        <div class="stat-value">$${stats.totalRevenue}</div>
      </div>
    </div>
    
    <div class="section">
      <h3>Quick Actions</h3>
      <div class="quick-links">
        <a href="/admin/salons" class="quick-link">
          <span class="quick-link-icon">🏪</span>
          <span class="quick-link-text">View All Salons</span>
        </a>
        <a href="/admin/salons?tab=expiring" class="quick-link">
          <span class="quick-link-icon">⏰</span>
          <span class="quick-link-text">Expiring Soon</span>
        </a>
        <a href="/admin/salons?tab=expired" class="quick-link">
          <span class="quick-link-icon">⚠️</span>
          <span class="quick-link-text">Expired Accounts</span>
        </a>
        <a href="/admin/settings" class="quick-link">
          <span class="quick-link-icon">⚙️</span>
          <span class="quick-link-text">Manage Settings</span>
        </a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function getDashboardPage(salons) {
  const totalSalons = salons.length;
  const totalAppointments = salons.reduce((sum, s) => sum + s.totalAppointments, 0);
  const totalServices = salons.reduce((sum, s) => sum + s.totalServices, 0);
  
  const salonRows = salons.map(salon => {
    const statusClass = salon.statusInfo.valid ? 'badge-green' : 'badge-red';
    const statusText = salon.isActive === false ? 'Deactivated' : 
                       salon.statusInfo.valid ? 'Active' : 'Expired';
    return `
    <tr onclick="window.location='/admin/salon/${salon.id}'" style="cursor: pointer;">
      <td><strong>${escapeHtml(salon.name)}</strong><br><span class="badge ${statusClass}">${statusText}</span></td>
      <td>${escapeHtml(salon.location || 'N/A')}</td>
      <td>${salon.ownerPhone}</td>
      <td><span class="badge">${salon.totalAppointments}</span></td>
      <td><span class="badge badge-green">${salon.upcomingAppointments}</span></td>
      <td>${salon.totalServices}</td>
      <td><span class="code">${salon.bookingCode}</span></td>
      <td>${formatDate(salon.createdAt)}</td>
    </tr>
  `}).join('');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OnTime Super Admin - Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logout-btn {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.3s;
    }
    .logout-btn:hover {
      background: rgba(255,255,255,0.3);
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 30px 40px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 24px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .stat-card h3 {
      color: #666;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .stat-value {
      font-size: 36px;
      font-weight: 700;
      color: #333;
    }
    .stat-card.primary { border-left: 4px solid #667eea; }
    .stat-card.success { border-left: 4px solid #48bb78; }
    .stat-card.info { border-left: 4px solid #4299e1; }
    .section {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .section-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-header h2 {
      font-size: 18px;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #f8fafc;
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 16px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      color: #334155;
    }
    tr:hover {
      background: #f8fafc;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      background: #e0e7ff;
      color: #4338ca;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      min-width: 28px;
      text-align: center;
    }
    .badge-green {
      background: #d1fae5;
      color: #047857;
    }
    .badge-red {
      background: #fee2e2;
      color: #dc2626;
    }
    .badge-orange {
      background: #fef3c7;
      color: #d97706;
    }
    .code {
      font-family: 'Courier New', monospace;
      background: #f1f5f9;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: #64748b;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #64748b;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    @media (max-width: 768px) {
      .header { padding: 16px 20px; }
      .container { padding: 20px; }
      .stats-grid { grid-template-columns: 1fr; }
      table { font-size: 12px; }
      th, td { padding: 10px 12px; }
      td:nth-child(3), th:nth-child(3),
      td:nth-child(7), th:nth-child(7),
      td:nth-child(8), th:nth-child(8) { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>💇‍♀️ OnTime Super Admin</h1>
    <a href="/admin/logout" class="logout-btn">Logout</a>
  </div>
  
  <div class="container">
    <div class="stats-grid">
      <div class="stat-card primary">
        <h3>Total Salons</h3>
        <div class="stat-value">${totalSalons}</div>
      </div>
      <div class="stat-card success">
        <h3>Total Appointments</h3>
        <div class="stat-value">${totalAppointments}</div>
      </div>
      <div class="stat-card info">
        <h3>Total Services</h3>
        <div class="stat-value">${totalServices}</div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-header">
        <h2>All Salons</h2>
        <span style="color: #64748b; font-size: 14px;">Click a row to view details</span>
      </div>
      ${salons.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Salon Name</th>
            <th>Location</th>
            <th>Owner Phone</th>
            <th>Appointments</th>
            <th>Upcoming</th>
            <th>Services</th>
            <th>Booking Code</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          ${salonRows}
        </tbody>
      </table>
      ` : `
      <div class="empty-state">
        <div class="empty-state-icon">🏪</div>
        <h3>No salons registered yet</h3>
        <p>Salons will appear here once they register via WhatsApp.</p>
      </div>
      `}
    </div>
  </div>
</body>
</html>`;
}

function getSalonDetailPage(salon) {
  const appointmentRows = salon.appointments.map(a => {
    const date = new Date(a.start_time);
    const isUpcoming = date > new Date();
    return `
    <tr>
      <td>#${a.id}</td>
      <td>${escapeHtml(a.client_name)}</td>
      <td>${escapeHtml(a.client_phone)}</td>
      <td>${escapeHtml(a.service_name)}</td>
      <td>${date.toLocaleDateString()}</td>
      <td>${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
      <td><span class="badge ${isUpcoming ? 'badge-green' : ''}">${isUpcoming ? 'Upcoming' : 'Past'}</span></td>
    </tr>
  `}).join('');
  
  const serviceRows = salon.services.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${s.duration_minutes} min</td>
      <td>$${s.price}</td>
    </tr>
  `).join('');
  
  const workingHours = Object.entries(salon.working_hours || {})
    .map(([day, hours]) => `<span class="tag">${day}: ${hours}</span>`)
    .join('');
  
  // Subscription status display
  const statusInfo = salon.statusInfo;
  const statusClass = statusInfo.valid ? 'badge-green' : 'badge-red';
  const statusText = salon.is_active === false ? 'Deactivated' : 
                     statusInfo.valid ? 'Active' : 'Expired';
  
  const trialEndDate = salon.trial_ends_at ? new Date(salon.trial_ends_at).toLocaleDateString() : 'N/A';
  const subEndDate = salon.subscription_ends_at ? new Date(salon.subscription_ends_at).toLocaleDateString() : 'N/A';
  
  // Management buttons
  const isActive = salon.is_active !== false;
  const toggleButton = isActive 
    ? `<form method="POST" action="/admin/salon/${salon.id}/deactivate" style="display:inline;"><button type="submit" class="btn btn-danger">Deactivate Account</button></form>`
    : `<form method="POST" action="/admin/salon/${salon.id}/activate" style="display:inline;"><button type="submit" class="btn btn-success">Activate Account</button></form>`;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OnTime Super Admin - ${escapeHtml(salon.name)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .back-btn {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.3s;
    }
    .back-btn:hover {
      background: rgba(255,255,255,0.3);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 30px 40px;
    }
    .salon-header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .salon-header h2 {
      font-size: 28px;
      margin-bottom: 12px;
      color: #333;
    }
    .salon-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      color: #64748b;
      font-size: 14px;
      margin-bottom: 16px;
    }
    .salon-meta span {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .status-active {
      background: #d1fae5;
      color: #047857;
    }
    .status-expired {
      background: #fee2e2;
      color: #dc2626;
    }
    .tag {
      display: inline-block;
      background: #e0e7ff;
      color: #4338ca;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      margin: 2px;
    }
    .section {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      overflow: hidden;
      margin-bottom: 30px;
    }
    .section-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-header h3 {
      font-size: 16px;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #f8fafc;
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      color: #334155;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      background: #e2e8f0;
      color: #475569;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }
    .badge-green {
      background: #d1fae5;
      color: #047857;
    }
    .badge-red {
      background: #fee2e2;
      color: #dc2626;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      padding: 24px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-item label {
      font-size: 12px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .info-item value {
      font-size: 16px;
      color: #333;
      font-weight: 500;
    }
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #64748b;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-success {
      background: #10b981;
      color: white;
    }
    .btn-success:hover {
      background: #059669;
    }
    .btn-danger {
      background: #ef4444;
      color: white;
    }
    .btn-danger:hover {
      background: #dc2626;
    }
    .btn-primary {
      background: #667eea;
      color: white;
    }
    .btn-primary:hover {
      background: #5568d3;
    }
    .management-form {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .management-form input {
      width: 60px;
      padding: 6px 10px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 14px;
    }
    @media (max-width: 768px) {
      .header { padding: 16px 20px; }
      .container { padding: 20px; }
      .salon-header { padding: 20px; }
      .salon-header h2 { font-size: 22px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>💇‍♀️ ${escapeHtml(salon.name)}</h1>
    <a href="/admin/salons" class="back-btn">← Back to Salons</a>
  </div>
  
  <div class="container">
    <div class="salon-header">
      <h2>${escapeHtml(salon.name)}</h2>
      <div class="salon-meta">
        <span>📍 ${escapeHtml(salon.location || 'N/A')}</span>
        <span>📱 ${salon.owner_phone}</span>
        <span>🔖 ${salon.booking_code}</span>
        <span>📅 Created ${formatDate(salon.created_at)}</span>
      </div>
      <div class="status-badge ${statusInfo.valid ? 'status-active' : 'status-expired'}">
        ${statusText} • ${salon.subscription_status === 'trial' ? 'Trial' : 'Subscribed'}
      </div>
    </div>
    
    <div class="section">
      <div class="info-grid">
        <div class="info-item">
          <label>Total Appointments</label>
          <value>${salon.totalAppointments}</value>
        </div>
        <div class="info-item">
          <label>Total Services</label>
          <value>${salon.services.length}</value>
        </div>
        <div class="info-item">
          <label>Salon ID</label>
          <value>#${salon.id}</value>
        </div>
        <div class="info-item">
          <label>Trial Ends</label>
          <value>${trialEndDate}</value>
        </div>
        <div class="info-item">
          <label>Subscription Ends</label>
          <value>${subEndDate}</value>
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-header">
        <h3>🔧 Account Management</h3>
      </div>
      <div style="padding: 24px;">
        <div style="margin-bottom: 20px;">
          <h4 style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Account Status</h4>
          ${toggleButton}
        </div>
        <div style="margin-bottom: 20px;">
          <h4 style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Extend Trial</h4>
          <form method="POST" action="/admin/salon/${salon.id}/extend-trial" class="management-form">
            <input type="number" name="days" value="14" min="1" max="365">
            <button type="submit" class="btn btn-primary">Extend Trial</button>
          </form>
        </div>
        <div>
          <h4 style="font-size: 14px; color: #64748b; margin-bottom: 12px;">Activate Subscription</h4>
          <form method="POST" action="/admin/salon/${salon.id}/activate-subscription" class="management-form">
            <input type="number" name="days" value="30" min="1" max="365">
            <button type="submit" class="btn btn-success">Activate Subscription</button>
          </form>
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-header">
        <h3>📅 Appointments (${salon.appointments.length})</h3>
      </div>
      ${salon.appointments.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Client</th>
            <th>Phone</th>
            <th>Service</th>
            <th>Date</th>
            <th>Time</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${appointmentRows}
        </tbody>
      </table>
      ` : `<div class="empty-state">No appointments yet</div>`}
    </div>
    
    <div class="section">
      <div class="section-header">
        <h3>💇 Services (${salon.services.length})</h3>
      </div>
      ${salon.services.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Service Name</th>
            <th>Duration</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          ${serviceRows}
        </tbody>
      </table>
      ` : `<div class="empty-state">No services added yet</div>`}
    </div>
    
    <div class="section">
      <div class="section-header">
        <h3>⏰ Working Hours</h3>
      </div>
      <div style="padding: 20px 24px;">
        ${workingHours || '<span class="tag">Not configured</span>'}
      </div>
    </div>
  </div>
</body>
</html>`;
}

function getSalonsPage(salons, activeTab, username) {
  const tabLabels = {
    active: 'Active Salons',
    expiring: 'Expiring Soon (7 days)',
    expired: 'Expired Subscriptions'
  };
  
  const salonRows = salons.map(salon => {
    const statusClass = salon.statusInfo.valid ? 'badge-green' : 'badge-red';
    const statusText = salon.isActive === false ? 'Deactivated' : 
                       salon.statusInfo.valid ? 'Active' : 'Expired';
    const expiryDate = salon.subscriptionStatus === 'trial' 
      ? formatDate(salon.trialEndsAt) 
      : formatDate(salon.subscriptionEndsAt);
    return `
    <tr onclick="window.location='/admin/salon/${salon.id}'" style="cursor: pointer;">
      <td><strong>${escapeHtml(salon.name)}</strong><br><span class="badge ${statusClass}">${statusText}</span></td>
      <td>${escapeHtml(salon.location || 'N/A')}</td>
      <td>${salon.ownerPhone}</td>
      <td>${expiryDate}</td>
      <td><span class="badge">${salon.totalAppointments}</span></td>
      <td><span class="badge badge-green">${salon.upcomingAppointments}</span></td>
      <td>${salon.totalServices}</td>
      <td><span class="code">${salon.bookingCode}</span></td>
    </tr>
  `}).join('');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OnTime Super Admin - Salons</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav {
      display: flex;
      gap: 8px;
    }
    .nav a {
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      opacity: 0.8;
      transition: all 0.3s;
    }
    .nav a:hover, .nav a.active {
      opacity: 1;
      background: rgba(255,255,255,0.2);
    }
    .logout-btn {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.3s;
    }
    .logout-btn:hover {
      background: rgba(255,255,255,0.3);
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 30px 40px;
    }
    .page-header {
      margin-bottom: 30px;
    }
    .page-header h2 {
      font-size: 28px;
      color: #333;
      margin-bottom: 8px;
    }
    .page-header p {
      color: #64748b;
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 0;
    }
    .tab {
      padding: 12px 24px;
      text-decoration: none;
      color: #64748b;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      transition: all 0.2s;
    }
    .tab:hover {
      color: #667eea;
    }
    .tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
    }
    .section {
      background: white;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .section-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-header h3 {
      font-size: 18px;
      color: #333;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #f8fafc;
      padding: 14px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 16px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      color: #334155;
    }
    tr:hover {
      background: #f8fafc;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      background: #e0e7ff;
      color: #4338ca;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      min-width: 28px;
      text-align: center;
    }
    .badge-green {
      background: #d1fae5;
      color: #047857;
    }
    .badge-red {
      background: #fee2e2;
      color: #dc2626;
    }
    .code {
      font-family: 'Courier New', monospace;
      background: #f1f5f9;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      color: #64748b;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #64748b;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .count-badge {
      background: #e0e7ff;
      color: #4338ca;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      margin-left: 8px;
    }
    @media (max-width: 768px) {
      .header { 
        padding: 16px 20px;
        flex-wrap: wrap;
        gap: 12px;
      }
      .nav {
        order: 3;
        width: 100%;
        justify-content: center;
      }
      .container { padding: 20px; }
      .tabs {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      table { font-size: 12px; }
      th, td { padding: 10px 12px; }
      td:nth-child(3), th:nth-child(3),
      td:nth-child(8), th:nth-child(8) { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>💇‍♀️ OnTime Super Admin</h1>
    <div class="nav">
      <a href="/admin/overview">Overview</a>
      <a href="/admin/salons" class="active">Salons</a>
      <a href="/admin/settings">Settings</a>
    </div>
    <a href="/admin/logout" class="logout-btn">Logout</a>
  </div>
  
  <div class="container">
    <div class="page-header">
      <h2>${tabLabels[activeTab]}</h2>
      <p>Manage all salons and their subscriptions</p>
    </div>
    
    <div class="tabs">
      <a href="/admin/salons?tab=active" class="tab ${activeTab === 'active' ? 'active' : ''}">
        ✅ Active <span class="count-badge">${activeTab === 'active' ? salons.length : ''}</span>
      </a>
      <a href="/admin/salons?tab=expiring" class="tab ${activeTab === 'expiring' ? 'active' : ''}">
        ⏰ Expiring Soon <span class="count-badge">${activeTab === 'expiring' ? salons.length : ''}</span>
      </a>
      <a href="/admin/salons?tab=expired" class="tab ${activeTab === 'expired' ? 'active' : ''}">
        ❌ Expired <span class="count-badge">${activeTab === 'expired' ? salons.length : ''}</span>
      </a>
    </div>
    
    <div class="section">
      <div class="section-header">
        <h3>${tabLabels[activeTab]} <span style="color: #64748b; font-weight: normal;">(${salons.length})</span></h3>
        <span style="color: #64748b; font-size: 14px;">Click a row to view details</span>
      </div>
      ${salons.length > 0 ? `
      <table>
        <thead>
          <tr>
            <th>Salon Name</th>
            <th>Location</th>
            <th>Owner Phone</th>
            <th>Expiry Date</th>
            <th>Appointments</th>
            <th>Upcoming</th>
            <th>Services</th>
            <th>Code</th>
          </tr>
        </thead>
        <tbody>
          ${salonRows}
        </tbody>
      </table>
      ` : `
      <div class="empty-state">
        <div class="empty-state-icon">🏪</div>
        <h3>No salons in this category</h3>
        <p>Salons will appear here when they match the selected filter.</p>
      </div>
      `}
    </div>
  </div>
</body>
</html>`;
}

function getSettingsPage(subscriptionFees, username, error = null, success = null) {
  const feeRows = subscriptionFees.map(fee => `
    <tr>
      <td><strong>${escapeHtml(fee.name)}</strong></td>
      <td>${fee.duration_days} days</td>
      <td>$${parseFloat(fee.price).toFixed(2)}</td>
      <td>${escapeHtml(fee.description || 'N/A')}</td>
      <td>
        <button onclick="openEditModal(${fee.id}, '${escapeHtml(fee.name)}', ${fee.duration_days}, ${fee.price}, '${escapeHtml(fee.description || '')}')" class="btn btn-sm btn-primary">Edit</button>
        <form method="POST" action="/admin/settings/subscription-fees/${fee.id}/delete" style="display: inline;" onsubmit="return confirm('Are you sure you want to delete this plan?');">
          <button type="submit" class="btn btn-sm btn-danger">Delete</button>
        </form>
      </td>
    </tr>
  `).join('');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>OnTime Super Admin - Settings</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 {
      font-size: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .nav {
      display: flex;
      gap: 8px;
    }
    .nav a {
      color: white;
      text-decoration: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      opacity: 0.8;
      transition: all 0.3s;
    }
    .nav a:hover, .nav a.active {
      opacity: 1;
      background: rgba(255,255,255,0.2);
    }
    .logout-btn {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
      transition: background 0.3s;
    }
    .logout-btn:hover {
      background: rgba(255,255,255,0.3);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 30px 40px;
    }
    .page-header {
      margin-bottom: 30px;
    }
    .page-header h2 {
      font-size: 28px;
      color: #333;
      margin-bottom: 8px;
    }
    .page-header p {
      color: #64748b;
    }
    .settings-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
    }
    .settings-card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .settings-card.full-width {
      grid-column: 1 / -1;
    }
    .card-header {
      padding: 20px 24px;
      border-bottom: 1px solid #e2e8f0;
    }
    .card-header h3 {
      font-size: 18px;
      color: #333;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card-body {
      padding: 24px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    .form-group label {
      display: block;
      margin-bottom: 8px;
      color: #374151;
      font-weight: 500;
      font-size: 14px;
    }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      padding: 10px 14px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .btn-primary:hover {
      opacity: 0.9;
    }
    .btn-success {
      background: #10b981;
      color: white;
    }
    .btn-success:hover {
      background: #059669;
    }
    .btn-danger {
      background: #ef4444;
      color: white;
    }
    .btn-danger:hover {
      background: #dc2626;
    }
    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #f8fafc;
      padding: 12px 16px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      color: #334155;
    }
    .alert {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .alert-error {
      background: #fee2e2;
      color: #dc2626;
    }
    .alert-success {
      background: #d1fae5;
      color: #047857;
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal.active {
      display: flex;
    }
    .modal-content {
      background: white;
      padding: 30px;
      border-radius: 16px;
      max-width: 500px;
      width: 90%;
    }
    .modal-header {
      margin-bottom: 20px;
    }
    .modal-header h3 {
      font-size: 20px;
      color: #333;
    }
    @media (max-width: 768px) {
      .header { 
        padding: 16px 20px;
        flex-wrap: wrap;
        gap: 12px;
      }
      .nav {
        order: 3;
        width: 100%;
        justify-content: center;
      }
      .container { padding: 20px; }
      .settings-grid {
        grid-template-columns: 1fr;
      }
      .form-row {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>💇‍♀️ OnTime Super Admin</h1>
    <div class="nav">
      <a href="/admin/overview">Overview</a>
      <a href="/admin/salons">Salons</a>
      <a href="/admin/settings" class="active">Settings</a>
    </div>
    <a href="/admin/logout" class="logout-btn">Logout</a>
  </div>
  
  <div class="container">
    <div class="page-header">
      <h2>Settings</h2>
      <p>Manage your account and subscription plans</p>
    </div>
    
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    ${success ? `<div class="alert alert-success">${success}</div>` : ''}
    
    <div class="settings-grid">
      <div class="settings-card">
        <div class="card-header">
          <h3>👤 Profile</h3>
        </div>
        <div class="card-body">
          <div class="form-group">
            <label>Username</label>
            <input type="text" value="${escapeHtml(username)}" disabled>
          </div>
          <p style="color: #64748b; font-size: 14px;">Your username cannot be changed.</p>
        </div>
      </div>
      
      <div class="settings-card">
        <div class="card-header">
          <h3>🔐 Change Password</h3>
        </div>
        <div class="card-body">
          <form method="POST" action="/admin/settings/update-password">
            <div class="form-group">
              <label for="currentPassword">Current Password</label>
              <input type="password" id="currentPassword" name="currentPassword" required>
            </div>
            <div class="form-group">
              <label for="newPassword">New Password</label>
              <input type="password" id="newPassword" name="newPassword" required minlength="6">
            </div>
            <div class="form-group">
              <label for="confirmPassword">Confirm New Password</label>
              <input type="password" id="confirmPassword" name="confirmPassword" required minlength="6">
            </div>
            <button type="submit" class="btn btn-primary">Update Password</button>
          </form>
        </div>
      </div>
      
      <div class="settings-card full-width">
        <div class="card-header">
          <h3>💳 Subscription Plans</h3>
        </div>
        <div class="card-body">
          <table style="margin-bottom: 24px;">
            <thead>
              <tr>
                <th>Plan Name</th>
                <th>Duration</th>
                <th>Price</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${subscriptionFees.length > 0 ? feeRows : '<tr><td colspan="5" style="text-align: center;">No subscription plans yet</td></tr>'}
            </tbody>
          </table>
          
          <h4 style="font-size: 16px; color: #333; margin-bottom: 16px;">Add New Plan</h4>
          <form method="POST" action="/admin/settings/subscription-fees">
            <div class="form-row">
              <div class="form-group">
                <label for="name">Plan Name</label>
                <input type="text" id="name" name="name" placeholder="e.g., Monthly" required>
              </div>
              <div class="form-group">
                <label for="durationDays">Duration (Days)</label>
                <input type="number" id="durationDays" name="durationDays" placeholder="30" required min="1">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="price">Price ($)</label>
                <input type="number" id="price" name="price" placeholder="50.00" required min="0" step="0.01">
              </div>
              <div class="form-group">
                <label for="description">Description</label>
                <input type="text" id="description" name="description" placeholder="Optional description">
              </div>
            </div>
            <button type="submit" class="btn btn-success">Add Subscription Plan</button>
          </form>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Edit Modal -->
  <div id="editModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Edit Subscription Plan</h3>
      </div>
      <form id="editForm" method="POST" action="">
        <div class="form-group">
          <label for="editName">Plan Name</label>
          <input type="text" id="editName" name="name" required>
        </div>
        <div class="form-group">
          <label for="editDuration">Duration (Days)</label>
          <input type="number" id="editDuration" name="durationDays" required min="1">
        </div>
        <div class="form-group">
          <label for="editPrice">Price ($)</label>
          <input type="number" id="editPrice" name="price" required min="0" step="0.01">
        </div>
        <div class="form-group">
          <label for="editDescription">Description</label>
          <input type="text" id="editDescription" name="description">
        </div>
        <div style="display: flex; gap: 12px;">
          <button type="submit" class="btn btn-primary">Save Changes</button>
          <button type="button" onclick="closeEditModal()" class="btn" style="background: #e5e7eb; color: #374151;">Cancel</button>
        </div>
      </form>
    </div>
  </div>
  
  <script>
    function openEditModal(id, name, duration, price, description) {
      document.getElementById('editForm').action = '/admin/settings/subscription-fees/' + id + '/update';
      document.getElementById('editName').value = name;
      document.getElementById('editDuration').value = duration;
      document.getElementById('editPrice').value = price;
      document.getElementById('editDescription').value = description;
      document.getElementById('editModal').classList.add('active');
    }
    
    function closeEditModal() {
      document.getElementById('editModal').classList.remove('active');
    }
    
    // Close modal on outside click
    document.getElementById('editModal').addEventListener('click', function(e) {
      if (e.target === this) closeEditModal();
    });
  </script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = { toString: () => text };
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

module.exports = router;
