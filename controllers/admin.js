const tenantModel = require('../models/tenant');
const subscriptionModel = require('../models/subscription');
const systemSettingsModel = require('../models/systemSettings');
const serviceModel = require('../models/service');
const appointmentModel = require('../models/appointment');
const sessionService = require('../services/session');
const { sendMessage } = require('../services/whatsapp');
const { generateBookingCode, formatCurrency, formatServiceTable, generateBookingLink } = require('../utils/helpers');
const { formatDateTime, toHarareTime, formatTime, todayHarare, HARARE_OFFSET_HOURS, formatDateLong } = require('../utils/time');
const logger = require('../utils/logger');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const DEFAULT_WORKING_HOURS = {
  monday: '09:00-17:00',
  tuesday: '09:00-17:00',
  wednesday: '09:00-17:00',
  thursday: '09:00-17:00',
  friday: '09:00-17:00',
  saturday: '09:00-17:00',
  sunday: 'closed',
};

const COMMAND_MAP = {
  1: 'today',
  2: 'appointments',
  3: 'services',
  4: 'add service',
  5: 'remove service',
  6: 'hours',
  7: 'link',
  8: 'cancel',
  9: 'help',
  10: 'pdf',
  11: 'edit service',
};

async function handleAdminMessage(phone, body, session, tenant) {
  // SECURITY: Verify the phone number matches the tenant owner
  if (!tenant || tenant.owner_phone !== phone) {
    // Not authenticated as salon owner - treat as client message
    const { sendMessage } = require('../services/whatsapp');
    return sendMessage(
      phone,
      `👋 Welcome to *OnTime* — your salon appointment assistant on WhatsApp!\n\n` +
        `*For Clients:*\n` +
        `📅 *Book* — Use the booking link from your salon to schedule an appointment\n` +
        `📋 *My appointment* — View your upcoming bookings\n` +
        `❌ *Cancel <id>* — Cancel a booking\n\n` +
        `*For Salon Owners:*\n` +
        `Type *REGISTER* to set up your salon.\n\n` +
        `Get started now!`
    );
  }

  // Check subscription status
  const subscriptionStatus = tenantModel.getSubscriptionStatus(tenant);
  let lowerBody = body.toLowerCase().trim();
  
  // Handle global BACK command - return to main menu
  if (lowerBody === 'back') {
    await sessionService.clearSession(phone);
    return showHelp(phone, tenant);
  }
  
  // If subscription expired/deactivated, only allow payment-related commands
  if (!subscriptionStatus.valid) {
    // Check if this is a payment confirmation command
    if (lowerBody.startsWith('paid ')) {
      return handlePaymentConfirmation(phone, tenant, body);
    }
    
    // Block all other commands and show payment message
    let message = `⛔ *Access Denied*\n\n`;
    
    if (subscriptionStatus.reason === 'Account deactivated') {
      message += `Your salon account has been deactivated.\n\n` +
        `Please contact support to reactivate your account.`;
    } else if (subscriptionStatus.trialEnded) {
      const trialEndDate = new Date(tenant.trial_ends_at).toLocaleDateString();
      message += `Your *free trial* ended on ${trialEndDate}.\n\n` +
        `💡 *Don't lose your clients!*\n` +
        `Your booking link is no longer accepting appointments. Reactivate now to keep your salon running 24/7.\n\n` +
        `📦 *Affordable Plans:*\n` +
        `• 1 Month: $5\n` +
        `• 3 Months: $12 (20% off)\n` +
        `• 6 Months: $22 (27% off)\n\n` +
        `💳 *Payment Methods:*\n` +
        `• Innbucks / Ecocash: *0775635191*\n` +
        `  (Brian H Thomas)\n\n` +
        `✅ *To reactivate:*\n` +
        `1. Make payment using above details\n` +
        `2. Reply with: *PAID <amount> <method>*\n` +
        `   Example: *PAID 12 ecocash*\n\n` +
        `Your account will be activated within 24 hours! 🚀`;
    } else if (subscriptionStatus.subscriptionEnded) {
      const subEndDate = new Date(tenant.subscription_ends_at).toLocaleDateString();
      message += `Your subscription expired on ${subEndDate}.\n\n` +
        `💡 *Your clients are waiting!*\n` +
        `Reactivate now to restore your booking system.\n\n` +
        `📦 *Renewal Options:*\n` +
        `• 1 Month: $5\n` +
        `• 3 Months: $12 (20% off)\n` +
        `• 6 Months: $22 (27% off)\n\n` +
        `💳 *Payment Methods:*\n` +
        `• Innbucks / Ecocash: *0775635191*\n` +
        `  (Brian H Thomas)\n\n` +
        `✅ *To renew:*\n` +
        `1. Make payment using above details\n` +
        `2. Reply with: *PAID <amount> <method>*\n` +
        `   Example: *PAID 5 innbucks*\n\n` +
        `Your subscription will be renewed within 24 hours! 🚀`;
    } else {
      message += subscriptionStatus.reason || 'Access denied.';
    }
    
    return sendMessage(phone, message);
  }

  // Check if we're in a multi-step flow
  if (session && session.state) {
    return handleAdminState(phone, body, session, tenant);
  }

  // Check if input is a number and map to command
  const num = parseInt(body.trim(), 10);
  if (!isNaN(num) && COMMAND_MAP[num]) {
    lowerBody = COMMAND_MAP[num];
  }

  // Command routing
  if (lowerBody === 'today' || lowerBody === '1') {
    return listToday(phone, tenant);
  }

  if (lowerBody === 'appointments' || lowerBody === '2') {
    return listAppointments(phone, tenant);
  }

  if (lowerBody === 'services' || lowerBody === '3') {
    return listServices(phone, tenant);
  }

  if (lowerBody === 'add service' || lowerBody === '4') {
    return startAddService(phone, tenant);
  }

  if (lowerBody.startsWith('remove service') || lowerBody === '5') {
    const arg = body.substring('remove service'.length).trim();
    return removeService(phone, tenant, arg);
  }

  if (lowerBody === 'hours' || lowerBody === '6') {
    return showHours(phone, tenant);
  }

  if (lowerBody.startsWith('hours ')) {
    const arg = body.substring('hours'.length).trim();
    return updateHours(phone, tenant, arg);
  }

  if (lowerBody === 'link' || lowerBody === '7') {
    const link = generateBookingLink(process.env.BOT_PHONE_NUMBER, tenant.booking_code);
    return sendMessage(phone, `📎 Your booking link:\n${link}\n\nShare this with your clients so they can book appointments!`);
  }

  if (lowerBody.startsWith('cancel ') || lowerBody === '8') {
    const idStr = lowerBody === '8' ? '' : body.substring('cancel'.length).trim();
    if (lowerBody === '8' || !idStr) {
      return sendMessage(phone, 'Please provide an appointment ID.\nUsage: Type *CANCEL <id>* (e.g., CANCEL 42) or just the number with ID like *8 42*');
    }
    return cancelAppointment(phone, tenant, idStr);
  }

  if (lowerBody === 'reset') {
    await sessionService.clearSession(phone);
    return sendMessage(phone, 'Session reset. Type *HELP* or *9* to see available commands.');
  }

  if (lowerBody === 'help' || lowerBody === '9') {
    return showHelp(phone, tenant);
  }

  if (lowerBody === 'pdf' || lowerBody === '10') {
    return generateAppointmentsPDF(phone, tenant);
  }

  if (lowerBody === 'edit service' || lowerBody === '11') {
    return startEditService(phone, tenant);
  }

  if (lowerBody.startsWith('edit service ')) {
    const arg = body.substring('edit service'.length).trim();
    return startEditService(phone, tenant, arg);
  }

  // Unknown command - show help menu
  return showHelp(phone, tenant);
}

