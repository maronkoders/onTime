const tenantModel = require('../models/tenant');
const serviceModel = require('../models/service');
const appointmentModel = require('../models/appointment');
const clientModel = require('../models/client');
const sessionService = require('../services/session');
const scheduler = require('../services/scheduler');
const { sendMessage } = require('../services/whatsapp');
const { formatCurrency, formatServiceTable } = require('../utils/helpers');
const {
  isValidDate,
  isDateInPast,
  getDayOfWeek,
  createUTCDateTime,
  formatDateTime,
  toHarareTime,
  formatTime,
  todayHarare,
  formatDateLong,
  MONTH_NAMES,
} = require('../utils/time');
const logger = require('../utils/logger');

async function handleClientMessage(phone, body, session) {
  const lowerBody = body.toLowerCase().trim();

  // Check for "my appointment" command
  if (lowerBody === 'my appointment' || lowerBody === 'my appointments') {
    return showClientAppointments(phone);
  }

  // Check for client cancel command
  if (lowerBody.startsWith('cancel ')) {
    const idStr = body.substring('cancel'.length).trim();
    return cancelClientAppointment(phone, idStr);
  }
  
  // Check for reschedule command
  if (lowerBody === 'reschedule') {
    return startReschedule(phone);
  }

  // If in menu state (returning client), handle menu selection
  if (session && session.state === 'menu') {
    return handleReturningClientMenu(phone, body, session);
  }

  // If in reschedule flow
  if (session && session.state && session.state.startsWith('reschedule_')) {
    return handleRescheduleState(phone, body, session);
  }

  // If in a booking flow, handle the state
  if (session && session.state) {
    return handleClientState(phone, body, session);
  }

  // If no session and no recognized command, send a welcome message
  return sendMessage(
    phone,
    `👋 Welcome to *OnTime* — your salon appointment assistant on WhatsApp!\n\n` +
      `*For Clients:*\n` +
      `📅 *Book* — Use the booking link from your salon to schedule an appointment\n` +
      `📋 *My appointment* — View your upcoming bookings\n` +
      `❌ *Cancel <id>* — Cancel a booking\n\n` +
      `*For Salon Owners:*\n` +
      `Type *REGISTER* to set up your salon — you'll add your name, location, working hours, and services in just a few steps.\n\n` +
      `Get started now!`
  );
}

async function startBooking(phone, bookingCode) {
  const tenant = await tenantModel.findByBookingCode(bookingCode);
  if (!tenant) {
    return sendMessage(phone, `❌ Sorry, no salon found with code "${bookingCode}". Please check the link and try again.`);
  }

  // Check if salon subscription is active
  const subscriptionStatus = tenantModel.getSubscriptionStatus(tenant);
  if (!subscriptionStatus.valid) {
    let message = `⛔ *Booking Unavailable*\n\n`;
    message += `Sorry, *${tenant.name}* is currently not accepting bookings.`;
    if (subscriptionStatus.reason === 'Account deactivated') {
      message += `\n\nThe salon account has been temporarily deactivated.`;
    } else if (subscriptionStatus.trialEnded) {
      message += `\n\n💡 *The salon's free trial has ended.*\n`;
      message += `To continue accepting bookings, the salon owner needs to upgrade.`;
    } else if (subscriptionStatus.subscriptionEnded) {
      message += `\n\n💡 *The salon's subscription has expired.*\n`;
      message += `Renewal is needed to restore booking services.`;
    }
    message += `\n\n📦 *Affordable Plans:*\n`;
    message += `• 1 Month: $5\n`;
    message += `• 3 Months: $12 (20% off)\n`;
    message += `• 6 Months: $22 (27% off)\n\n`;
    message += `💳 *Payment Methods:*\n`;
    message += `• Innbucks / Ecocash: *0775635191*\n`;
    message += `  (Brian H Thomas)\n\n`;
    message += `Please contact the salon owner directly or share this payment info with them to help them reactivate their booking system! 🙏`;
    return sendMessage(phone, message);
  }

  // Check if this phone is the salon owner
  if (phone === tenant.owner_phone) {
    return sendMessage(phone, `❌ You can't book an appointment at your own salon! Use *today* or *appointments* to manage your schedule.`);
  }

  const services = await serviceModel.findByTenant(tenant.id);
  if (services.length === 0) {
    return sendMessage(phone, `❌ *${tenant.name}* hasn't set up any services yet. Please try again later.`);
  }

  // Check if client already has an upcoming appointment at ANY salon
  const existingAppointment = await appointmentModel.findUpcomingByClientPhone(phone);
  if (existingAppointment) {
    const hTime = toHarareTime(existingAppointment.start_time);
    const dateStr = hTime.toISOString().split('T')[0];
    const timeStr = formatTime(hTime);
    
    let message = `❌ *You already have an upcoming appointment!*\n\n`;
    message += `📋 *Existing Appointment:*\n`;
    message += `   💇 ${existingAppointment.service_name}\n`;
    message += `   🏪 ${existingAppointment.salon_name}\n`;
    message += `   📅 ${formatDateLong(dateStr)} at ${timeStr}\n\n`;
    message += `You can only have one active appointment at a time.\n\n`;
    message += `*Options:*\n`;
    message += `1️⃣ *RESCHEDULE* - Change your appointment date/time\n`;
    message += `2️⃣ *CANCEL* - Cancel your current appointment\n`;
    message += `3️⃣ *SEE MY APPOINTMENT* - View details\n\n`;
    message += `Type the number or command to proceed.`;
    
    // Set menu state so they can use the options
    await sessionService.setSession(phone, {
      role: 'client',
      state: 'menu',
      tenant_id: existingAppointment.tenant_id,
      context: {
        client_name: existingAppointment.client_name,
        returning_client: true,
        has_upcoming_appointment: true,
        upcoming_appointment: existingAppointment,
      },
    });
    
    return sendMessage(phone, message);
  }

  // Check if this is a returning client (has previous appointments at this salon)
  const clientAppointments = await appointmentModel.findByClientPhone(phone);
  const previousAppointments = clientAppointments.filter(a => a.tenant_id === tenant.id);
  const isReturningClient = previousAppointments.length > 0;
  
  // Get client name from most recent appointment if returning
  const clientName = isReturningClient ? previousAppointments[0].client_name : null;

  if (isReturningClient && clientName) {
    // Returning client - welcome them back and skip name step
    const table = formatServiceTable(services);
    
    await sessionService.setSession(phone, {
      role: 'client',
      state: 'awaiting_service',
      tenant_id: tenant.id,
      context: {
        booking_code: bookingCode,
        salon_name: tenant.name,
        client_name: clientName,
        prev_state: 'awaiting_name',
      },
    });

    return sendMessage(
      phone,
      `👋 *Welcome back, ${clientName}!* 💇\n\nGreat to see you again at *${tenant.name}*!\n\nPlease choose a service by typing the *NUMBER*:\n\n${table}\n\n_Type *BACK* to change your name_`
    );
  }

  // New client - start with name step
  await sessionService.setSession(phone, {
    role: 'client',
    state: 'awaiting_name',
    tenant_id: tenant.id,
    context: {
      booking_code: bookingCode,
      salon_name: tenant.name,
    },
  });

  return sendMessage(
    phone,
    `Welcome to *${tenant.name}*! 💇\n📍 ${tenant.location || 'Location not set'}\n\nLet's book your appointment. What is your *name*?`
  );
}

