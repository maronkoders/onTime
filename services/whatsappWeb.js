/**
 * WhatsApp Web Service using whatsapp-web.js
 * Provides the same interface as the Twilio-based whatsapp.js
 *
 * This runs a headless browser that connects to WhatsApp Web via your phone.
 * Session is persisted so you don't need to scan QR code every time.
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const logger = require('../utils/logger');
const { formatPhoneForWhatsApp, normalizePhone } = require('../utils/helpers');
const messageEmitter = require('./messageEmitter');

let client = null;
let isReady = false;
let messageHandler = null; // Callback for incoming messages
const pendingReplies = new Map(); // Store original WhatsApp IDs for replying

/**
 * Initialize the WhatsApp Web client
 * @param {Function} onMessageReceived - Callback for incoming messages: (phone, body) => void
 */
function initialize(onMessageReceived) {
  if (client) {
    logger.warn('WhatsApp Web client already initialized');
    return;
  }

  messageHandler = onMessageReceived;

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: process.env.WHATSAPP_WEB_SESSION_PATH || './.wwebjs_auth',
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
  });

  // QR Code event - show in terminal for initial setup
  client.on('qr', (qr) => {
    logger.info('WhatsApp Web QR Code received. Scan with your phone:');
    qrcode.generate(qr, { small: true });
  });

  // Ready event
  client.on('ready', () => {
    isReady = true;
    logger.info('WhatsApp Web client is ready and connected');
  });

  // Auth failure
  client.on('auth_failure', (msg) => {
    logger.error(`WhatsApp Web authentication failed: ${msg}`);
    isReady = false;
  });

  // Disconnected
  client.on('disconnected', (reason) => {
    logger.warn(`WhatsApp Web disconnected: ${reason}`);
    isReady = false;
    client = null;
  });

  // Incoming message handler
  client.on('message_create', async (msg) => {
    // Only handle incoming messages (not from ourselves)
    if (msg.fromMe) return;

    try {
      const rawFrom = msg.from;  // e.g., "263771234567@c.us" or "1234567890@lid"
      const body = msg.body || '';

      // Normalize for database lookup (remove @c.us, @lid, etc.)
      const phone = normalizePhone(rawFrom);

      // Store the original WhatsApp ID for sending replies
      // For @lid numbers, we MUST use the original ID to reply
      const replyId = rawFrom.includes('@lid') ? rawFrom : `${phone.replace('+', '')}@c.us`;

      logger.info(`WhatsApp Web incoming message from ${phone} (raw: ${rawFrom}): ${body}`);

      // Emit for web simulator
      messageEmitter.emit('incoming', {
        from: phone,
        body,
        timestamp: new Date().toISOString(),
      });

      // Route to the message handler - pass phone for DB, but we need a way to reply
      // We'll store the replyId in a temporary cache
      pendingReplies.set(phone, replyId);

      if (messageHandler) {
        await messageHandler(phone, body);
      }
    } catch (err) {
      logger.error(`Error handling incoming WhatsApp Web message: ${err.message}`);
      logger.error(`Stack: ${err.stack}`);
    }
  });

  // Initialize
  logger.info('Starting WhatsApp Web client...');
  client.initialize().catch((err) => {
    logger.error(`Failed to initialize WhatsApp Web client: ${err.message}`);
  });
}

/**
 * Send a WhatsApp message
 * @param {string} to - Phone number (with or without whatsapp: prefix)
 * @param {string} body - Message text
 * @returns {Promise<object>} - Message result
 */
async function sendMessage(to, body) {
  const toFormatted = to.startsWith('whatsapp:') ? to.replace('whatsapp:', '') : to;

  // Always emit for the web simulator
  messageEmitter.emit('outgoing', {
    to: toFormatted,
    body,
    timestamp: new Date().toISOString(),
  });

  if (!client || !isReady) {
    logger.warn(`[WHATSAPP WEB NOT READY] Message to ${toFormatted}: ${body}`);
    return null;
  }

  try {
    // Check if we have the original WhatsApp ID stored (for @lid numbers)
    const originalId = pendingReplies.get(toFormatted);

    // Format number for WhatsApp Web
    // If we have the original ID (e.g., "123@lid"), use it directly
    // Otherwise construct from phone number: "263771234567@c.us"
    let chatId;
    if (originalId) {
      chatId = originalId;
      logger.info(`Using stored WhatsApp ID for reply: ${chatId}`);
    } else if (toFormatted.includes('@')) {
      chatId = toFormatted;
    } else {
      // Remove + and add @c.us suffix
      chatId = `${toFormatted.replace('+', '')}@c.us`;
    }

    const message = await client.sendMessage(chatId, body);
    logger.info(`WhatsApp Web message sent to ${toFormatted} (chat: ${chatId}): ${message.id._serialized}`);
    return message;
  } catch (err) {
    logger.error(`Failed to send WhatsApp Web message to ${toFormatted}: ${err.message}`);
    logger.error(`Error stack: ${err.stack}`);
    throw err;
  }
}

/**
 * Get client status
 */
function getStatus() {
  return {
    initialized: !!client,
    ready: isReady,
  };
}

/**
 * Disconnect and cleanup
 */
async function destroy() {
  if (client) {
    await client.destroy();
    client = null;
    isReady = false;
    logger.info('WhatsApp Web client destroyed');
  }
}

module.exports = {
  initialize,
  sendMessage,
  getStatus,
  destroy,
};