async function handleAdminState(phone, body, session, tenant) {
  const state = session.state;

  switch (state) {
    case 'add_service_name':
      return handleAddServiceName(phone, body, session, tenant);
    case 'add_service_duration':
      return handleAddServiceDuration(phone, body, session, tenant);
    case 'add_service_price':
      return handleAddServicePrice(phone, body, session, tenant);
    case 'edit_service_select_field':
    case 'edit_service_name':
    case 'edit_service_duration':
    case 'edit_service_price':
    case 'edit_service_multi_name':
    case 'edit_service_multi_duration':
    case 'edit_service_multi_price':
      return handleEditServiceState(phone, body, session, tenant);
    default:
      await sessionService.clearSession(phone);
      return sendMessage(phone, 'Something went wrong. Session reset. Type *help* for commands.');
  }
}

// --- Registration Flow ---

async function startRegistration(phone) {
  await sessionService.setSession(phone, {
    role: 'admin',
    state: 'awaiting_salon_name',
    context: {},
  });
  return sendMessage(
    phone,
    `🎉 Welcome to *OnTime* - Salon Booking System!\n\nLet's set up your salon. What is your *salon name*?`
  );
}

async function handleRegistrationState(phone, body, session) {
  const state = session.state;
  const lowerBody = body.trim().toLowerCase();

  // Handle 'back' command to go to previous step
  if (lowerBody === 'back') {
    return handleRegistrationGoBack(phone, session);
  }

  switch (state) {
    case 'awaiting_salon_name':
      return handleSalonName(phone, body, session);
    case 'awaiting_location':
      return handleLocation(phone, body, session);
    case 'awaiting_working_hours':
      return handleWorkingHours(phone, body, session);
    case 'awaiting_first_service_name':
      return handleFirstServiceName(phone, body, session);
    case 'awaiting_first_service_duration':
      return handleFirstServiceDuration(phone, body, session);
    case 'awaiting_first_service_price':
      return handleFirstServicePrice(phone, body, session);
    case 'awaiting_more_services':
      return handleMoreServices(phone, body, session);
    default:
      await sessionService.clearSession(phone);
      return sendMessage(phone, 'Something went wrong during registration. Please type *REGISTER* to start again.');
  }
}

async function handleSalonName(phone, body, session) {
  const name = body.trim();
  if (name.length < 2) {
    return sendMessage(phone, 'Please provide a valid salon name (at least 2 characters).\n_Type *BACK* to cancel_');
  }
  
  // Check if salon name already exists
  const existingTenant = await tenantModel.findByName(name);
  if (existingTenant) {
    return sendMessage(phone, `❌ Sorry, the salon name "${name}" is already registered. Please choose a different name.\n_Type *BACK* to cancel_`);
  }
  
  await sessionService.updateSession(phone, {
    state: 'awaiting_location',
    context: { salon_name: name, prev_state: 'awaiting_salon_name' },
  });
  return sendMessage(phone, `Great! *${name}* it is.\n\nNow, what is your *location*? (e.g., "123 Main St, Harare")\n_Type *BACK* to change your salon name_`);
}

async function handleLocation(phone, body, session) {
  const location = body.trim();
  if (location.length < 3) {
    return sendMessage(phone, 'Please provide a valid location.\n_Type *BACK* to change your salon name_');
  }
  await sessionService.updateSession(phone, {
    state: 'awaiting_working_hours',
    context: { ...session.context, location, prev_state: 'awaiting_location' },
  });
  return sendMessage(
    phone,
    `📍 Location set!\n\nNow set your *working hours*. You can:\n\n1️⃣ Type *DEFAULT* to use:\nMon-Sat: 09:00-17:00, Sun: closed\n\n2️⃣ Or type custom hours like:\nmon-fri 08:00-18:00, sat 09:00-14:00, sun closed\n_Type *BACK* to change your location_`
  );
}

async function handleWorkingHours(phone, body, session) {
  const input = body.trim().toLowerCase();
  let workingHours;

  if (input === 'default') {
    workingHours = { ...DEFAULT_WORKING_HOURS };
  } else {
    workingHours = parseWorkingHoursInput(input);
    if (!workingHours) {
      return sendMessage(
        phone,
        'Invalid format. Try:\n*DEFAULT* - for standard hours\nOr: *mon-fri 08:00-18:00, sat 09:00-14:00, sun closed*\n_Type *BACK* to change your location_'
      );
    }
  }

  await sessionService.updateSession(phone, {
    state: 'awaiting_first_service_name',
    context: { ...session.context, working_hours: workingHours, prev_state: 'awaiting_working_hours' },
  });
  return sendMessage(
    phone,
    `⏰ Working hours set!\n\nNow let's add your first *service*. What is the service name? (e.g., "Haircut")\n_Type *BACK* to change your working hours_`
  );
}

