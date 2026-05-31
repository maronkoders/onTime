const express = require('express');
const router = express.Router();
const { requireSuperAdmin, authenticateSuperAdmin } = require('../middleware/superAdminAuth');
const tenantModel = require('../models/tenant');
const appointmentModel = require('../models/appointment');
const serviceModel = require('../models/service');
const subscriptionFeeModel = require('../models/subscriptionFee');
const systemSettingsModel = require('../models/systemSettings');
const superAdminModel = require('../models/superAdmin');
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
  
  const isAuthenticated = await authenticateSuperAdmin(username, password);
  if (isAuthenticated) {
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

// Salons list page - shows ALL salons (protected)
router.get('/salons', requireSuperAdmin, async (req, res) => {
  try {
    const salons = await getAllSalonsWithStats();
    res.send(getAllSalonsPage(salons, req.session.username));
  } catch (err) {
    logger.error(`Salons list error: ${err.message}`);
    res.status(500).send('Error loading salons');
  }
});

// Subscriptions page with tabs (protected)
router.get('/subscriptions', requireSuperAdmin, async (req, res) => {
  try {
    const tab = req.query.tab || 'active';
    const salons = await getSalonsByTab(tab);
    res.send(getSubscriptionsPage(salons, tab, req.session.username));
  } catch (err) {
    logger.error(`Subscriptions list error: ${err.message}`);
    res.status(500).send('Error loading subscriptions');
  }
});

// Settings page (protected)
router.get('/settings', requireSuperAdmin, async (req, res) => {
  try {
    let subscriptionFees = [];
    let trialPeriodDays = systemSettingsModel.DEFAULT_TRIAL_PERIOD_DAYS;
    try {
      subscriptionFees = await subscriptionFeeModel.getAll();
      trialPeriodDays = await systemSettingsModel.getTrialPeriodDays();
    } catch (err) {
      logger.warn(`Could not load settings: ${err.message}`);
    }
    res.send(getSettingsPage(subscriptionFees, trialPeriodDays, req.session.username));
  } catch (err) {
    logger.error(`Settings error: ${err.message}`);
    res.status(500).send('Error loading settings');
  }
});

// Update super admin password
router.post('/settings/update-password', requireSuperAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Verify current password
    const isCurrentValid = await authenticateSuperAdmin(req.session.username, currentPassword);
    if (!isCurrentValid) {
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
    
    // Update hashed password in database
    await superAdminModel.updatePassword(req.session.username, newPassword);
    
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

// Update trial period
router.post('/settings/trial-period', requireSuperAdmin, async (req, res) => {
  try {
    const { days } = req.body;
    const daysNum = parseInt(days, 10);
    
    if (isNaN(daysNum) || daysNum < 1) {
      let subscriptionFees = [];
      let trialPeriodDays = systemSettingsModel.DEFAULT_TRIAL_PERIOD_DAYS;
      try {
        subscriptionFees = await subscriptionFeeModel.getAll();
        trialPeriodDays = await systemSettingsModel.getTrialPeriodDays();
      } catch (err) {
        logger.warn(`Could not load settings: ${err.message}`);
      }
      return res.send(getSettingsPage(subscriptionFees, trialPeriodDays, req.session.username, 'Trial period must be at least 1 day'));
    }
    
    await systemSettingsModel.setTrialPeriodDays(daysNum);
    res.redirect('/admin/settings');
  } catch (err) {
    logger.error(`Update trial period error: ${err.message}`);
    res.status(500).send('Error updating trial period');
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

// Toggle customer reminders (protected)
router.post('/salon/:id/toggle-reminders', requireSuperAdmin, async (req, res) => {
  try {
    const salonId = parseInt(req.params.id, 10);
    const { sendCustomerReminders } = req.body;
    const enabled = sendCustomerReminders === 'true';
    await tenantModel.updateCustomerRemindersSetting(salonId, enabled);
    res.redirect(`/admin/salon/${salonId}`);
  } catch (err) {
    logger.error(`Toggle customer reminders error: ${err.message}`);
    res.status(500).send('Error updating customer reminders setting');
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
      position: relative;
    }
    label {
      display: block;
      margin-bottom: 8px;
      color: #555;
      font-weight: 500;
      font-size: 14px;
    }
    .input-wrapper {
      position: relative;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 16px;
      transition: all 0.3s;
    }
    input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
    }
    input.invalid {
      border-color: #ef4444;
    }
    input.valid {
      border-color: #10b981;
    }
    .toggle-password {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      cursor: pointer;
      color: #94a3b8;
      font-size: 18px;
      padding: 4px;
      transition: color 0.2s;
    }
    .toggle-password:hover {
      color: #667eea;
    }
    .validation-msg {
      font-size: 12px;
      margin-top: 4px;
      color: #ef4444;
      display: none;
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
      transition: all 0.3s;
      margin-top: 10px;
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(102, 126, 234, 0.4);
    }
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
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
    <form method="POST" action="/admin/login" id="loginForm">
      <div class="form-group">
        <label for="username">Username</label>
        <div class="input-wrapper">
          <input type="text" id="username" name="username" required autofocus>
        </div>
        <div id="username-msg" class="validation-msg">Please enter your username</div>
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <div class="input-wrapper">
          <input type="password" id="password" name="password" required>
          <span class="toggle-password" id="togglePassword">👁️</span>
        </div>
        <div id="password-msg" class="validation-msg">Please enter your password</div>
      </div>
      <button type="submit" id="submitBtn">Sign In</button>
    </form>
  </div>

  <script>
    const loginForm = document.getElementById('loginForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const submitBtn = document.getElementById('submitBtn');

    // Toggle Password Visibility
    togglePassword.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
    });

    // Real-time Validation
    function validateField(input, msgId) {
      const msg = document.getElementById(msgId);
      if (input.value.trim() === '') {
        input.classList.add('invalid');
        input.classList.remove('valid');
        msg.style.display = 'block';
        return false;
      } else {
        input.classList.remove('invalid');
        input.classList.add('valid');
        msg.style.display = 'none';
        return true;
      }
    }

    function checkForm() {
      const isUsernameValid = usernameInput.value.trim() !== '';
      const isPasswordValid = passwordInput.value.trim() !== '';
      submitBtn.disabled = !(isUsernameValid && isPasswordValid);
    }

    usernameInput.addEventListener('input', () => {
      validateField(usernameInput, 'username-msg');
      checkForm();
    });

    passwordInput.addEventListener('input', () => {
      validateField(passwordInput, 'password-msg');
      checkForm();
    });

    // Initial check
    checkForm();
  </script>
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
      <a href="/admin/subscriptions">Subscriptions</a>
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
        <a href="/admin/subscriptions" class="quick-link">
          <span class="quick-link-icon">🏪</span>
          <span class="quick-link-text">View All Salons</span>
        </a>
        <a href="/admin/subscriptions?tab=expiring" class="quick-link">
          <span class="quick-link-icon">⏰</span>
          <span class="quick-link-text">Expiring Soon</span>
        </a>
        <a href="/admin/subscriptions?tab=expired" class="quick-link">
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
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      color: #0f172a;
    }
    h1, h2, h3, h4, h5, h6 { font-family: 'Outfit', sans-serif; }
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
    .account-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
    }
    .account-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      display: flex;
      gap: 16px;
      transition: all 0.3s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .account-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
      border-color: #cbd5e1;
    }
    .card-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      flex-shrink: 0;
    }
    .card-content {
      flex: 1;
    }
    .card-content h4 {
      font-size: 16px;
      color: #0f172a;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .card-content p {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .switch-label {
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
    }
    .switch-text {
      font-size: 14px;
      color: #475569;
    }
    .switch-text strong {
      color: #0f172a;
    }
    .ios-switch {
      position: relative;
      display: inline-block;
      width: 46px;
      height: 26px;
    }
    .ios-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #cbd5e1;
      transition: .3s;
      border-radius: 34px;
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    input:checked + .slider.status-slider {
      background-color: #10b981;
    }
    input:not(:checked) + .slider.status-slider {
      background-color: #ef4444;
    }
    input:checked + .slider.reminder-slider {
      background-color: #6366f1;
    }
    input:checked + .slider:before {
      transform: translateX(20px);
    }
    .premium-form {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .input-group {
      display: flex;
      align-items: center;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      transition: all 0.2s;
      width: 110px;
      height: 38px;
    }
    .input-group:focus-within {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
      background: #ffffff;
    }
    .input-group input {
      border: none;
      background: transparent;
      padding: 0 8px 0 12px;
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      width: 100%;
      outline: none;
      font-family: inherit;
    }
    .input-suffix {
      padding-right: 12px;
      color: #64748b;
      font-size: 13px;
      font-weight: 500;
      user-select: none;
    }
    .btn-premium {
      height: 38px;
      padding: 0 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }
    .btn-extend {
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      color: white;
    }
    .btn-extend:hover {
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
    .btn-activate {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
    }
    .btn-activate:hover {
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
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
        <div class="account-grid">
          
          <!-- Account Status Card -->
          <div class="account-card">
            <div class="card-icon" style="background: #e0e7ff; color: #4f46e5;">🛡️</div>
            <div class="card-content">
              <h4>Account Status</h4>
              <p>Temporarily suspend or restore booking services for this salon.</p>
              <form method="POST" action="/admin/salon/${salon.id}/${isActive ? 'deactivate' : 'activate'}">
                <label class="switch-label">
                  <div class="ios-switch">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="this.form.submit()">
                    <span class="slider status-slider"></span>
                  </div>
                  <span class="switch-text"><strong>${isActive ? 'Active' : 'Deactivated'}</strong></span>
                </label>
              </form>
            </div>
          </div>

          <!-- Customer Reminders Card -->
          <div class="account-card">
            <div class="card-icon" style="background: #e0e7ff; color: #4f46e5;">⏰</div>
            <div class="card-content">
              <h4>Customer Reminders</h4>
              <p>Send automated WhatsApp reminders to customers before their appointments.</p>
              <form method="POST" action="/admin/salon/${salon.id}/toggle-reminders">
                <input type="hidden" name="sendCustomerReminders" value="${salon.send_customer_reminders !== false ? 'false' : 'true'}">
                <label class="switch-label">
                  <div class="ios-switch">
                    <input type="checkbox" ${salon.send_customer_reminders !== false ? 'checked' : ''} onchange="this.form.submit()">
                    <span class="slider reminder-slider"></span>
                  </div>
                  <span class="switch-text"><strong>${salon.send_customer_reminders !== false ? 'Enabled' : 'Disabled'}</strong></span>
                </label>
              </form>
            </div>
          </div>

          <!-- Extend Trial Card -->
          <div class="account-card">
            <div class="card-icon" style="background: #fef3c7; color: #d97706;">⏳</div>
            <div class="card-content">
              <h4>Extend Trial</h4>
              <p>Grant additional free trial days for testing booking features.</p>
              <form method="POST" action="/admin/salon/${salon.id}/extend-trial" class="premium-form">
                <div class="input-group">
                  <input type="number" name="days" value="14" min="1" max="365">
                  <span class="input-suffix">days</span>
                </div>
                <button type="submit" class="btn-premium btn-extend">Extend</button>
              </form>
            </div>
          </div>

          <!-- Activate Subscription Card -->
          <div class="account-card">
            <div class="card-icon" style="background: #d1fae5; color: #059669;">💎</div>
            <div class="card-content">
              <h4>Activate Plan</h4>
              <p>Activate a paid subscription plan to restore or extend booking services.</p>
              <form method="POST" action="/admin/salon/${salon.id}/activate-subscription" class="premium-form">
                <div class="input-group">
                  <input type="number" name="days" value="30" min="1" max="365">
                  <span class="input-suffix">days</span>
                </div>
                <button type="submit" class="btn-premium btn-activate">Activate</button>
              </form>
            </div>
          </div>

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

function getAllSalonsPage(salons, username) {
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
  <title>OnTime Super Admin - All Salons</title>
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
      <a href="/admin/subscriptions">Subscriptions</a>
      <a href="/admin/settings">Settings</a>
    </div>
    <a href="/admin/logout" class="logout-btn">Logout</a>
  </div>
  
  <div class="container">
    <div class="page-header">
      <h2>All Salons</h2>
      <p>View all registered salons (${salons.length} total)</p>
    </div>
    
    <div class="section">
      <div class="section-header">
        <h3>Registered Salons <span style="color: #64748b; font-weight: normal;">(${salons.length})</span></h3>
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
            <th>Code</th>
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

function getSubscriptionsPage(salons, activeTab, username) {
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
      <a href="/admin/salons">Salons</a>
      <a href="/admin/subscriptions" class="active">Subscriptions</a>
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
      <a href="/admin/subscriptions?tab=active" class="tab ${activeTab === 'active' ? 'active' : ''}">
        ✅ Active <span class="count-badge">${activeTab === 'active' ? salons.length : ''}</span>
      </a>
      <a href="/admin/subscriptions?tab=expiring" class="tab ${activeTab === 'expiring' ? 'active' : ''}">
        ⏰ Expiring Soon <span class="count-badge">${activeTab === 'expiring' ? salons.length : ''}</span>
      </a>
      <a href="/admin/subscriptions?tab=expired" class="tab ${activeTab === 'expired' ? 'active' : ''}">
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

function getSettingsPage(subscriptionFees, trialPeriodDays, username, error = null, success = null) {
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
    .input-wrapper {
      position: relative;
    }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      padding: 10px 14px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 14px;
      transition: all 0.2s;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
    }
    .form-group input.invalid {
      border-color: #ef4444;
    }
    .form-group input.valid {
      border-color: #10b981;
    }
    .toggle-password {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      cursor: pointer;
      color: #94a3b8;
      font-size: 16px;
      padding: 4px;
      transition: color 0.2s;
    }
    .toggle-password:hover {
      color: #667eea;
    }
    .validation-msg {
      font-size: 12px;
      margin-top: 4px;
      color: #ef4444;
      display: none;
    }
    .validation-msg.success {
      color: #10b981;
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
    .btn:disabled {
      background: #ccc !important;
      cursor: not-allowed;
      transform: none !important;
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
      <a href="/admin/subscriptions">Subscriptions</a>
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
          <form method="POST" action="/admin/settings/update-password" id="passwordForm">
            <div class="form-group">
              <label for="currentPassword">Current Password</label>
              <div class="input-wrapper">
                <input type="password" id="currentPassword" name="currentPassword" required>
                <span class="toggle-password" onclick="togglePass('currentPassword', this)">👁️</span>
              </div>
              <div id="currentPassword-msg" class="validation-msg">Current password is required</div>
            </div>
            <div class="form-group">
              <label for="newPassword">New Password</label>
              <div class="input-wrapper">
                <input type="password" id="newPassword" name="newPassword" required minlength="6">
                <span class="toggle-password" onclick="togglePass('newPassword', this)">👁️</span>
              </div>
              <div id="newPassword-msg" class="validation-msg">Password must be at least 6 characters</div>
            </div>
            <div class="form-group">
              <label for="confirmPassword">Confirm New Password</label>
              <div class="input-wrapper">
                <input type="password" id="confirmPassword" name="confirmPassword" required minlength="6">
                <span class="toggle-password" onclick="togglePass('confirmPassword', this)">👁️</span>
              </div>
              <div id="confirmPassword-msg" class="validation-msg">Passwords do not match</div>
            </div>
            <button type="submit" id="passwordBtn" class="btn btn-primary">Update Password</button>
          </form>
        </div>
      </div>
      
      <div class="settings-card">
        <div class="card-header">
          <h3>🎁 Trial Period</h3>
        </div>
        <div class="card-body">
          <form method="POST" action="/admin/settings/trial-period" id="trialForm">
            <div class="form-group">
              <label for="trialDays">Trial Duration (Days)</label>
              <input type="number" id="trialDays" name="days" value="${trialPeriodDays}" required min="1" max="365">
              <div id="trialDays-msg" class="validation-msg">Please enter a value between 1 and 365</div>
              <p style="color: #64748b; font-size: 13px; margin-top: 6px;">
                Number of days new salons get for free trial. Default: 14 days.
              </p>
            </div>
            <button type="submit" id="trialBtn" class="btn btn-primary">Update Trial Period</button>
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
          <form method="POST" action="/admin/settings/subscription-fees" id="planForm">
            <div class="form-row">
              <div class="form-group">
                <label for="name">Plan Name</label>
                <input type="text" id="name" name="name" placeholder="e.g., Monthly" required>
                <div id="name-msg" class="validation-msg">Plan name is required</div>
              </div>
              <div class="form-group">
                <label for="durationDays">Duration (Days)</label>
                <input type="number" id="durationDays" name="durationDays" placeholder="30" required min="1">
                <div id="durationDays-msg" class="validation-msg">Must be at least 1 day</div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="price">Price ($)</label>
                <input type="number" id="price" name="price" placeholder="50.00" required min="0" step="0.01">
                <div id="price-msg" class="validation-msg">Price must be 0 or more</div>
              </div>
              <div class="form-group">
                <label for="description">Description</label>
                <input type="text" id="description" name="description" placeholder="Optional description">
              </div>
            </div>
            <button type="submit" id="planBtn" class="btn btn-success">Add Subscription Plan</button>
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
          <div id="editName-msg" class="validation-msg">Plan name is required</div>
        </div>
        <div class="form-group">
          <label for="editDuration">Duration (Days)</label>
          <input type="number" id="editDuration" name="durationDays" required min="1">
          <div id="editDuration-msg" class="validation-msg">Must be at least 1 day</div>
        </div>
        <div class="form-group">
          <label for="editPrice">Price ($)</label>
          <input type="number" id="editPrice" name="price" required min="0" step="0.01">
          <div id="editPrice-msg" class="validation-msg">Price must be 0 or more</div>
        </div>
        <div class="form-group">
          <label for="editDescription">Description</label>
          <input type="text" id="editDescription" name="description">
        </div>
        <div style="display: flex; gap: 12px;">
          <button type="submit" id="editBtn" class="btn btn-primary">Save Changes</button>
          <button type="button" onclick="closeEditModal()" class="btn" style="background: #e5e7eb; color: #374151;">Cancel</button>
        </div>
      </form>
    </div>
  </div>
  
  <script>
    function togglePass(id, el) {
      const input = document.getElementById(id);
      const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
      input.setAttribute('type', type);
      el.textContent = type === 'password' ? '👁️' : '🙈';
    }

    function openEditModal(id, name, duration, price, description) {
      document.getElementById('editForm').action = '/admin/settings/subscription-fees/' + id + '/update';
      document.getElementById('editName').value = name;
      document.getElementById('editDuration').value = duration;
      document.getElementById('editPrice').value = price;
      document.getElementById('editDescription').value = description;
      document.getElementById('editModal').classList.add('active');
      validateEditForm();
    }
    
    function closeEditModal() {
      document.getElementById('editModal').classList.remove('active');
    }
    
    // Close modal on outside click
    document.getElementById('editModal').addEventListener('click', function(e) {
      if (e.target === this) closeEditModal();
    });

    // Real-time Validation Logic
    function validate(input, msgId, condition) {
      const msg = document.getElementById(msgId);
      if (!condition) {
        input.classList.add('invalid');
        input.classList.remove('valid');
        if (msg) msg.style.display = 'block';
        return false;
      } else {
        input.classList.remove('invalid');
        input.classList.add('valid');
        if (msg) msg.style.display = 'none';
        return true;
      }
    }

    // Password Form Validation
    const passwordForm = document.getElementById('passwordForm');
    const currentPass = document.getElementById('currentPassword');
    const newPass = document.getElementById('newPassword');
    const confirmPass = document.getElementById('confirmPassword');
    const passwordBtn = document.getElementById('passwordBtn');

    function validatePasswordForm() {
      const v1 = validate(currentPass, 'currentPassword-msg', currentPass.value.length > 0);
      const v2 = validate(newPass, 'newPassword-msg', newPass.value.length >= 6);
      const v3 = validate(confirmPass, 'confirmPassword-msg', confirmPass.value === newPass.value && confirmPass.value.length > 0);
      passwordBtn.disabled = !(v1 && v2 && v3);
    }

    [currentPass, newPass, confirmPass].forEach(el => el.addEventListener('input', validatePasswordForm));

    // Trial Form Validation
    const trialForm = document.getElementById('trialForm');
    const trialDays = document.getElementById('trialDays');
    const trialBtn = document.getElementById('trialBtn');

    function validateTrialForm() {
      const val = parseInt(trialDays.value);
      const isValid = !isNaN(val) && val >= 1 && val <= 365;
      validate(trialDays, 'trialDays-msg', isValid);
      trialBtn.disabled = !isValid;
    }

    trialDays.addEventListener('input', validateTrialForm);

    // Plan Form Validation
    const planForm = document.getElementById('planForm');
    const planName = document.getElementById('name');
    const planDuration = document.getElementById('durationDays');
    const planPrice = document.getElementById('price');
    const planBtn = document.getElementById('planBtn');

    function validatePlanForm() {
      const v1 = validate(planName, 'name-msg', planName.value.trim().length > 0);
      const v2 = validate(planDuration, 'durationDays-msg', parseInt(planDuration.value) >= 1);
      const v3 = validate(planPrice, 'price-msg', parseFloat(planPrice.value) >= 0);
      planBtn.disabled = !(v1 && v2 && v3);
    }

    [planName, planDuration, planPrice].forEach(el => el.addEventListener('input', validatePlanForm));

    // Edit Form Validation
    const editForm = document.getElementById('editForm');
    const editName = document.getElementById('editName');
    const editDuration = document.getElementById('editDuration');
    const editPrice = document.getElementById('editPrice');
    const editBtn = document.getElementById('editBtn');

    function validateEditForm() {
      const v1 = validate(editName, 'editName-msg', editName.value.trim().length > 0);
      const v2 = validate(editDuration, 'editDuration-msg', parseInt(editDuration.value) >= 1);
      const v3 = validate(editPrice, 'editPrice-msg', parseFloat(editPrice.value) >= 0);
      editBtn.disabled = !(v1 && v2 && v3);
    }

    [editName, editDuration, editPrice].forEach(el => el.addEventListener('input', validateEditForm));

    // Initial validation
    validatePasswordForm();
    validateTrialForm();
    validatePlanForm();
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
