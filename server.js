require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const logger = require('./utils/logger');
const { initDatabase } = require('./config/db');
const { startDailyNotifications } = require('./services/notifications');
const webhookController = require('./controllers/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Twilio WhatsApp webhook
app.post('/webhook', webhookController.handleIncoming);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  try {
    // Initialize database schema (non-fatal if DB is unavailable)
    try {
      await initDatabase();
      logger.info('Database initialized');
    } catch (dbErr) {
      logger.warn(`Database not available — server will start without it. Error: ${dbErr.message}`);
      logger.warn('Make sure PostgreSQL is running and DATABASE_URL is correct in .env');
    }

    // Start daily notification cron job
    startDailyNotifications();

    app.listen(PORT, () => {
      logger.info(`OnTime server running on port ${PORT}`);
      logger.info(`Webhook URL: http://localhost:${PORT}/webhook`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

start();

module.exports = app;