async function handleFirstServiceName(phone, body, session) {
  const name = body.trim();
  if (name.length < 2) {
    return sendMessage(phone, 'Please provide a valid service name.\n_Type *BACK* to change your working hours_');
  }
  await sessionService.updateSession(phone, {
    state: 'awaiting_first_service_duration',
    context: { ...session.context, temp_service_name: name, prev_state: 'awaiting_first_service_name' },
  });
  return sendMessage(phone, `How long does *${name}* take? (in minutes, e.g., "30")\n_Type *BACK* to change the service name_`);
}

async function handleFirstServiceDuration(phone, body, session) {
  const duration = parseInt(body.trim(), 10);
  if (isNaN(duration) || duration < 5 || duration > 480) {
    return sendMessage(phone, 'Please provide a valid duration in minutes (5-480).\n_Type *BACK* to change the service name_');
  }
  await sessionService.updateSession(phone, {
    state: 'awaiting_first_service_price',
    context: { ...session.context, temp_service_duration: duration, prev_state: 'awaiting_first_service_duration' },
  });
  return sendMessage(phone, `What is the price for *${session.context.temp_service_name}*? (e.g., "15.00")\n_Type *BACK* to change the duration_`);
}

async function handleFirstServicePrice(phone, body, session) {
  const price = parseFloat(body.trim().replace('$', ''));
  if (isNaN(price) || price < 0) {
    return sendMessage(phone, 'Please provide a valid price (e.g., "15.00").');
  }

  const ctx = session.context;
  const bookingCode = generateBookingCode();

  try {
    // Create the tenant
    const tenant = await tenantModel.create({
      name: ctx.salon_name,
      location: ctx.location,
      ownerPhone: phone,
      bookingCode,
      workingHours: ctx.working_hours,
    });

    // Create the first service
    await serviceModel.create({
      tenantId: tenant.id,
      name: ctx.temp_service_name,
      durationMinutes: ctx.temp_service_duration,
      price,
    });

    // Get dynamic trial period days and create subscription
    const trialPeriodDays = await systemSettingsModel.getTrialPeriodDays();
    const trialExpiryDate = new Date();
    trialExpiryDate.setDate(trialExpiryDate.getDate() + trialPeriodDays);
    
    await subscriptionModel.create({
      tenantId: tenant.id,
      startDate: new Date(),
      expiryDate: trialExpiryDate,
      subscriptionStatus: 'trial',
    });

    const bookingLink = generateBookingLink(process.env.BOT_PHONE_NUMBER, bookingCode);

    await sessionService.updateSession(phone, {
      role: 'admin',
      state: 'awaiting_more_services',
      tenant_id: tenant.id,
      context: {},
    });

    return sendMessage(
      phone,
      `✅ *Registration Complete!*\n\n` +
        `👔 You are now the verified owner of *${tenant.name}*!\n\n` +
        `🎁 *FREE TRIAL PERIOD* 🎁\n` +
        `You have *${trialPeriodDays} days* to try all features for FREE!\n` +
        `Your trial expires on: *${trialExpiryDate.toLocaleDateString()}*\n\n` +
        `📍 Location: ${tenant.location}\n` +
        `🔗 Booking Code: *${bookingCode}*\n` +
        `📎 Booking Link:\n${bookingLink}\n\n` +
        `First service added: *${ctx.temp_service_name}* (${ctx.temp_service_duration} min, ${formatCurrency(price)})\n\n` +
        `*As the salon owner, use the menu to access:*\n` +
        `• Appointments viewing\n` +
        `• Add/remove services\n` +
        `• Manage working hours\n` +
        `• And more features\n\n` +
        `📖 Type *HELP* or *9* anytime to see the full menu.\n\n` +
        `Would you like to add another service? Type the service name or type *DONE* to finish setup.`
    );
  } catch (err) {
    logger.error(`Registration error: ${err.message}`);
    return sendMessage(phone, 'Sorry, there was an error during registration. Please try again with *register*.');
  }
}

async function handleMoreServices(phone, body, session) {
  const input = body.trim().toLowerCase();

  if (input === 'done' || input === 'no') {
    await sessionService.setSession(phone, {
      role: 'admin',
      state: null,
      tenant_id: session.tenant_id,
      context: {},
    });
    return sendMessage(
      phone,
      `🎉 Setup complete! Your salon is ready to accept bookings.\n\nType *help* to see all available commands.`
    );
  }

  // Treat as a new service name
  await sessionService.updateSession(phone, {
    state: 'add_service_name_reg',
    context: { temp_service_name: body.trim() },
  });

  // Skip directly to asking duration since we already have the name
  await sessionService.updateSession(phone, {
    state: 'awaiting_reg_service_duration',
    context: { temp_service_name: body.trim() },
  });

  return sendMessage(phone, `How long does *${body.trim()}* take? (in minutes)`);
}

// This handles additional services during registration
async function handleRegServiceDuration(phone, body, session) {
  const duration = parseInt(body.trim(), 10);
  if (isNaN(duration) || duration < 5 || duration > 480) {
    return sendMessage(phone, 'Please provide a valid duration in minutes (5-480).');
  }
  await sessionService.updateSession(phone, {
    state: 'awaiting_reg_service_price',
    context: { temp_service_duration: duration },
  });
  return sendMessage(phone, `What is the price for *${session.context.temp_service_name}*?`);
}

async function handleRegServicePrice(phone, body, session) {
  const price = parseFloat(body.trim().replace('$', ''));
  if (isNaN(price) || price < 0) {
    return sendMessage(phone, 'Please provide a valid price.');
  }

  const ctx = session.context;
  await serviceModel.create({
    tenantId: session.tenant_id,
    name: ctx.temp_service_name,
    durationMinutes: ctx.temp_service_duration,
    price,
  });

  await sessionService.updateSession(phone, {
    state: 'awaiting_more_services',
    context: {},
  });

  return sendMessage(
    phone,
    `✅ Service added: *${ctx.temp_service_name}* (${ctx.temp_service_duration} min, ${formatCurrency(price)})\n\nAdd another service name or type *done* to finish.`
  );
}