async function handleClientState(phone, body, session) {
  const state = session.state;
  const lowerBody = body.trim().toLowerCase();

  // Handle 'back' command to go to previous step
  if (lowerBody === 'back') {
    return handleGoBack(phone, session);
  }

  switch (state) {
    case 'awaiting_name':
      return handleName(phone, body, session);
    case 'awaiting_service':
      return handleServiceSelection(phone, body, session);
    case 'awaiting_date':
      return handleDateSelection(phone, body, session);
    case 'awaiting_time':
      return handleTimeSelection(phone, body, session);
    case 'awaiting_confirmation':
      return handleConfirmation(phone, body, session);
    default:
      await sessionService.clearSession(phone);
      return sendMessage(phone, 'Something went wrong. Please use the booking link to start again.');
  }
}

async function handleName(phone, body, session) {
  const name = body.trim();
  if (name.length < 2) {
    return sendMessage(phone, 'Please provide your name (at least 2 characters).');
  }

  const services = await serviceModel.findByTenant(session.tenant_id);
  if (services.length === 0) {
    await sessionService.clearSession(phone);
    return sendMessage(phone, 'Sorry, this salon has no services available right now.');
  }

  const table = formatServiceTable(services);

  await sessionService.updateSession(phone, {
    state: 'awaiting_service',
    context: { 
      client_name: name,
      prev_state: 'awaiting_name',
    },
  });

  return sendMessage(
    phone,
    `Hi *${name}*! 👋\n\nPlease choose a service by typing the *NUMBER*:\n\n${table}\n\n_Type *BACK* to change your name_`
  );
}

async function handleServiceSelection(phone, body, session) {
  const input = body.trim();
  const services = await serviceModel.findByTenant(session.tenant_id);

  let selectedService = null;
  const num = parseInt(input, 10);

  if (!isNaN(num) && num >= 1 && num <= services.length) {
    selectedService = services[num - 1];
  } else {
    // Try matching by name
    selectedService = services.find(
      (s) => s.name.toLowerCase() === input.toLowerCase()
    );
  }

  if (!selectedService) {
    return sendMessage(
      phone,
      `❌ Please select a valid service number (1-${services.length}).`
    );
  }

  // Build list of next 25 open days with available slots for the calendar picker
  const tenant = await tenantModel.findById(session.tenant_id);
  const { available, unavailable } = await buildDateOptions(
    tenant.working_hours, 
    25, 
    session.tenant_id, 
    selectedService.duration_minutes
  );

  await sessionService.updateSession(phone, {
    state: 'awaiting_date',
    context: {
      ...session.context,
      selected_service_id: selectedService.id,
      selected_service_name: selectedService.name,
      selected_service_duration: selectedService.duration_minutes,
      selected_service_price: selectedService.price,
      date_options: available.map(d => d.dateStr),
      prev_state: 'awaiting_service',
    },
  });

  const calendar = formatDateCalendar(available, unavailable);

  return sendMessage(
    phone,
    `You selected: *${selectedService.name}* (${selectedService.duration_minutes} min, ${formatCurrency(selectedService.price)})\n\n📅 *Pick a date:*\n\n${calendar}\n\nReply with the *NUMBER* for available dates.\n_Type *BACK* to change your service_`
  );
}

