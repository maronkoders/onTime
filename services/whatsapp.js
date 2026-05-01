/**
 * WhatsApp Service Provider Factory
 * Automatically switches between Twilio and WhatsApp Web based on WHATSAPP_PROVIDER env var
 *
 * Usage: All controllers import from this file. No changes needed when switching providers.
 *
 * Providers:
 * - 'twilio': Uses Twilio API (cloud-based, requires credentials)
 * - 'whatsapp-web': Uses whatsapp-web.js (local browser, free, uses your phone's WhatsApp)
 */

const provider = require('../config/whatsappProvider');
const logger = require('../utils/logger');

// Import both providers
const twilioService = require('./whatsappTwilio');
const whatsappWebService = require('./whatsappWeb');

/**
 * Send a WhatsApp message using the configured provider
 * @param {string} to - Phone number (with or without whatsapp: prefix)
 * @param {string} body - Message text
 * @returns {Promise<object>} - Message result
 */
async function sendMessage(to, body) {
  if (provider.isWhatsAppWeb) {
    return whatsappWebService.sendMessage(to, body);
  }
  // Default to Twilio
  return twilioService.sendMessage(to, body);
}

/**
 * Initialize the WhatsApp provider (mainly for WhatsApp Web)
 * @param {Function} onMessageReceived - Callback for incoming messages (WhatsApp Web only)
 */
function initialize(onMessageReceived) {
  if (provider.isWhatsAppWeb) {
    logger.info('Initializing WhatsApp Web provider...');
    whatsappWebService.initialize(onMessageReceived);
  } else {
    logger.info('Using Twilio provider (no initialization needed)');
  }
}

/**
 * Get provider status
 */
function getStatus() {
  if (provider.isWhatsAppWeb) {
    return {
      provider: 'whatsapp-web',
      ...whatsappWebService.getStatus(),
    };
  }
  return {
    provider: 'twilio',
    ready: true,
  };
}

module.exports = {
  sendMessage,
  initialize,
  getStatus,
  provider, // Expose provider config for advanced usage
};