async function handleRegistrationGoBack(phone, session) {
  const prevState = session.context.prev_state;

  if (!prevState) {
    return sendMessage(phone, 'You are at the first step. Type *CANCEL* to stop the registration.');
  }

  // Restore previous state and remove the "back" tracking
  await sessionService.updateSession(phone, {
    state: prevState,
    context: { ...session.context, prev_state: null },
  });

  // Re-prompt based on previous state
  switch (prevState) {
    case 'awaiting_salon_name': {
      return sendMessage(
        phone,
        `Going back...\n\n🎉 Let's set up your salon. What is your *salon name*?`
      );
    }
    case 'awaiting_location': {
      const salonName = session.context.salon_name || 'your salon';
      return sendMessage(
        phone,
        `Going back...\n\nGreat! *${salonName}* it is.\n\nNow, what is your *location*? (e.g., "123 Main St, Harare")\n_Type *BACK* to change your salon name_`
      );
    }
    case 'awaiting_working_hours': {
      return sendMessage(
        phone,
        `Going back...\n\n📍 Location set!\n\nNow set your *working hours*. You can:\n\n1️⃣ Type *DEFAULT* to use:\nMon-Sat: 09:00-17:00, Sun: closed\n\n2️⃣ Or type custom hours like:\nmon-fri 08:00-18:00, sat 09:00-14:00, sun closed\n_Type *BACK* to change your location_`
      );
    }
    case 'awaiting_first_service_name': {
      return sendMessage(
        phone,
        `Going back...\n\n⏰ Working hours set!\n\nNow let's add your first *service*. What is the service name? (e.g., "Haircut")\n_Type *BACK* to change your working hours_`
      );
    }
    case 'awaiting_first_service_duration': {
      const serviceName = session.context.temp_service_name || 'this service';
      return sendMessage(
        phone,
        `Going back...\n\nHow long does *${serviceName}* take? (in minutes, e.g., "30")\n_Type *BACK* to change the service name_`
      );
    }
    default:
      return sendMessage(phone, 'Cannot go back further. Type *CANCEL* to stop the registration.');
  }
}

async function handleRegistrationSubState(phone, body, session) {
  switch (session.state) {
    case 'awaiting_reg_service_duration':
      return handleRegServiceDuration(phone, body, session);
    case 'awaiting_reg_service_price':
      return handleRegServicePrice(phone, body, session);
    case 'awaiting_more_services':
      return handleMoreServices(phone, body, session);
    default:
      return null;
  }
}

// --- Admin Commands ---

async function listServices(phone, tenant) {
  const services = await serviceModel.findByTenant(tenant.id);
  if (services.length === 0) {
    return sendMessage(phone, 'No services found. Use *add service* to add one.');
  }
  const table = formatServiceTable(services, { showId: true });
  return sendMessage(phone, `💇 *Services for ${tenant.name}*\n\n${table}\n\n_Type *BACK* to return to main menu_`);
}

async function startAddService(phone, tenant) {
  await sessionService.setSession(phone, {
    role: 'admin',
    state: 'add_service_name',
    tenant_id: tenant.id,
    context: { prev_state: 'menu' },
  });
  return sendMessage(phone, `➕ *Add Service*\n\nWhat is the *name* of the new service?\n\n_Type *BACK* to cancel_`);
}

async function handleAddServiceName(phone, body, session, tenant) {
  const lowerBody = body.trim().toLowerCase();
  if (lowerBody === 'back') {
    await sessionService.clearSession(phone);
    return showHelp(phone, tenant);
  }
  
  const name = body.trim();
  if (name.length < 2) {
    return sendMessage(phone, 'Please provide a valid service name.\n\n_Type *BACK* to cancel_');
  }
  await sessionService.updateSession(phone, {
    state: 'add_service_duration',
    context: { ...session.context, temp_service_name: name, prev_state: 'add_service_name' },
  });
  return sendMessage(phone, `➕ *Add Service*\n\nService: *${name}*\n\nHow long does it take? (in minutes)\n\n_Type *BACK* to go back_`);
}

async function handleAddServiceDuration(phone, body, session, tenant) {
  const lowerBody = body.trim().toLowerCase();
  if (lowerBody === 'back') {
    await sessionService.updateSession(phone, {
      state: 'add_service_name',
      context: { prev_state: 'menu' },
    });
    return sendMessage(phone, `➕ *Add Service*\n\nWhat is the *name* of the new service?\n\n_Type *BACK* to cancel_`);
  }
  
  const duration = parseInt(body.trim(), 10);
  if (isNaN(duration) || duration < 5 || duration > 480) {
    return sendMessage(phone, 'Please provide a valid duration in minutes (5-480).\n\n_Type *BACK* to go back_');
  }
  await sessionService.updateSession(phone, {
    state: 'add_service_price',
    context: { ...session.context, temp_service_duration: duration, prev_state: 'add_service_duration' },
  });
  return sendMessage(phone, `➕ *Add Service*\n\nService: *${session.context.temp_service_name}*\nDuration: *${duration} minutes*\n\nWhat is the price?\n\n_Type *BACK* to go back_`);
}

async function handleAddServicePrice(phone, body, session, tenant) {
  const lowerBody = body.trim().toLowerCase();
  if (lowerBody === 'back') {
    await sessionService.updateSession(phone, {
      state: 'add_service_duration',
      context: { ...session.context, prev_state: 'add_service_name' },
    });
    return sendMessage(phone, `➕ *Add Service*\n\nService: *${session.context.temp_service_name}*\n\nHow long does it take? (in minutes)\n\n_Type *BACK* to go back_`);
  }
  
  const price = parseFloat(body.trim().replace('$', ''));
  if (isNaN(price) || price < 0) {
    return sendMessage(phone, 'Please provide a valid price.\n\n_Type *BACK* to go back_');
  }

  const ctx = session.context;
  const service = await serviceModel.create({
    tenantId: tenant.id,
    name: ctx.temp_service_name,
    durationMinutes: ctx.temp_service_duration,
    price,
  });

  await sessionService.clearSession(phone);

  return sendMessage(
    phone,
    `✅ Service added: *${service.name}* (${service.duration_minutes} min, ${formatCurrency(service.price)})\n\n_Type *BACK* for main menu_`
  );
}

async function removeService(phone, tenant, arg) {
  if (!arg) {
    return sendMessage(phone, 'Please specify a service ID or name.\nUsage: *remove service <id or name>*');
  }

  let removed;
  const id = parseInt(arg, 10);
  if (!isNaN(id)) {
    removed = await serviceModel.remove(id, tenant.id);
  } else {
    removed = await serviceModel.removeByName(arg, tenant.id);
  }

  if (!removed) {
    return sendMessage(phone, `Service not found: "${arg}". Use *services* to see your service list.\n\n_Type *BACK* for main menu_`);
  }
  return sendMessage(phone, `🗑️ Service removed: *${removed.name}*\n\n_Type *BACK* for main menu_`);
}