async function handleDateSelection(phone, body, session) {
  let dateStr = body.trim().toLowerCase();
  const dateOptions = session.context.date_options || [];

  // Handle numbered selection from calendar
  const num = parseInt(dateStr, 10);
  if (!isNaN(num) && num >= 1 && num <= dateOptions.length) {
    dateStr = dateOptions[num - 1];
  } else if (dateStr === 'today') {
    dateStr = todayHarare();
  } else if (dateStr === 'tomorrow') {
    const d = new Date(todayHarare() + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    dateStr = d.toISOString().split('T')[0];
  }

  if (!isValidDate(dateStr)) {
    const invalidNum = parseInt(body.trim(), 10);
    const errorMsg = isNaN(invalidNum) 
      ? '❌ Invalid input. Please pick a number from the list.'
      : `❌ Entered number not valid (${invalidNum}). Please pick a number from the list.`;
    return sendMessage(phone, errorMsg);
  }

  if (isDateInPast(dateStr)) {
    return sendMessage(phone, '❌ That date is in the past. Please choose a future date.');
  }

  // Check if salon is open on that day
  const tenant = await tenantModel.findById(session.tenant_id);
  const dayName = getDayOfWeek(dateStr);
  const daySchedule = tenant.working_hours[dayName];

  if (!daySchedule || daySchedule.toLowerCase() === 'closed') {
    return sendMessage(
      phone,
      `❌ Sorry, *${tenant.name}* is closed on *${dayName.charAt(0).toUpperCase() + dayName.slice(1)}*.\nPlease choose another date.`
    );
  }

  // Get available slots
  const slots = await scheduler.getAvailableSlots(
    session.tenant_id,
    dateStr,
    session.context.selected_service_duration
  );

  if (slots.length === 0) {
    return sendMessage(
      phone,
      `❌ No available time slots on *${dateStr}*. Please try another date.`
    );
  }

  // Format slots as vertical numbered list (like dates)
  const slotLines = slots.map((slot, i) => `${i + 1}. ${slot}`);

  await sessionService.updateSession(phone, {
    state: 'awaiting_time',
    context: {
      ...session.context,
      selected_date: dateStr,
      available_slots: slots,
      prev_state: 'awaiting_date',
    },
  });

  return sendMessage(
    phone,
    `📅 Available slots on *${formatDateLong(dateStr)}* (${dayName}):\n\n${slotLines.join('\n')}\n\nType the *NUMBER* to select.\n_Type *BACK* to change your date_`
  );
}

async function handleTimeSelection(phone, body, session) {
  const input = body.trim();
  const slots = session.context.available_slots || [];

  const num = parseInt(input, 10);

  if (isNaN(num) || num < 1 || num > slots.length) {
    return sendMessage(
      phone,
      `❌ Please select a valid time slot. Type a number from 1 to ${slots.length}.`
    );
  }

  const selectedTime = slots[num - 1];
  const formattedDate = formatDateLong(session.context.selected_date);

  await sessionService.updateSession(phone, {
    state: 'awaiting_confirmation',
    context: { 
      ...session.context,
      selected_time: selectedTime,
      prev_state: 'awaiting_time',
    },
  });

  return sendMessage(
    phone,
    `📋 *Booking Summary*\n\n` +
      `🏪 Salon: *${session.context.salon_name}*\n` +
      `💇 Service: *${session.context.selected_service_name}*\n` +
      `💰 Price: ${formatCurrency(session.context.selected_service_price)}\n` +
      `📅 Date: *${formattedDate}*\n` +
      `🕐 Time: *${selectedTime}*\n` +
      `⏱️ Duration: ${session.context.selected_service_duration} min\n\n` +
      `Type *YES* to confirm, *NO* to cancel, or *BACK* to change time.`
  );
}

async function handleConfirmation(phone, body, session) {
  const input = body.trim().toLowerCase();

  if (input === 'no' || input === 'cancel') {
    await sessionService.clearSession(phone);
    return sendMessage(phone, 'Booking cancelled. You can start again anytime using the booking link.');
  }

  if (input !== 'yes' && input !== 'confirm' && input !== 'y') {
    return sendMessage(phone, '❌ Please type *YES* to confirm or *NO* to cancel.');
  }

  const ctx = session.context;

  try {
    // Create the appointment
    const startTimeUTC = createUTCDateTime(ctx.selected_date, ctx.selected_time);
    const endTimeUTC = new Date(startTimeUTC.getTime() + ctx.selected_service_duration * 60 * 1000);

    const appointment = await appointmentModel.create({
      tenantId: session.tenant_id,
      clientName: ctx.client_name,
      clientPhone: phone,
      serviceId: ctx.selected_service_id,
      startTime: startTimeUTC.toISOString(),
      endTime: endTimeUTC.toISOString(),
    });

    // Save/update client record for returning client recognition
    await clientModel.getOrCreate(phone, ctx.client_name, session.tenant_id);

    await sessionService.clearSession(phone);

    // Notify the salon owner
    const tenant = await tenantModel.findById(session.tenant_id);
    if (tenant) {
      const formattedDate = formatDateLong(ctx.selected_date);
      const cleanPhone = phone.replace(/^\+/, '');
      const waLink = `https://wa.me/${cleanPhone}`;
      
      // Get subscription info for reminder
      const subscriptionModel = require('../models/subscription');
      const subInfo = await subscriptionModel.getSubscriptionInfo(tenant.id);
      let subscriptionReminder = '';
      
      if (subInfo.hasActiveSubscription) {
        if (subInfo.isExpiringSoon) {
          subscriptionReminder = `\n\n⏰ *Subscription Alert*: ${subInfo.daysRemaining} days remaining. Renew soon!`;
        } else {
          subscriptionReminder = `\n\n📅 ${subInfo.daysRemaining} days left on your ${subInfo.status} subscription.`;
        }
      }

      sendMessage(
        tenant.owner_phone,
        `🔔 *New Booking!*\n\n` +
          `Client: ${ctx.client_name}\n` +
          `📱 WhatsApp: ${waLink}\n` +
          `Service: ${ctx.selected_service_name}\n` +
          `Date: ${formattedDate}\n` +
          `Time: ${ctx.selected_time}\n` +
          `Appointment ID: #${appointment.id}` +
          subscriptionReminder
      ).catch((err) => logger.error(`Failed to notify salon owner: ${err.message}`));
    }

    // Set menu state for returning client
    await sessionService.setSession(phone, {
      role: 'client',
      state: 'menu',
      tenant_id: session.tenant_id,
      context: {
        client_name: ctx.client_name,
        returning_client: true,
        has_upcoming_appointment: true,
        upcoming_appointment: appointment,
      },
    });

    return sendMessage(
      phone,
      `✅ *Booking Confirmed!*\n\n` +
        `🏪 ${ctx.salon_name}\n` +
        `💇 ${ctx.selected_service_name}\n` +
        `📅 ${formatDateLong(ctx.selected_date)} at ${ctx.selected_time}\n` +
        `🆔 Appointment #${appointment.id}\n\n` +
        `*What's next?*\n` +
        `1️⃣ Type *MY APPOINTMENT* to view details\n` +
        `2️⃣ Type *RESCHEDULE* to change date/time\n` +
        `3️⃣ Type *HELP* for all options\n\n` +
        `Thank you! See you then! 🎉`
    );
  } catch (err) {
    logger.error(`Failed to create appointment: ${err.message}`);
    return sendMessage(phone, '❌ Sorry, there was an error creating your booking. Please try again.');
  }
}

async function showClientAppointments(phone) {
  const appointments = await appointmentModel.findByClientPhone(phone);

  if (appointments.length === 0) {
    return sendMessage(phone, 'You have no upcoming appointments.');
  }

  const lines = appointments.map((a, i) => {
    logger.info(`[VIEW DEBUG] Raw start_time from DB: ${a.start_time} (type: ${typeof a.start_time})`);
    
    // PostgreSQL returns Date objects - convert to UTC ISO string first
    let startTimeStr;
    if (a.start_time instanceof Date) {
      // Force UTC interpretation by using toISOString()
      startTimeStr = a.start_time.toISOString();
    } else {
      startTimeStr = String(a.start_time);
    }
    
    logger.info(`[VIEW DEBUG] startTimeStr for conversion: ${startTimeStr}`);
    const hTime = toHarareTime(startTimeStr);
    logger.info(`[VIEW DEBUG] After toHarareTime: ${hTime.toISOString()}`);
    const dateStr = hTime.toISOString().split('T')[0];
    const timeStr = formatTime(hTime);
    logger.info(`[VIEW DEBUG] Formatted time string: ${timeStr}`);
    return `${i + 1}. *${a.service_name || 'Service'}* at *${a.salon_name}*\n   📅 ${formatDateLong(dateStr)} at ${timeStr}\n   🆔 ID: #${a.id}`;
  });

  return sendMessage(
    phone,
    `📋 *Your Upcoming Appointments*\n\n${lines.join('\n\n')}\n\nTo cancel, type *CANCEL <id>* (e.g., CANCEL ${appointments[0].id})`
  );
}

async function cancelClientAppointment(phone, idStr) {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return sendMessage(phone, '❌ Please provide a valid appointment ID.\nUsage: *CANCEL <id>*');
  }

  const cancelled = await appointmentModel.cancelByClient(id, phone);
  if (!cancelled) {
    return sendMessage(phone, `❌ Appointment #${id} not found or already cancelled.`);
  }

  // Notify salon owner
  const apptDetails = await appointmentModel.findById(id);
  if (apptDetails) {
    const tenant = await tenantModel.findById(apptDetails.tenant_id);
    if (tenant) {
      sendMessage(
        tenant.owner_phone,
        `⚠️ *Appointment Cancelled*\n\nAppointment #${id} has been cancelled by the client (${apptDetails.client_name}).`
      ).catch((err) => logger.error(`Failed to notify salon of cancellation: ${err.message}`));
    }
  }

  return sendMessage(phone, `✅ Appointment #${id} has been cancelled.`);
}

