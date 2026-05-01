/**
 * WhatsApp Provider Configuration
 * Switches between Twilio and WhatsApp Web (whatsapp-web.js)
 *
 * Set WHATSAPP_PROVIDER=twilio or WHATSAPP_PROVIDER=whatsapp-web in .env
 */

const logger = require('../utils/logger');

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'twilio';

const VALID_PROVIDERS = ['twilio', 'whatsapp-web'];

if (!VALID_PROVIDERS.includes(PROVIDER)) {
  logger.warn(`Invalid WHATSAPP_PROVIDER: ${PROVIDER}. Falling back to 'twilio'`);
}

const config = {
  provider: VALID_PROVIDERS.includes(PROVIDER) ? PROVIDER : 'twilio',
  isTwilio: PROVIDER === 'twilio',
  isWhatsAppWeb: PROVIDER === 'whatsapp-web',
};

logger.info(`WhatsApp provider configured: ${config.provider}`);

module.exports = config;