async function showHours(phone, tenant) {
  const wh = tenant.working_hours;
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const lines = days.map((d) => {
    const val = wh[d] || 'closed';
    return `*${d.charAt(0).toUpperCase() + d.slice(1)}*: ${val}`;
  });
  return sendMessage(
    phone,
    `⏰ *Working Hours for ${tenant.name}*\n\n${lines.join('\n')}\n\nTo update: *hours <day> <time>*\nExample: *hours monday 08:00-18:00*\n\n_Type *BACK* for main menu_`
  );
}

async function updateHours(phone, tenant, arg) {
  // Format: "monday 09:00-18:00" or "monday closed"
  const parts = arg.trim().split(/\s+/);
  if (parts.length < 2) {
    return sendMessage(phone, 'Usage: *hours <day> <time-range or closed>*\nExample: *hours monday 08:00-18:00*');
  }

  const day = parts[0].toLowerCase();
  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (!validDays.includes(day)) {
    return sendMessage(phone, `Invalid day: "${day}". Use one of: ${validDays.join(', ')}`);
  }

  const value = parts.slice(1).join(' ').trim().toLowerCase();
  if (value !== 'closed' && !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(value)) {
    return sendMessage(phone, 'Invalid format. Use *HH:MM-HH:MM* or *closed*.\nExample: *hours monday 08:00-18:00*');
  }

  const wh = { ...tenant.working_hours };
  wh[day] = value;
  await tenantModel.updateWorkingHours(tenant.id, wh);

  return sendMessage(phone, `✅ Working hours updated!\n*${day.charAt(0).toUpperCase() + day.slice(1)}*: ${value}\n\n_Type *BACK* for main menu_`);
}

async function listAppointments(phone, tenant) {
  const appointments = await appointmentModel.findUpcomingByTenant(tenant.id);
  if (appointments.length === 0) {
    return sendMessage(phone, 'No upcoming appointments in the next 7 days.\n\n_Type *BACK* to return to main menu_');
  }

  const lines = appointments.map((a, i) => {
    const hTime = toHarareTime(a.start_time);
    const dateStr = hTime.toISOString().split('T')[0];
    const timeStr = formatTime(hTime);
    return `${i + 1}. ${formatDateLong(dateStr)} at ${timeStr} - *${a.service_name || 'Service'}* (${a.client_name}) [ID: ${a.id}]`;
  });

  return sendMessage(
    phone,
    `📅 *Upcoming Appointments (next 7 days)*\n\n${lines.join('\n')}\n\nTo cancel: *cancel <id>*\n_Type *BACK* to return to main menu_`
  );
}

async function listToday(phone, tenant) {
  const harareDateStr = todayHarare();

  // Convert to UTC for query
  const utcDate = new Date(`${harareDateStr}T00:00:00Z`);
  utcDate.setUTCHours(utcDate.getUTCHours() - HARARE_OFFSET_HOURS);
  const utcDateStr = utcDate.toISOString().split('T')[0];

  let appointments = await appointmentModel.findByTenantAndDate(tenant.id, utcDateStr);

  // Also check next UTC day since Harare day may span two UTC days
  const nextUtcDate = new Date(utcDate);
  nextUtcDate.setUTCDate(nextUtcDate.getUTCDate() + 1);
  const nextUtcDateStr = nextUtcDate.toISOString().split('T')[0];
  if (nextUtcDateStr !== utcDateStr) {
    const moreAppts = await appointmentModel.findByTenantAndDate(tenant.id, nextUtcDateStr);
    appointments = appointments.concat(moreAppts);
  }

  // Filter to Harare "today" window
  const harareStart = new Date(`${harareDateStr}T00:00:00Z`);
  harareStart.setUTCHours(harareStart.getUTCHours() - HARARE_OFFSET_HOURS);
  const harareEnd = new Date(harareStart);
  harareEnd.setUTCDate(harareEnd.getUTCDate() + 1);

  appointments = appointments.filter((a) => {
    const st = new Date(a.start_time).getTime();
    return st >= harareStart.getTime() && st < harareEnd.getTime();
  });

  appointments.sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  if (appointments.length === 0) {
    return sendMessage(phone, `No appointments scheduled for today (${formatDateLong(harareDateStr)}).\n\n_Type *BACK* to return to main menu_`);
  }

  const lines = appointments.map((a, i) => {
    const hTime = toHarareTime(a.start_time);
    const time = formatTime(hTime);
    return `${i + 1}. ${time} - *${a.service_name || 'Service'}* (${a.client_name}) [ID: ${a.id}]`;
  });

  return sendMessage(
    phone,
    `📋 *Today's Appointments (${formatDateLong(harareDateStr)})*

${lines.join('\n')}

Total: ${appointments.length}

_Type *BACK* to return to main menu_`
  );
}

async function cancelAppointment(phone, tenant, idStr) {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return sendMessage(phone, 'Please provide a valid appointment ID.\nUsage: *cancel <id>*');
  }

  const cancelled = await appointmentModel.cancel(id, tenant.id);
  if (!cancelled) {
    return sendMessage(phone, `Appointment #${id} not found or already cancelled.`);
  }

  return sendMessage(phone, `✅ Appointment #${id} has been cancelled.\n\n_Type *BACK* to return to main menu_`);
}

async function showHelp(phone, tenant) {
  const link = generateBookingLink(process.env.BOT_PHONE_NUMBER, tenant.booking_code);
  return sendMessage(
    phone,
    `📖 *OnTime Commands*

` +
      `*Quick commands (type the NUMBER):*
` +
      `1️⃣ *TODAY* - Today's appointments
` +
      `2️⃣ *APPOINTMENTS* - Upcoming appointments (7 days)
` +
      `3️⃣ *SERVICES* - List your services
` +
      `4️⃣ *ADD SERVICE* - Add a new service
` +
      `5️⃣ *REMOVE SERVICE <id>* - Remove a service
` +
      `6️⃣ *HOURS* - View/set working hours
` +
      `7️⃣ *LINK* - Get your booking link
` +
      `8️⃣ *CANCEL <id>* - Cancel an appointment
` +
      `9️⃣ *HELP* - Show this menu
` +
      `🔟 *PDF* - Export appointments to PDF
` +
      `1️⃣1️⃣ *EDIT SERVICE* - Edit a service

` +
      `*Examples:*
` +
      `Type *6 monday 08:00-18:00* to set hours
` +
      `Type *8* to cancel appointment #42

` +
      `_Type *BACK* at any time to return to this menu_
` +
      `_Type *CANCEL* to exit current operation_

` +
      `📎 Your booking link:\n${link}`
  );
}