// --- Helpers ---

const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

async function buildDateOptions(workingHours, count, tenantId, serviceDuration) {
  const options = [];
  const unavailableDates = [];
  const todayStr = todayHarare();
  const d = new Date(todayStr + 'T12:00:00Z');
  let daysChecked = 0;
  const maxDaysToCheck = 90; // Increased to find enough dates with slots

  while (options.length < count && daysChecked < maxDaysToCheck) {
    const dateStr = d.toISOString().split('T')[0];
    const dayName = getDayOfWeek(dateStr);
    const schedule = workingHours[dayName];
    const isClosed = !schedule || schedule.toLowerCase() === 'closed';

    if (!isClosed && dateStr >= todayStr) {
      const dayOfWeek = DAY_NAMES_SHORT[d.getUTCDay()];
      const dayNum = d.getUTCDate();
      const month = MONTH_NAMES[d.getUTCMonth()];
      let label = `${dayOfWeek}, ${dayNum} ${month}`;

      if (dateStr === todayStr) {
        label = `Today (${dayOfWeek}, ${dayNum} ${month})`;
      } else {
        const tmrw = new Date(todayStr + 'T12:00:00Z');
        tmrw.setUTCDate(tmrw.getUTCDate() + 1);
        if (dateStr === tmrw.toISOString().split('T')[0]) {
          label = `Tomorrow (${dayOfWeek}, ${dayNum} ${month})`;
        }
      }

      // Check if there are available slots for this date
      const slots = await scheduler.getAvailableSlots(tenantId, dateStr, serviceDuration);
      const hasSlots = slots.length > 0;

      if (hasSlots) {
        options.push({ dateStr, label, dayOfWeek, dayNum, month, hasSlots: true });
      } else {
        unavailableDates.push({ dateStr, label, dayOfWeek, dayNum, month, hasSlots: false });
      }
    }

    d.setUTCDate(d.getUTCDate() + 1);
    daysChecked++;
  }

  return { available: options, unavailable: unavailableDates };
}

