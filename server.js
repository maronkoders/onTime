require('dotenv').config();

const express = require('express');
const session = require('express-session');
const morgan = require('morgan');
const logger = require('./utils/logger');
const { initDatabase } = require('./config/db');
const { startDailyNotifications } = require('./services/notifications');
const { startExpiryReminderJob } = require('./services/subscriptionReminder');
const webhookController = require('./controllers/webhook');
const simulatorRoutes = require('./routes/simulator');
const superAdminRoutes = require('./routes/superAdmin');
const whatsappService = require('./services/whatsapp');
const providerConfig = require('./config/whatsappProvider');

const app = express();
const PORT = process.env.PORT || 3000;

// Session middleware for super admin
app.use(session({
  secret: process.env.SESSION_SECRET || 'ontime-super-admin-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) },
}));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/admin/login');
});

// WhatsApp provider status
app.get('/whatsapp/status', (req, res) => {
  const status = whatsappService.getStatus();
  res.json({
    ...status,
    timestamp: new Date().toISOString(),
  });
});

// Manual QR code generation endpoint for debugging
app.get('/whatsapp/qr', async (req, res) => {
  const whatsappWebService = require('./services/whatsappWeb');
  
  try {
    // Destroy existing client
    await whatsappWebService.destroy();
    
    // Reinitialize with QR code
    const { routeMessage } = require('./controllers/webhook');
    whatsappService.initialize(routeMessage);
    
    res.redirect('/qr');
  } catch (err) {
    res.status(500).json({
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// The user-facing QR code display endpoint
app.get('/qr', async (req, res) => {
  const qrString = whatsappService.getLatestQr();
  const status = whatsappService.getStatus();
  
  if (status.ready) {
    return res.send(`
      <html>
        <head>
          <title>WhatsApp Status</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; }
            .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .status-icon { font-size: 4rem; color: #25d366; margin-bottom: 1rem; }
            h1 { color: #111b21; }
            p { color: #667781; }
            .btn { display: inline-block; background: #008069; color: white; padding: 0.5rem 1rem; border-radius: 20px; text-decoration: none; margin-top: 1rem; }
          </style>
          <meta http-equiv="refresh" content="30">
        </head>
        <body>
          <div class="card">
            <div class="status-icon">✅</div>
            <h1>WhatsApp is Connected</h1>
            <p>The client is already authenticated and ready.</p>
            <a href="/whatsapp/status" class="btn">Check Status JSON</a>
          </div>
        </body>
      </html>
    `);
  }

  if (!qrString) {
    return res.send(`
      <html>
        <head>
          <title>WhatsApp QR Code</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #f0f2f5; }
            .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
            .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #008069; border-radius: 50%; width: 40px; height: 40px; animation: spin 2s linear infinite; margin: 1rem auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            h1 { color: #111b21; }
            p { color: #667781; }
          </style>
          <meta http-equiv="refresh" content="5">
        </head>
        <body>
          <div class="card">
            <div class="spinner"></div>
            <h1>Waiting for QR Code...</h1>
            <p>The WhatsApp client is initializing. This page will refresh automatically.</p>
            <p><small>If this takes too long, try <a href="/whatsapp/qr">restarting the client</a>.</small></p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const QRCode = require('qrcode');
    const qrDataUrl = await QRCode.toDataURL(qrString);
    
    res.send(`
      <html>
        <head>
          <title>Scan WhatsApp QR Code</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #f0f2f5; margin: 0; padding: 20px; }
            .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); text-align: center; max-width: 400px; width: 100%; }
            h1 { color: #111b21; margin-bottom: 0.5rem; font-size: 1.5rem; }
            p { color: #667781; margin-bottom: 1.5rem; line-height: 1.4; }
            .qr-container { background: white; padding: 10px; border: 1px solid #e9edef; border-radius: 8px; display: inline-block; margin-bottom: 1.5rem; }
            .qr-image { display: block; width: 264px; height: 264px; }
            .instructions { text-align: left; background: #f8f9fa; padding: 1rem; border-radius: 8px; font-size: 0.9rem; }
            .instructions ol { margin: 0; padding-left: 1.5rem; color: #3b4a54; }
            .instructions li { margin-bottom: 0.5rem; }
            .footer { margin-top: 2rem; color: #8696a0; font-size: 0.8rem; }
          </style>
          <meta http-equiv="refresh" content="60">
        </head>
        <body>
          <div class="card">
            <h1>Link WhatsApp</h1>
            <p>Scan this code with your phone to use OnTime WhatsApp features.</p>
            
            <div class="qr-container">
              <img src="${qrDataUrl}" alt="WhatsApp QR Code" class="qr-image" />
            </div>

            <div class="instructions">
              <ol>
                <li>Open WhatsApp on your phone</li>
                <li>Tap <b>Menu</b> or <b>Settings</b></li>
                <li>Select <b>Linked Devices</b></li>
                <li>Tap on <b>Link a Device</b></li>
                <li>Point your phone to this screen to capture the code</li>
              </ol>
            </div>
            
            <div class="footer">
              This code will refresh automatically.
            </div>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error generating QR code image: ${err.message}`);
  }
});

// Twilio WhatsApp webhook
app.post('/webhook', webhookController.handleIncoming);

// WhatsApp Web Simulator (dev only)
app.use('/simulator', simulatorRoutes);

// Super Admin Dashboard
app.use('/admin', superAdminRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  // 1. Start listening immediately (crucial for Railway health checks)
  const server = app.listen(PORT, () => {
    logger.info(`OnTime server running on port ${PORT}`);
    logger.info(`Webhook URL: http://localhost:${PORT}/webhook`);
    logger.info(`Health check: http://localhost:${PORT}/health`);
    logger.info(`WhatsApp Simulator: http://localhost:${PORT}/simulator`);
    logger.info(`Super Admin Dashboard: http://localhost:${PORT}/admin/login`);
    logger.info(`WhatsApp Provider: ${providerConfig.provider}`);
  });

  try {
    // 2. Initialize database schema and run migrations in background
    try {
      const { runMigrations } = require('./scripts/migrate-all');
      await runMigrations();
      logger.info('Database migrations completed');
    } catch (dbErr) {
      logger.warn(`Database migration issue — server started but some tables might be missing. Error: ${dbErr.message}`);
      logger.warn('Make sure PostgreSQL is running and DATABASE_URL is correct in .env');
    }

    // 3. Start background jobs
    startDailyNotifications();
    startExpiryReminderJob();

    // 4. Initialize WhatsApp provider (needed for WhatsApp Web)
    if (providerConfig.isWhatsAppWeb) {
      const { routeMessage } = require('./controllers/webhook');
      whatsappService.initialize(routeMessage);
    }
  } catch (err) {
    logger.error(`Error during background initialization: ${err.message}`, { stack: err.stack });
    // Don't exit(1) here as the server is already listening and might still work for some routes
  }
}

start();

module.exports = app;
