const tenantModel = require('../models/tenant');
const serviceModel = require('../models/service');
const appointmentModel = require('../models/appointment');
const sessionService = require('../services/session');
const { sendMessage } = require('../services/whatsapp');
const { generateBookingCode, formatCurrency, formatServiceTable, generateBookingLink } = require('../utils/helpers');
const { formatDateTime, toHarareTime, formatTime, todayHarare, HARARE_OFFSET_HOURS, formatDateLong } = require('../utils/time');
const logger = require('../utils/logger');

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

  let lowerBody = body.toLowerCase().trim();

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

  // Unknown command
  return sendMessage(
    phone,
    `❓ I didn't understand that command.

` +
      `*Quick commands (type the NUMBER):*
` +
      `1️⃣ *TODAY* - Today's appointments
` +
      `2️⃣ *APPOINTMENTS* - Upcoming appointments
` +
      `3️⃣ *SERVICES* - List services
` +
      `4️⃣ *ADD SERVICE* - Add a service
` +
      `5️⃣ *REMOVE SERVICE <id>* - Remove service
` +
      `6️⃣ *HOURS* - View/set hours
` +
      `7️⃣ *LINK* - Get booking link
` +
      `8️⃣ *CANCEL <id>* - Cancel appointment
` +
      `9️⃣ *HELP* - Show all commands`
  );
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
        `📍 Location: ${tenant.location}\n` +
        `🔗 Booking Code: *${bookingCode}*\n` +
        `📎 Booking Link:\n${bookingLink}\n\n` +
        `First service added: *${ctx.temp_service_name}* (${ctx.temp_service_duration} min, ${formatCurrency(price)})\n\n` +
        `*As the salon owner, you can now:*\n` +
        `• View appointments (type *1* or *TODAY*)\n` +
        `• Add/remove services (type *4* or *ADD SERVICE*)\n` +
        `• Manage working hours (type *6* or *HOURS*)\n\n` +
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
  return sendMessage(phone, `💇 *Services for ${tenant.name}*\n\n${table}`);
}

async function startAddService(phone, tenant) {
  await sessionService.setSession(phone, {
    role: 'admin',
    state: 'add_service_name',
    tenant_id: tenant.id,
    context: {},
  });
  return sendMessage(phone, 'What is the *name* of the new service?');
}

async function handleAddServiceName(phone, body, session, tenant) {
  const name = body.trim();
  if (name.length < 2) {
    return sendMessage(phone, 'Please provide a valid service name.');
  }
  await sessionService.updateSession(phone, {
    state: 'add_service_duration',
    context: { temp_service_name: name },
  });
  return sendMessage(phone, `How long does *${name}* take? (in minutes)`);
}

async function handleAddServiceDuration(phone, body, session, tenant) {
  const duration = parseInt(body.trim(), 10);
  if (isNaN(duration) || duration < 5 || duration > 480) {
    return sendMessage(phone, 'Please provide a valid duration in minutes (5-480).');
  }
  await sessionService.updateSession(phone, {
    state: 'add_service_price',
    context: { temp_service_duration: duration },
  });
  return sendMessage(phone, `What is the price for *${session.context.temp_service_name}*?`);
}

async function handleAddServicePrice(phone, body, session, tenant) {
  const price = parseFloat(body.trim().replace('$', ''));
  if (isNaN(price) || price < 0) {
    return sendMessage(phone, 'Please provide a valid price.');
  }

  const ctx = session.context;
  const service = await serviceModel.create({
    tenantId: tenant.id,
    name: ctx.temp_service_name,
    durationMinutes: ctx.temp_service_duration,
    price,
  });

  await sessionService.setSession(phone, {
    role: 'admin',
    state: null,
    tenant_id: tenant.id,
    context: {},
  });

  return sendMessage(
    phone,
    `✅ Service added: *${service.name}* (${service.duration_minutes} min, ${formatCurrency(service.price)})`
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
    return sendMessage(phone, `Service not found: "${arg}". Use *services* to see your service list.`);
  }
  return sendMessage(phone, `🗑️ Service removed: *${removed.name}*`);
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
    `⏰ *Working Hours for ${tenant.name}*\n\n${lines.join('\n')}\n\nTo update: *hours <day> <time>*\nExample: *hours monday 08:00-18:00*`
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

  return sendMessage(phone, `✅ Working hours updated!\n*${day.charAt(0).toUpperCase() + day.slice(1)}*: ${value}`);
}

async function listAppointments(phone, tenant) {
  const appointments = await appointmentModel.findUpcomingByTenant(tenant.id);
  if (appointments.length === 0) {
    return sendMessage(phone, 'No upcoming appointments in the next 7 days.');
  }

  const lines = appointments.map((a, i) => {
    const hTime = toHarareTime(a.start_time);
    const dateStr = hTime.toISOString().split('T')[0];
    const timeStr = formatTime(hTime);
    return `${i + 1}. ${formatDateLong(dateStr)} at ${timeStr} - *${a.service_name || 'Service'}* (${a.client_name}) [ID: ${a.id}]`;
  });

  return sendMessage(
    phone,
    `📅 *Upcoming Appointments (next 7 days)*\n\n${lines.join('\n')}\n\nTo cancel: *cancel <id>*`
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
    return sendMessage(phone, `No appointments scheduled for today (${formatDateLong(harareDateStr)}).`);
  }

  const lines = appointments.map((a, i) => {
    const hTime = toHarareTime(a.start_time);
    const time = formatTime(hTime);
    return `${i + 1}. ${time} - *${a.service_name || 'Service'}* (${a.client_name}) [ID: ${a.id}]`;
  });

  return sendMessage(
    phone,
    `📋 *Today's Appointments (${formatDateLong(harareDateStr)})*\n\n${lines.join('\n')}\n\nTotal: ${appointments.length}`
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

  return sendMessage(phone, `✅ Appointment #${id} has been cancelled.`);
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
      `6️⃣ *HOURS* - View working hours / set hours
` +
      `7️⃣ *LINK* - Get your booking link
` +
      `8️⃣ *CANCEL <id>* - Cancel an appointment
` +
      `9️⃣ *HELP* - Show this menu

` +
      `*Examples:*
` +
      `Type *6 monday 08:00-18:00* to set hours
` +
      `Type *8 42* to cancel appointment #42

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

module.exports = {
  handleAdminMessage,
  startRegistration,
  handleRegistrationState,
  handleRegistrationSubState,
};