function formatDateCalendar(availableDates, unavailableDates = []) {
  const lines = [];
  let num = 1;
  
  // Show available dates with numbers
  availableDates.forEach((opt) => {
    lines.push(`${num}. ${opt.label}`);
    num++;
  });
  
  // Show unavailable dates with strikethrough, no number
  unavailableDates.slice(0, 10).forEach((opt) => { // Limit to 10 unavailable dates
    lines.push(`~${opt.label} - no slots available~`);
  });
  
  return lines.join('\n');
}

async function handleGoBack(phone, session) {
  const prevState = session.context.prev_state;
  const ctx = session.context;

  if (!prevState) {
    return sendMessage(phone, '❌ You are at the first step. Type *CANCEL* to stop the booking.');
  }

  // Restore previous state and remove the "back" tracking
  await sessionService.updateSession(phone, {
    state: prevState,
    context: { ...ctx, prev_state: null },
  });

  // Re-prompt based on previous state
  switch (prevState) {
    case 'awaiting_name': {
      return sendMessage(
        phone,
        `Going back...\n\nWhat is your *name*?`
      );
    }
    case 'awaiting_service': {
      const services = await serviceModel.findByTenant(session.tenant_id);
      const table = formatServiceTable(services);
      return sendMessage(
        phone,
        `Going back...\n\nHi *${ctx.client_name}*! 👋\n\nPlease choose a service by typing the *NUMBER*:\n\n${table}\n\n_Type *BACK* to change your name_`
      );
    }
    case 'awaiting_date': {
      const tenant = await tenantModel.findById(session.tenant_id);
      const serviceDuration = ctx.selected_service_duration || 60;
      const { available, unavailable } = await buildDateOptions(tenant.working_hours, 25, session.tenant_id, serviceDuration);
      const calendar = formatDateCalendar(available, unavailable);
      
      // Store only available dates for selection
      const availableDateStrs = available.map(d => d.dateStr);
      await sessionService.updateSession(phone, {
        state: 'awaiting_date',
        context: { 
          ...ctx, 
          date_options: availableDateStrs,
          prev_state: 'awaiting_service',
        },
      });
      
      return sendMessage(
        phone,
        `Going back...\n\n📅 *Pick a date:*\n\n${calendar}\n\nReply with the *NUMBER* for available dates.\n_Type *BACK* to change your service_`
      );
    }
    case 'awaiting_time': {
      const slots = ctx.available_slots || [];
      const slotLines = slots.map((slot, i) => `${i + 1}. ${slot}`);
      return sendMessage(
        phone,
        `Going back...\n\n📅 Available slots on *${formatDateLong(ctx.selected_date)}*:\n\n${slotLines.join('\n')}\n\nType the *NUMBER* to select.\n_Type *BACK* to change your date_`
      );
    }
    default:
      return sendMessage(phone, '❌ Cannot go back further. Type *CANCEL* to stop.');
  }
}