// --- Helper ---

function parseWorkingHoursInput(input) {
  const result = { ...DEFAULT_WORKING_HOURS };
  const dayAbbrevMap = {
    mon: 'monday', tue: 'tuesday', wed: 'wednesday', thu: 'thursday',
    fri: 'friday', sat: 'saturday', sun: 'sunday',
    monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
    thursday: 'thursday', friday: 'friday', saturday: 'saturday', sunday: 'sunday',
  };

  const segments = input.split(',').map((s) => s.trim());

  for (const segment of segments) {
    const parts = segment.split(/\s+/);
    if (parts.length < 2) continue;

    const dayPart = parts[0];
    const timePart = parts.slice(1).join(' ').trim();

    // Handle range like "mon-fri"
    if (dayPart.includes('-')) {
      const [startDay, endDay] = dayPart.split('-');
      const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const startFull = dayAbbrevMap[startDay];
      const endFull = dayAbbrevMap[endDay];
      if (!startFull || !endFull) continue;

      const startIdx = allDays.indexOf(startFull);
      const endIdx = allDays.indexOf(endFull);
      if (startIdx === -1 || endIdx === -1) continue;

      for (let i = startIdx; i <= endIdx; i++) {
        result[allDays[i]] = timePart;
      }
    } else {
      const fullDay = dayAbbrevMap[dayPart];
      if (fullDay) {
        result[fullDay] = timePart;
      }
    }
  }

  return result;
}

async function handlePaymentConfirmation(phone, tenant, body) {
  // Parse: PAID <amount> <method>
  const parts = body.trim().split(/\s+/);
  const amount = parts[1];
  const method = parts.slice(2).join(' ') || 'Not specified';
  
  // Notify super admin
  const adminPhone = process.env.SUPER_ADMIN_PHONE || process.env.BOT_PHONE_NUMBER;
  if (adminPhone) {
    sendMessage(
      adminPhone,
      `💰 *Payment Report*\n\n` +
        `Salon: *${tenant.name}*\n` +
        `Phone: ${phone}\n` +
        `Amount: $${amount}\n` +
        `Method: ${method}\n\n` +
        `To activate, go to: /admin/salon/${tenant.id}`
    ).catch((err) => logger.error(`Failed to notify admin of payment: ${err.message}`));
  }
  
  return sendMessage(
    phone,
    `✅ *Payment Reported!*\n\n` +
      `Amount: $${amount}\n` +
      `Method: ${method}\n\n` +
      `Thank you! We're verifying your payment and will activate your account shortly. You'll receive a confirmation message once active.`
  );
}

// --- PDF Export ---

async function generateAppointmentsPDF(phone, tenant) {
  try {
    const appointments = await appointmentModel.findAllByTenant(tenant.id);
    
    if (appointments.length === 0) {
      return sendMessage(phone, '📭 No appointments to export.\n\nType *2* to see upcoming appointments.\n_Type *BACK* for main menu_');
    }

    // Create PDF
    const doc = new PDFDocument();
    const fileName = `appointments_${tenant.booking_code}_${new Date().toISOString().split('T')[0]}.pdf`;
    const filePath = path.join(__dirname, '..', 'temp', fileName);
    
    // Ensure temp directory exists
    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    
    // Header
    doc.fontSize(20).text(tenant.name, 50, 50);
    doc.fontSize(12).text(`Appointment Report - ${new Date().toLocaleDateString()}`, 50, 75);
    doc.moveDown();
    
    // Table header
    doc.fontSize(10).text('Date', 50, 110);
    doc.text('Time', 150, 110);
    doc.text('Client Name', 220, 110);
    doc.text('Service', 380, 110);
    
    doc.moveTo(50, 125).lineTo(550, 125).stroke();
    
    let y = 135;
    
    for (const appt of appointments) {
      const hTime = toHarareTime(appt.start_time);
      const dateStr = hTime.toISOString().split('T')[0];
      const timeStr = formatTime(hTime);
      
      // Check if we need a new page
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      
      doc.fontSize(9).text(dateStr, 50, y);
      doc.text(timeStr, 150, y);
      doc.text(appt.client_name, 220, y);
      doc.text(appt.service_name || 'N/A', 380, y);
      
      y += 20;
    }
    
    doc.end();
    
    // Wait for file to be written
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    
    // Send file via WhatsApp (if supported) or provide download link
    // For now, send confirmation message
    return sendMessage(
      phone,
      `📄 *Appointments PDF Generated!*\n\n` +
      `✅ Found ${appointments.length} appointments\n` +
      `📁 File: ${fileName}\n\n` +
      `The PDF contains all confirmed appointments in chronological order with client names, dates, and times.\n\n` +
      `*Note:* PDF download feature coming soon. For now, use *2* (APPOINTMENTS) to view your schedule.\n\n` +
      `_Type *BACK* for main menu_`
    );
  } catch (err) {
    logger.error(`PDF generation error: ${err.message}`);
    return sendMessage(phone, '❌ Error generating PDF. Please try again.');
  }
}

// --- Edit Service ---

