const twilioClient = require('../config/twilio');
const logger = require('../utils/logger');
const { formatPhoneForWhatsApp } = require('../utils/helpers');
const messageEmitter = require('./messageEmitter');

const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_NUMBER
  ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
  : null;

async function sendMessage(to, body) {
  const toFormatted = to.startsWith('whatsapp:') ? to : formatPhoneForWhatsApp(to);

  // Always emit for the web simulator
  messageEmitter.emit('outgoing', { to: toFormatted, body, timestamp: new Date().toISOString() });

  if (!twilioClient || !WHATSAPP_FROM) {
    logger.info(`[SIMULATOR] Message to ${toFormatted}: ${body}`);
    return null;
  }

  try {
    const message = await twilioClient.messages.create({
      from: WHATSAPP_FROM,
      to: toFormatted,
      body,
    });
    logger.info(`Message sent to ${toFormatted}: SID ${message.sid}`);
    return message;
  } catch (err) {
    logger.error(`Failed to send message to ${toFormatted}: ${err.message}`);
    throw err;
  }
}

module.exports = { sendMessage };