// --- Returning Client Menu ---

async function showReturningClientMenu(phone, client, hasUpcoming, upcomingAppt) {
  let message = `👋 *Welcome back, ${client.name}!* 🎉\n\n`;
  
  if (hasUpcoming && upcomingAppt) {
    const hTime = toHarareTime(upcomingAppt.start_time);
    const dateStr = hTime.toISOString().split('T')[0];
    const timeStr = formatTime(hTime);
    
    message += `📋 *You have an upcoming appointment:*\n`;
    message += `   💇 ${upcomingAppt.service_name}\n`;
    message += `   🏪 ${upcomingAppt.salon_name}\n`;
    message += `   📅 ${formatDateLong(dateStr)} at ${timeStr}\n\n`;
    message += `*What would you like to do?*\n\n`;
    message += `1️⃣ *See my appointment* - View details\n`;
    message += `2️⃣ *Reschedule* - Change date/time\n`;
    message += `3️⃣ *Cancel* - Cancel booking\n`;
    message += `4️⃣ *Book another* - New appointment with ${upcomingAppt.salon_name}\n`;
  } else {
    message += `You have no upcoming appointments.\n\n`;
    message += `*What would you like to do?*\n\n`;
    
    if (client.preferred_tenant_id) {
      const tenant = await tenantModel.findById(client.preferred_tenant_id);
      if (tenant) {
        message += `1️⃣ *Book appointment* with ${tenant.name}\n`;
        message += `   (Code: ${tenant.booking_code})\n\n`;
      }
    }
    
    message += `Type a salon's booking code to book with them.\n`;
  }
  
  message += `\n_Type *HELP* for more options_`;
  
  return sendMessage(phone, message);
}

async function handleReturningClientMenu(phone, body, session) {
  const input = body.trim().toLowerCase();
  const ctx = session.context;
  
  // Option 1: See my appointment
  if (input === '1' || input === 'see my appointment' || input === 'my appointment') {
    return showClientAppointments(phone);
  }
  
  // Option 2: Reschedule
  if (input === '2' || input === 'reschedule') {
    return startReschedule(phone);
  }
  
  // Option 3: Cancel
  if (input === '3' || input === 'cancel') {
    // Get upcoming appointment to suggest cancelling
    const upcoming = await appointmentModel.findUpcomingByClientPhone(phone);
    if (upcoming) {
      return cancelClientAppointment(phone, upcoming.id.toString());
    }
    return sendMessage(phone, '❌ No upcoming appointment to cancel.');
  }
  
  // Option 4: Book another / Book appointment
  if (input === '4' || input === 'book another' || input === 'book appointment') {
    if (session.tenant_id) {
      const tenant = await tenantModel.findById(session.tenant_id);
      if (tenant) {
        return startBooking(phone, tenant.booking_code);
      }
    }
    return sendMessage(phone, 'Please provide a booking code to book an appointment.\nExample: *BOOK ABC123*');
  }
  
  // Handle booking code input
  if (input.startsWith('book ')) {
    const code = body.substring(5).trim();
    if (code) {
      return startBooking(phone, code);
    }
  }
  
  // Help
  if (input === 'help') {
    return sendMessage(
      phone,
      `📖 *OnTime Client Help*\n\n` +
      `*Commands:*\n` +
      `• *1* or *See my appointment* - View upcoming appointment\n` +
      `• *2* or *Reschedule* - Change your appointment date/time\n` +
      `• *3* or *Cancel* - Cancel your appointment\n` +
      `• *4* or *Book another* - Book new appointment\n` +
      `• *BOOK <code>* - Book with a different salon\n\n` +
      `You can also type the number (1, 2, 3, or 4) to select an option.`
    );
  }
  
  // Invalid input
  return sendMessage(phone, '❌ Invalid option. Please type a number (1-4) or *HELP* for options.');
}

// --- Rescheduling ---

