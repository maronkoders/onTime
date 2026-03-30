const twilioClient = require('../config/twilio');
const logger = require('../utils/logger');
const { formatPhoneForWhatsApp } = require('../utils/helpers');

const WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_NUMBER
  ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
  : null;

async function sendMessage(to, body) {
  const toFormatted = to.startsWith('whatsapp:') ? to : formatPhoneForWhatsApp(to);

  if (!twilioClient || !WHATSAPP_FROM) {
    logger.warn(`[DRY RUN] Would send to ${toFormatted}: ${body}`);
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
