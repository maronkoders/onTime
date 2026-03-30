const cron = require('node-cron');
const tenantModel = require('../models/tenant');
const appointmentModel = require('../models/appointment');
const { sendMessage } = require('./whatsapp');
const { todayHarare, toHarareTime, formatTime, HARARE_OFFSET_HOURS } = require('../utils/time');
const logger = require('../utils/logger');

function startDailyNotifications() {
  // Run daily at 12:00 Harare time (UTC+2) => 10:00 UTC
  cron.schedule('0 10 * * *', async () => {
    logger.info('Running daily appointment notifications...');
    await sendDailySchedules();
  });

  logger.info('Daily notification cron job scheduled (12:00 Harare time)');
}

async function sendDailySchedules() {
  try {
    const tenants = await tenantModel.getAll();

    for (const tenant of tenants) {
      try {
        // Get today's date in Harare time, then convert to UTC for query
        const harareDateStr = todayHarare();

        // Convert Harare midnight to UTC for query
        const utcDate = new Date(`${harareDateStr}T00:00:00Z`);
        utcDate.setUTCHours(utcDate.getUTCHours() - HARARE_OFFSET_HOURS);
        const utcDateStr = utcDate.toISOString().split('T')[0];

        // Query for Harare "today" may span two UTC dates
        let appointments = await appointmentModel.findByTenantAndDate(tenant.id, utcDateStr);

        const nextUtcDate = new Date(utcDate);
        nextUtcDate.setUTCDate(nextUtcDate.getUTCDate() + 1);
        const nextUtcDateStr = nextUtcDate.toISOString().split('T')[0];
        if (nextUtcDateStr !== utcDateStr) {
          const moreAppts = await appointmentModel.findByTenantAndDate(tenant.id, nextUtcDateStr);
          appointments = appointments.concat(moreAppts);
        }

        // Filter to only those in the Harare "today" window
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

        let message;
        if (appointments.length === 0) {
          message = `📋 *${tenant.name}* - Daily Schedule\n\nNo appointments scheduled for today (${harareDateStr}).\n\nShare your booking link with clients to get more bookings!`;
        } else {
          const lines = appointments.map((a, i) => {
            const hTime = toHarareTime(a.start_time);
            const time = formatTime(hTime);
            return `${i + 1}. ${time} - ${a.service_name || 'Service'} (${a.client_name})`;
          });
          message = `📋 *${tenant.name}* - Today's Appointments (${harareDateStr})\n\n${lines.join('\n')}\n\nTotal: ${appointments.length} appointment(s)`;
        }

        await sendMessage(tenant.owner_phone, message);
        logger.info(`Daily notification sent to ${tenant.name} (${tenant.owner_phone})`);
      } catch (err) {
        logger.error(`Failed to send daily notification to tenant ${tenant.id}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`Failed to run daily notifications: ${err.message}`);
  }
}

module.exports = { startDailyNotifications, sendDailySchedules };
