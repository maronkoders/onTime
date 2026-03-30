const tenantModel = require('../models/tenant');
const sessionService = require('../services/session');
const adminController = require('./admin');
const clientController = require('./client');
const { normalizePhone } = require('../utils/helpers');
const logger = require('../utils/logger');

async function handleIncoming(req, res) {
  // Respond quickly to Twilio to avoid timeout
  res.status(200).send('<Response></Response>');

  try {
    const from = req.body.From || '';
    const body = (req.body.Body || '').trim();

    if (!from || !body) {
      logger.warn('Received webhook with missing From or Body');
      return;
    }

    const phone = normalizePhone(from);
    logger.info(`Incoming message from ${phone}: ${body}`);

    await routeMessage(phone, body);
  } catch (err) {
    logger.error(`Webhook handler error: ${err.message}`, { stack: err.stack });
  }
}

async function routeMessage(phone, body) {
  const lowerBody = body.toLowerCase().trim();

  // Get existing session
  let session = await sessionService.getSession(phone);

  // Check if user is a salon owner
  const tenant = await tenantModel.findByPhone(phone);

  // --- Handle "register" command ---
  if (lowerBody === 'register') {
    if (tenant) {
      const { sendMessage } = require('../services/whatsapp');
      return sendMessage(phone, `You already have a registered salon: *${tenant.name}*.\nType *help* for available commands.`);
    }
    return adminController.startRegistration(phone);
  }

  // --- Handle "book <CODE>" command ---
  if (lowerBody.startsWith('book ')) {
    const code = body.substring(5).trim();
    if (code) {
      return clientController.startBooking(phone, code);
    }
  }

  // --- Handle active session ---
  if (session) {
    // Check registration flow states
    const regStates = [
      'awaiting_salon_name',
      'awaiting_location',
      'awaiting_working_hours',
      'awaiting_first_service_name',
      'awaiting_first_service_duration',
      'awaiting_first_service_price',
    ];

    if (regStates.includes(session.state)) {
      return adminController.handleRegistrationState(phone, body, session);
    }

    // Registration sub-states (adding more services during setup)
    const regSubStates = [
      'awaiting_more_services',
      'awaiting_reg_service_duration',
      'awaiting_reg_service_price',
    ];

    if (regSubStates.includes(session.state)) {
      return adminController.handleRegistrationSubState(phone, body, session);
    }

    // Admin states (add service flow)
    if (session.role === 'admin' && tenant) {
      return adminController.handleAdminMessage(phone, body, session, tenant);
    }

    // Client states (booking flow)
    if (session.role === 'client') {
      return clientController.handleClientMessage(phone, body, session);
    }
  }

  // --- No active session ---

  // If salon owner, route to admin handler
  if (tenant) {
    // Create a basic admin session
    await sessionService.setSession(phone, {
      role: 'admin',
      state: null,
      tenant_id: tenant.id,
      context: {},
    });
    return adminController.handleAdminMessage(phone, body, null, tenant);
  }

  // Default: client flow (no active booking)
  return clientController.handleClientMessage(phone, body, session);
}

module.exports = { handleIncoming };