async function startReschedule(phone) {
  // Check if client has an upcoming appointment
  const upcoming = await appointmentModel.findUpcomingByClientPhone(phone);
  
  if (!upcoming) {
    return sendMessage(phone, '❌ You have no upcoming appointments to reschedule.');
  }
  
  const hTime = toHarareTime(upcoming.start_time);
  const dateStr = hTime.toISOString().split('T')[0];
  const timeStr = formatTime(hTime);
  
  // Get tenant info for building date options
  const tenant = await tenantModel.findById(upcoming.tenant_id);
  if (!tenant) {
    return sendMessage(phone, '❌ Unable to reschedule. Salon not found.');
  }
  
  // Build date options
  const { available, unavailable } = await buildDateOptions(
    tenant.working_hours,
    25,
    upcoming.tenant_id,
    upcoming.duration_minutes
  );
  
  const calendar = formatDateCalendar(available, unavailable);
  
  // Set session for rescheduling
  await sessionService.setSession(phone, {
    role: 'client',
    state: 'reschedule_date',
    tenant_id: upcoming.tenant_id,
    context: {
      reschedule_appointment_id: upcoming.id,
      client_name: upcoming.client_name,
      selected_service_id: upcoming.service_id,
      selected_service_name: upcoming.service_name,
      selected_service_duration: upcoming.duration_minutes,
      selected_service_price: upcoming.price,
      current_date: dateStr,
      current_time: timeStr,
      date_options: available.map(d => d.dateStr),
    },
  });
  
  return sendMessage(
    phone,
    `📅 *Reschedule Appointment*\n\n` +
    `Current: ${upcoming.service_name} on ${formatDateLong(dateStr)} at ${timeStr}\n\n` +
    `Select a new date:\n${calendar}\n\n` +
    `Reply with the *NUMBER* for available dates.`
  );
}

async function handleRescheduleState(phone, body, session) {
  const state = session.state;
  const lowerBody = body.trim().toLowerCase();
  
  if (lowerBody === 'back' || lowerBody === 'cancel') {
    await sessionService.clearSession(phone);
    
    // Get client info to show menu again
    const client = await clientModel.findByPhone(phone);
    if (client) {
      const upcoming = await appointmentModel.findUpcomingByClientPhone(phone);
      return showReturningClientMenu(phone, client, !!upcoming, upcoming);
    }
    return sendMessage(phone, 'Rescheduling cancelled. Type *HELP* for options.');
  }
  
  switch (state) {
    case 'reschedule_date':
      return handleRescheduleDate(phone, body, session);
    case 'reschedule_time':
      return handleRescheduleTime(phone, body, session);
    case 'reschedule_confirm':
      return handleRescheduleConfirm(phone, body, session);
    default:
      await sessionService.clearSession(phone);
      return sendMessage(phone, 'Something went wrong. Please try again.');
  }
}

async function handleRescheduleDate(phone, body, session) {
  let dateStr = body.trim().toLowerCase();
  const dateOptions = session.context.date_options || [];
  
  // Handle numbered selection from calendar
  const num = parseInt(dateStr, 10);
  if (!isNaN(num) && num >= 1 && num <= dateOptions.length) {
    dateStr = dateOptions[num - 1];
  }
  
  if (!isValidDate(dateStr)) {
    const invalidNum = parseInt(body.trim(), 10);
    const errorMsg = isNaN(invalidNum)
      ? '❌ Invalid input. Please pick a number from the list.'
      : `❌ Entered number not valid (${invalidNum}). Please pick a number from the list.`;
    return sendMessage(phone, errorMsg);
  }
  
  if (isDateInPast(dateStr)) {
    return sendMessage(phone, '❌ That date is in the past. Please choose a future date.');
  }
  
  // Check if salon is open on that day
  const tenant = await tenantModel.findById(session.tenant_id);
  const dayName = getDayOfWeek(dateStr);
  const daySchedule = tenant.working_hours[dayName];
  
  if (!daySchedule || daySchedule.toLowerCase() === 'closed') {
    return sendMessage(
      phone,
      `❌ Sorry, *${tenant.name}* is closed on *${dayName.charAt(0).toUpperCase() + dayName.slice(1)}*.\nPlease choose another date.`
    );
  }
  
  // Get available slots
  const slots = await scheduler.getAvailableSlots(
    session.tenant_id,
    dateStr,
    session.context.selected_service_duration
  );
  
  if (slots.length === 0) {
    return sendMessage(
      phone,
      `❌ No available time slots on *${dateStr}*. Please try another date.`
    );
  }
  
  // Format slots as vertical numbered list
  const slotLines = slots.map((slot, i) => `${i + 1}. ${slot}`);
  
  await sessionService.updateSession(phone, {
    state: 'reschedule_time',
    context: {
      ...session.context,
      selected_date: dateStr,
      available_slots: slots,
    },
  });
  
  return sendMessage(
    phone,
    `📅 Available slots on *${formatDateLong(dateStr)}* (${dayName}):\n\n${slotLines.join('\n')}\n\nType the *NUMBER* to select.\n_Type *BACK* to change date_`
  );
}

