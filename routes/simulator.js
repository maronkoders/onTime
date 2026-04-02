const express = require('express');
const path = require('path');
const messageEmitter = require('../services/messageEmitter');
const logger = require('../utils/logger');

const router = express.Router();

// Serve the simulator UI
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'simulator.html'));
});

// SSE endpoint — streams outgoing bot messages to the web UI
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const onMessage = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  messageEmitter.on('outgoing', onMessage);

  req.on('close', () => {
    messageEmitter.off('outgoing', onMessage);
  });
});

// Receives messages from the web UI, forwards to the webhook handler
router.post('/send', express.json(), async (req, res) => {
  const { phone, message } = req.body;

  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message are required' });
  }

  try {
    // Simulate a Twilio webhook payload
    const webhookPayload = {
      From: `whatsapp:${phone}`,
      Body: message,
      To: `whatsapp:${process.env.BOT_PHONE_NUMBER || '+14155238886'}`,
      MessageSid: `SIM${Date.now()}`,
      AccountSid: 'simulator',
    };

    // Import and call the webhook handler logic directly
    const { handleIncoming } = require('../controllers/webhook');

    // Create a mock req/res to pass to the webhook handler
    const mockReq = {
      body: webhookPayload,
    };
    const mockRes = {
      status: () => ({ send: () => {} }),
    };

    await handleIncoming(mockReq, mockRes);

    res.json({ ok: true });
  } catch (err) {
    logger.error(`Simulator error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
