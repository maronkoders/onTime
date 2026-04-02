const express = require('express');
const router = express.Router();
const { requireSuperAdmin, authenticateSuperAdmin } = require('../middleware/superAdminAuth');
const tenantModel = require('../models/tenant');
const appointmentModel = require('../models/appointment');
const serviceModel = require('../models/service');
const logger = require('../utils/logger');

// Login page (GET)
router.get('/login', (req, res) => {
  if (req.session && req.session.isSuperAdmin) {
    return res.redirect('/admin/dashboard');
  }
  res.send(getLoginPage());
});

// Login handler (POST)
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (authenticateSuperAdmin(username, password)) {
    req.session.isSuperAdmin = true;
    req.session.username = username;
    return res.redirect('/admin/dashboard');
  }
  
  res.send(getLoginPage('Invalid username or password'));
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// Dashboard (protected)
router.get('/dashboard', requireSuperAdmin, async (req, res) => {
  try {
    const salons = await getAllSalonsWithStats();
    res.send(getDashboardPage(salons));
  } catch (err) {
    logger.error(`Dashboard error: ${err.message}`);
    res.status(500).send('Error loading dashboard');
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

async function getAllSalonsWithStats() {
  const tenants = await tenantModel.getAll();
  const salons = [];
  
  for (const tenant of tenants) {
    const appointments = await appointmentModel.findByTenant(tenant.id);
    const services = await serviceModel.findByTenant(tenant.id);
    
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
  
  // Sort appointments by date
  appointments.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  
  return {
    ...tenant,
    appointments,
    services,
    totalAppointments: appointments.length,
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

function getDashboardPage(salons) {
  const totalSalons = salons.length;
  const totalAppointments = salons.reduce((sum, s) => sum + s.totalAppointments, 0);
  const totalServices = salons.reduce((sum, s) => sum + s.totalServices, 0);
  
  const salonRows = salons.map(salon => `
    <tr onclick="window.location='/admin/salon/${salon.id}'" style="cursor: pointer;">
      <td><strong>${escapeHtml(salon.name)}</strong></td>
      <td>${escapeHtml(salon.location || 'N/A')}</td>
      <td>${salon.ownerPhone}</td>
      <td><span class="badge">${salon.totalAppointments}</span></td>
      <td><span class="badge badge-green">${salon.upcomingAppointments}</span></td>
      <td>${salon.totalServices}</td>
      <td><span class="code">${salon.bookingCode}</span></td>
      <td>${formatDate(salon.createdAt)}</td>
    </tr>
  `).join('');
  
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
    }
    .salon-meta span {
      display: flex;
      align-items: center;
      gap: 6px;
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
    <a href="/admin/dashboard" class="back-btn">← Back to Dashboard</a>
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
