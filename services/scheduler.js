const tenantModel = require('../models/tenant');
const appointmentModel = require('../models/appointment');
const serviceModel = require('../models/service');
const { getDayOfWeek, parseTimeString, HARARE_OFFSET_HOURS, todayHarare, nowHarare } = require('../utils/time');
const logger = require('../utils/logger');

const DEFAULT_SLOT_INCREMENT_MINUTES = 30;

/**
 * Calculate the average duration of all services for a tenant.
 * @param {number} tenantId
 * @returns {number} Average duration in minutes (defaults to 30 if no services)
 */
async function getAverageServiceDuration(tenantId) {
  try {
    const services = await serviceModel.findByTenant(tenantId);
    if (!services || services.length === 0) {
      return DEFAULT_SLOT_INCREMENT_MINUTES;
    }
    const totalDuration = services.reduce((sum, service) => sum + (service.duration_minutes || 0), 0);
    return Math.round(totalDuration / services.length);
  } catch (err) {
    logger.error(`Error calculating average service duration: ${err.message}`);
    return DEFAULT_SLOT_INCREMENT_MINUTES;
  }
}

/**
 * Get available booking slots for a tenant on a given date.
 * @param {number} tenantId
 * @param {string} dateStr - YYYY-MM-DD in Harare local time
 * @param {number} serviceDurationMinutes
 * @returns {string[]} Array of "HH:MM" time strings (Harare local)
 */
async function getAvailableSlots(tenantId, dateStr, serviceDurationMinutes) {
  try {
    const tenant = await tenantModel.findById(tenantId);
    if (!tenant) return [];

    const dayName = getDayOfWeek(dateStr);
    const workingHours = tenant.working_hours;
    const daySchedule = workingHours[dayName];

    if (!daySchedule || daySchedule.toLowerCase() === 'closed') {
      return [];
    }

    // Parse working hours (e.g., "09:00-17:00")
    const [openStr, closeStr] = daySchedule.split('-');
    const open = parseTimeString(openStr.trim());
    const close = parseTimeString(closeStr.trim());

    // Convert Harare local date to UTC date range for DB query
    // Harare open time in UTC
    const utcStartHour = open.hours - HARARE_OFFSET_HOURS;
    const utcDateStart = new Date(
      `${dateStr}T${String(Math.max(0, utcStartHour)).padStart(2, '0')}:${String(open.minutes).padStart(2, '0')}:00Z`
    );
    // Handle day rollover for UTC conversion
    if (utcStartHour < 0) {
      utcDateStart.setUTCDate(utcDateStart.getUTCDate() - 1);
      utcDateStart.setUTCHours(24 + utcStartHour);
    }

    const utcCloseHour = close.hours - HARARE_OFFSET_HOURS;
    const utcDateEnd = new Date(
      `${dateStr}T${String(Math.max(0, utcCloseHour)).padStart(2, '0')}:${String(close.minutes).padStart(2, '0')}:00Z`
    );
    if (utcCloseHour < 0) {
      utcDateEnd.setUTCDate(utcDateEnd.getUTCDate() - 1);
      utcDateEnd.setUTCHours(24 + utcCloseHour);
    }

    // Get the UTC date string for querying (may span two UTC dates)
    // Query using the Harare date converted to UTC range
    const utcQueryDate = utcDateStart.toISOString().split('T')[0];
    let existingAppointments = await appointmentModel.getConfirmedForTenantOnDate(tenantId, utcQueryDate);

    // If UTC date differs from Harare date, also query the next day
    const utcEndDate = utcDateEnd.toISOString().split('T')[0];
    if (utcEndDate !== utcQueryDate) {
      const moreAppts = await appointmentModel.getConfirmedForTenantOnDate(tenantId, utcEndDate);
      existingAppointments = existingAppointments.concat(moreAppts);
    }

    // Filter appointments to those that overlap with the working hours window
    // An appointment overlaps if: appt.start < window.end AND appt.end > window.start
    const filteredAppointments = existingAppointments.filter((appt) => {
      const apptStart = new Date(appt.start_time).getTime();
      const apptEnd = new Date(appt.end_time).getTime();
      return apptStart < utcDateEnd.getTime() && apptEnd > utcDateStart.getTime();
    });

    // Sort by start_time
    filteredAppointments.sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );

    // Generate available slots
    const slots = [];
    const openMinutes = open.totalMinutes;
    const closeMinutes = close.totalMinutes;

    // Determine the minimum slot time (for today, filter out past slots)
    let minSlotMinutes = openMinutes;
    const isToday = dateStr === todayHarare();
    if (isToday) {
      const now = nowHarare();
      const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
      minSlotMinutes = Math.max(openMinutes, currentMinutes);
    }

    // Build occupied intervals in Harare local minutes-from-midnight
    const occupied = filteredAppointments.map((appt) => {
      const startUTC = new Date(appt.start_time);
      const endUTC = new Date(appt.end_time);
      // Convert to Harare local minutes from midnight
      const startLocal = (startUTC.getUTCHours() + HARARE_OFFSET_HOURS) * 60 + startUTC.getUTCMinutes();
      const endLocal = (endUTC.getUTCHours() + HARARE_OFFSET_HOURS) * 60 + endUTC.getUTCMinutes();
      return { start: startLocal, end: endLocal };
    });

    // Get dynamic slot increment based on average service duration
    const slotIncrementMinutes = await getAverageServiceDuration(tenantId);

    // Iterate through time slots starting from minSlotMinutes (which may be current time for today)
    for (let t = minSlotMinutes; t + serviceDurationMinutes <= closeMinutes; t += slotIncrementMinutes) {
      const slotStart = t;
      const slotEnd = t + serviceDurationMinutes;

      // Check if this slot overlaps with any existing appointment
      const hasConflict = occupied.some(
        (occ) => slotStart < occ.end && slotEnd > occ.start
      );

      if (!hasConflict) {
        const hh = String(Math.floor(t / 60)).padStart(2, '0');
        const mm = String(t % 60).padStart(2, '0');
        slots.push(`${hh}:${mm}`);
      }
    }

    return slots;
  } catch (err) {
    logger.error(`Error getting available slots: ${err.message}`);
    return [];
  }
}

module.exports = { getAvailableSlots };
