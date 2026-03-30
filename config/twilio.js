const twilio = require('twilio');
const logger = require('../utils/logger');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const hasValidCredentials =
  accountSid && authToken && accountSid.startsWith('AC');

if (!hasValidCredentials) {
  logger.warn('Twilio credentials not set or invalid. WhatsApp messaging will run in dry-run mode.');
}

let client = null;
try {
  if (hasValidCredentials) {
    client = twilio(accountSid, authToken);
  }
} catch (err) {
  logger.error(`Failed to initialize Twilio client: ${err.message}`);
}

module.exports = client;