async function startEditService(phone, tenant, serviceIdOrName = null) {
  const services = await serviceModel.findByTenant(tenant.id);
  
  if (services.length === 0) {
    return sendMessage(phone, '❌ You have no services to edit. Add one first with *ADD SERVICE* (4)');
  }
  
  // If service ID or name provided, try to find it
  if (serviceIdOrName) {
    let service = null;
    const arg = serviceIdOrName.trim();
    
    // First, try to parse as a list number (1, 2, 3...)
    const listNum = parseInt(arg, 10);
    if (!isNaN(listNum) && listNum >= 1 && listNum <= services.length) {
      service = services[listNum - 1]; // Convert to 0-based index
    } else {
      // Try by ID
      const byId = services.find(s => s.id.toString() === arg);
      if (byId) {
        service = byId;
      } else {
        // Try by name (case insensitive)
        const byName = services.find(s => s.name.toLowerCase() === arg.toLowerCase());
        if (byName) {
          service = byName;
        }
      }
    }
    
    if (!service) {
      const serviceList = services.map((s, i) => `${i + 1}. ${s.name} (${s.duration_minutes} min, $${s.price})`).join('\n');
      return sendMessage(
        phone,
        `❌ Service "${arg}" not found.\n\n` +
        `Available services:\n${serviceList}\n\n` +
        `Type e.g *EDIT SERVICE 1* to edit, or *BACK* to return to menu.`
      );
    }
    
    // Start edit flow
    await sessionService.setSession(phone, {
      role: 'admin',
      state: 'edit_service_select_field',
      tenant_id: tenant.id,
      context: {
        edit_service_id: service.id,
        edit_service_name: service.name,
        edit_service_duration: service.duration_minutes,
        edit_service_price: service.price,
      },
    });
    
    return sendMessage(
      phone,
      `✏️ *Editing Service: ${service.name}*\n\n` +
      `Current details:\n` +
      `• Name: ${service.name}\n` +
      `• Duration: ${service.duration_minutes} minutes\n` +
      `• Price: $${service.price}\n\n` +
      `What would you like to edit?\n\n` +
      `1️⃣ *Name*\n` +
      `2️⃣ *Duration*\n` +
      `3️⃣ *Price*\n` +
      `4️⃣ *Multiple fields*\n\n` +
      `Type the number, *BACK* to return to menu, or *CANCEL* to abort.`
    );
  }
  
  // Show list of services to select from (numbered 1, 2, 3...)
  const serviceList = services.map((s, i) => `${i + 1}. ${s.name} (${s.duration_minutes} min, $${s.price})`).join('\n');
  
  return sendMessage(
    phone,
    `✏️ *Edit Service*\n\n` +
    `Select a service to edit:\n\n${serviceList}\n\n` +
    `Type e.g *EDIT SERVICE 1* to edit, or *BACK* to return to menu.`
  );
}

async function handleEditServiceState(phone, body, session, tenant) {
  const state = session.state;
  const ctx = session.context;
  const lowerBody = body.trim().toLowerCase();
  
  if (lowerBody === 'cancel' || lowerBody === 'back') {
    await sessionService.clearSession(phone);
    return sendMessage(phone, '✏️ Service editing cancelled. Type *HELP* for menu.');
  }
  
  switch (state) {
    case 'edit_service_select_field':
      return handleEditServiceSelectField(phone, body, session, tenant);
    case 'edit_service_name':
      return handleEditServiceName(phone, body, session, tenant);
    case 'edit_service_duration':
      return handleEditServiceDuration(phone, body, session, tenant);
    case 'edit_service_price':
      return handleEditServicePrice(phone, body, session, tenant);
    case 'edit_service_multi_name':
      return handleEditServiceMultiName(phone, body, session, tenant);
    case 'edit_service_multi_duration':
      return handleEditServiceMultiDuration(phone, body, session, tenant);
    case 'edit_service_multi_price':
      return handleEditServiceMultiPrice(phone, body, session, tenant);
    default:
      await sessionService.clearSession(phone);
      return sendMessage(phone, '❌ Something went wrong. Please try again.');
  }
}

async function handleEditServiceSelectField(phone, body, session, tenant) {
  const input = body.trim();
  const lowerInput = input.toLowerCase();
  const num = parseInt(input, 10);
  const ctx = session.context;
  
  if (lowerInput === 'back') {
    await sessionService.clearSession(phone);
    return showHelp(phone, tenant);
  }
  
  if (num === 1 || lowerInput === 'name') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_name',
      context: { ...ctx, prev_state: 'edit_service_select_field' },
    });
    return sendMessage(phone, `✏️ Current name: *${ctx.edit_service_name}*\n\nEnter the new service name:\n\n_Type *BACK* to return to menu_`);
  }
  
  if (num === 2 || lowerInput === 'duration') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_duration',
      context: { ...ctx, prev_state: 'edit_service_select_field' },
    });
    return sendMessage(phone, `✏️ Current duration: *${ctx.edit_service_duration} minutes*\n\nEnter the new duration in minutes:\n\n_Type *BACK* to return to menu_`);
  }
  
  if (num === 3 || lowerInput === 'price') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_price',
      context: { ...ctx, prev_state: 'edit_service_select_field' },
    });
    return sendMessage(phone, `✏️ Current price: *$${ctx.edit_service_price}*\n\nEnter the new price (e.g., 25 or 25.50):\n\n_Type *BACK* to return to menu_`);
  }
  
  if (num === 4 || lowerInput === 'multiple' || lowerInput === 'multi') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_multi_name',
      context: { ...ctx, prev_state: 'edit_service_select_field' },
    });
    return sendMessage(phone, `✏️ Let's edit all fields.\n\nCurrent name: *${ctx.edit_service_name}*\nEnter the new service name (or type *SAME* to keep it):\n\n_Type *BACK* to return to menu_`);
  }
  
  return sendMessage(phone, '❌ Invalid option. Type 1-4, *BACK* to return to menu, or *CANCEL* to abort.');
}

async function handleEditServiceName(phone, body, session, tenant) {
  const lowerBody = body.trim().toLowerCase();
  const newName = body.trim();
  const ctx = session.context;
  
  if (lowerBody === 'back') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_select_field',
      context: { ...ctx },
    });
    return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nWhat would you like to edit?\n\n1️⃣ *Name*\n2️⃣ *Duration*\n3️⃣ *Price*\n4️⃣ *Multiple fields*\n\nType the number, *BACK* to return to menu, or *CANCEL* to abort.`);
  }
  
  if (newName.length < 2) {
    return sendMessage(phone, '❌ Service name must be at least 2 characters. Try again:\n\n_Type *BACK* to return to menu_');
  }
  
  try {
    await serviceModel.update(ctx.edit_service_id, tenant.id, { name: newName });
    await sessionService.clearSession(phone);
    return sendMessage(phone, `✅ Service name updated!\n\n*${ctx.edit_service_name}* → *${newName}*\n\nType *BACK* for main menu or *3* to see your updated services.`);
  } catch (err) {
    logger.error(`Edit service name error: ${err.message}`);
    return sendMessage(phone, '❌ Error updating service. Please try again.');
  }
}

async function handleEditServiceDuration(phone, body, session, tenant) {
  const lowerBody = body.trim().toLowerCase();
  const minutes = parseInt(body.trim(), 10);
  const ctx = session.context;
  
  if (lowerBody === 'back') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_select_field',
      context: { ...ctx },
    });
    return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nWhat would you like to edit?\n\n1️⃣ *Name*\n2️⃣ *Duration*\n3️⃣ *Price*\n4️⃣ *Multiple fields*\n\nType the number, *BACK* to return to menu, or *CANCEL* to abort.`);
  }
  
  if (isNaN(minutes) || minutes < 5 || minutes > 480) {
    return sendMessage(phone, '❌ Please enter a valid duration between 5 and 480 minutes. Try again:\n\n_Type *BACK* to return to menu_');
  }
  
  try {
    await serviceModel.update(ctx.edit_service_id, tenant.id, { durationMinutes: minutes });
    await sessionService.clearSession(phone);
    return sendMessage(phone, `✅ Service duration updated!\n\n*${ctx.edit_service_name}*: ${ctx.edit_service_duration} min → ${minutes} min\n\nType *BACK* for main menu or *3* to see your updated services.`);
  } catch (err) {
    logger.error(`Edit service duration error: ${err.message}`);
    return sendMessage(phone, '❌ Error updating service. Please try again.');
  }
}