async function handleRescheduleTime(phone, body, session) {
  const input = body.trim();
  const slots = session.context.available_slots || [];
  
  const num = parseInt(input, 10);
  
  if (isNaN(num) || num < 1 || num > slots.length) {
    return sendMessage(
      phone,
      `❌ Please select a valid time slot. Type a number from 1 to ${slots.length}.`
    );
  }
  
  const selectedTime = slots[num - 1];
  const formattedDate = formatDateLong(session.context.selected_date);
  const ctx = session.context;
  
  await sessionService.updateSession(phone, {
    state: 'reschedule_confirm',
    context: {
      ...ctx,
      selected_time: selectedTime,
    },
  });
  
  return sendMessage(
    phone,
    `📋 *Reschedule Summary*\n\n` +
    `Service: *${ctx.selected_service_name}*\n` +
    `New Date: *${formattedDate}*\n` +
    `New Time: *${selectedTime}*\n\n` +
    `Type *YES* to confirm the reschedule, *NO* to cancel.`
  );
}

async function handleRescheduleConfirm(phone, body, session) {
  const input = body.trim().toLowerCase();
  
  if (input === 'no' || input === 'cancel') {
    await sessionService.clearSession(phone);
    
    // Show menu again
    const client = await clientModel.findByPhone(phone);
    if (client) {
      const upcoming = await appointmentModel.findUpcomingByClientPhone(phone);
      return showReturningClientMenu(phone, client, !!upcoming, upcoming);
    }
    return sendMessage(phone, 'Rescheduling cancelled.');
  }
  
  if (input !== 'yes' && input !== 'confirm' && input !== 'y') {
    return sendMessage(phone, '❌ Please type *YES* to confirm or *NO* to cancel.');
  }
  
  const ctx = session.context;
  
  try {
    // Calculate new times
    logger.info(`[RESCHEDULE DEBUG] Input - date: ${ctx.selected_date}, time: ${ctx.selected_time}`);
    logger.info(`[RESCHEDULE DEBUG] HARARE_OFFSET_HOURS: ${require('../utils/time').HARARE_OFFSET_HOURS}`);
    
    const newStartTimeUTC = createUTCDateTime(ctx.selected_date, ctx.selected_time);
    logger.info(`[RESCHEDULE DEBUG] newStartTimeUTC timestamp: ${newStartTimeUTC.getTime()}`);
    logger.info(`[RESCHEDULE DEBUG] newStartTimeUTC ISO: ${newStartTimeUTC.toISOString()}`);
    
    const newEndTimeUTC = new Date(newStartTimeUTC.getTime() + ctx.selected_service_duration * 60 * 1000);
    
    logger.info(`[RESCHEDULE DEBUG] newEndTimeUTC: ${newEndTimeUTC.toISOString()}`);
    
    // Update the appointment
    const updated = await appointmentModel.reschedule(ctx.reschedule_appointment_id, {
      newDate: ctx.selected_date,
      newStartTime: newStartTimeUTC.toISOString(),
      newEndTime: newEndTimeUTC.toISOString(),
    });
    
    if (!updated) {
      return sendMessage(phone, '❌ Unable to reschedule. The appointment may have been cancelled.');
    }
    
    logger.info(`[RESCHEDULE DEBUG] Updated appointment returned: ${JSON.stringify(updated)}`);
    logger.info(`[RESCHEDULE DEBUG] updated.start_time: ${updated.start_time}`);
    
    await sessionService.clearSession(phone);
    
    // Notify salon owner
    const tenant = await tenantModel.findById(session.tenant_id);
    if (tenant) {
      sendMessage(
        tenant.owner_phone,
        `🔄 *Appointment Rescheduled*\n\n` +
        `Client: ${ctx.client_name}\n` +
        `Service: ${ctx.selected_service_name}\n` +
        `New Date: ${formatDateLong(ctx.selected_date)}\n` +
        `New Time: ${ctx.selected_time}\n` +
        `Appointment ID: #${ctx.reschedule_appointment_id}`
      ).catch((err) => logger.error(`Failed to notify salon of reschedule: ${err.message}`));
    }
    
    // Show menu again
    const client = await clientModel.findByPhone(phone);
    if (client) {
      const upcoming = await appointmentModel.findUpcomingByClientPhone(phone);
      
      let message = `✅ *Appointment Rescheduled!*\n\n`;
      message += `📅 ${formatDateLong(ctx.selected_date)} at ${ctx.selected_time}\n\n`;
      message += `What would you like to do next?\n\n`;
      message += `1️⃣ *See my appointment*\n`;
      message += `2️⃣ *Book another*\n`;
      
      // Set menu state
      await sessionService.setSession(phone, {
        role: 'client',
        state: 'menu',
        tenant_id: session.tenant_id,
        context: {
          client_name: client.name,
          returning_client: true,
          has_upcoming_appointment: true,
          upcoming_appointment: upcoming,
        },
      });
      
      return sendMessage(phone, message);
    }
    
    return sendMessage(
      phone,
      `✅ *Appointment Rescheduled!*\n\n` +
      `Your new appointment is on ${formatDateLong(ctx.selected_date)} at ${ctx.selected_time}.`
    );
  } catch (err) {
    logger.error(`Failed to reschedule appointment: ${err.message}`);
    return sendMessage(phone, '❌ Sorry, there was an error rescheduling. Please try again.');
  }
}

module.exports = {
  handleClientMessage,
  startBooking,
  showReturningClientMenu,
};