async function handleEditServicePrice(phone, body, session, tenant) {
  const lowerBody = body.trim().toLowerCase();
  const price = parseFloat(body.trim());
  const ctx = session.context;
  
  if (lowerBody === 'back') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_select_field',
      context: { ...ctx },
    });
    return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nWhat would you like to edit?\n\n1️⃣ *Name*\n2️⃣ *Duration*\n3️⃣ *Price*\n4️⃣ *Multiple fields*\n\nType the number, *BACK* to return to menu, or *CANCEL* to abort.`);
  }
  
  if (isNaN(price) || price < 0) {
    return sendMessage(phone, '❌ Please enter a valid price (e.g., 25 or 25.50). Try again:\n\n_Type *BACK* to return to menu_');
  }
  
  try {
    await serviceModel.update(ctx.edit_service_id, tenant.id, { price });
    await sessionService.clearSession(phone);
    return sendMessage(phone, `✅ Service price updated!\n\n*${ctx.edit_service_name}*: $${ctx.edit_service_price} → $${price}\n\nType *BACK* for main menu or *3* to see your updated services.`);
  } catch (err) {
    logger.error(`Edit service price error: ${err.message}`);
    return sendMessage(phone, '❌ Error updating service. Please try again.');
  }
}

async function handleEditServiceMultiName(phone, body, session, tenant) {
  const input = body.trim();
  const lowerInput = input.toLowerCase();
  const ctx = session.context;
  
  if (lowerInput === 'back') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_select_field',
      context: { ...ctx },
    });
    return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nWhat would you like to edit?\n\n1️⃣ *Name*\n2️⃣ *Duration*\n3️⃣ *Price*\n4️⃣ *Multiple fields*\n\nType the number, *BACK* to return to menu, or *CANCEL* to abort.`);
  }
  
  const newName = lowerInput === 'same' ? ctx.edit_service_name : input;
  
  await sessionService.updateSession(phone, {
    state: 'edit_service_multi_duration',
    context: { ...ctx, new_service_name: newName, prev_state: 'edit_service_multi_name' },
  });
  
  return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nCurrent duration: *${ctx.edit_service_duration} minutes*\n\nEnter the new duration in minutes (or type *SAME*):\n\n_Type *BACK* to return to menu_`);
}

async function handleEditServiceMultiDuration(phone, body, session, tenant) {
  const input = body.trim();
  const lowerInput = input.toLowerCase();
  const ctx = session.context;
  
  if (lowerInput === 'back') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_multi_name',
      context: { ...ctx },
    });
    return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nCurrent name: *${ctx.edit_service_name}*\n\nEnter the new service name (or type *SAME* to keep it):\n\n_Type *BACK* to return to menu_`);
  }
  
  let newDuration;
  if (lowerInput === 'same') {
    newDuration = ctx.edit_service_duration;
  } else {
    newDuration = parseInt(input, 10);
    if (isNaN(newDuration) || newDuration < 5 || newDuration > 480) {
      return sendMessage(phone, '❌ Please enter a valid duration (5-480 min) or *SAME*. Try again:\n\n_Type *BACK* to return to menu_');
    }
  }
  
  await sessionService.updateSession(phone, {
    state: 'edit_service_multi_price',
    context: { ...ctx, new_service_duration: newDuration, prev_state: 'edit_service_multi_duration' },
  });
  
  return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nCurrent price: *$${ctx.edit_service_price}*\n\nEnter the new price (or type *SAME*):\n\n_Type *BACK* to return to menu_`);
}

async function handleEditServiceMultiPrice(phone, body, session, tenant) {
  const input = body.trim();
  const lowerInput = input.toLowerCase();
  const ctx = session.context;
  
  if (lowerInput === 'back') {
    await sessionService.updateSession(phone, {
      state: 'edit_service_multi_duration',
      context: { ...ctx },
    });
    return sendMessage(phone, `✏️ *Editing Service: ${ctx.edit_service_name}*\n\nCurrent duration: *${ctx.edit_service_duration} minutes*\n\nEnter the new duration in minutes (or type *SAME*):\n\n_Type *BACK* to return to menu_`);
  }
  
  let newPrice;
  if (lowerInput === 'same') {
    newPrice = ctx.edit_service_price;
  } else {
    newPrice = parseFloat(input);
    if (isNaN(newPrice) || newPrice < 0) {
      return sendMessage(phone, '❌ Please enter a valid price or *SAME*. Try again:\n\n_Type *BACK* to return to menu_');
    }
  }
  
  try {
    await serviceModel.update(ctx.edit_service_id, tenant.id, {
      name: ctx.new_service_name,
      durationMinutes: ctx.new_service_duration,
      price: newPrice,
    });
    await sessionService.clearSession(phone);
    return sendMessage(
      phone,
      `✅ Service updated successfully!\n\n` +
      `*${ctx.edit_service_name}* → *${ctx.new_service_name}*\n` +
      `Duration: ${ctx.edit_service_duration} min → ${ctx.new_service_duration} min\n` +
      `Price: $${ctx.edit_service_price} → $${newPrice}\n\n` +
      `Type *BACK* for main menu or *3* to see your updated services.`
    );
  } catch (err) {
    logger.error(`Edit service multi error: ${err.message}`);
    return sendMessage(phone, '❌ Error updating service. Please try again.');
  }
}

module.exports = {
  handleAdminMessage,
  startRegistration,
  handleRegistrationState,
  handleRegistrationSubState,
};
