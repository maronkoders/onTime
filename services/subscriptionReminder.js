const cron = require('node-cron');
const subscriptionModel = require('../models/subscription');
const tenantModel = require('../models/tenant');
const { sendMessage } = require('../services/whatsapp');
const logger = require('../utils/logger');

// Run daily at 9 AM Harare time
function startExpiryReminderJob() {
  cron.schedule('0 9 * * *', async () => {
    logger.info('Running expiry reminder job...');
    
    try {
      // Get all subscriptions expiring within 7 days
      const expiringSubs = await subscriptionModel.getExpiringSubscriptions(7);
      
      logger.info(`Found ${expiringSubs.length} subscriptions expiring within 7 days`);
      
      for (const sub of expiringSubs) {
        try {
          const daysRemaining = Math.ceil((new Date(sub.expiry_date) - new Date()) / (1000 * 60 * 60 * 24));
          
          // Send reminder message to salon owner
          const reminderMessage = buildReminderMessage(sub, daysRemaining);
          
          await sendMessage(sub.owner_phone, reminderMessage);
          
          // Mark reminder as sent
          await subscriptionModel.markReminderSent(sub.id);
          
          logger.info(`Sent expiry reminder to ${sub.tenant_name} (${sub.owner_phone}) - ${daysRemaining} days remaining`);
        } catch (err) {
          logger.error(`Failed to send reminder for subscription ${sub.id}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`Expiry reminder job failed: ${err.message}`);
    }
  }, {
    timezone: 'Africa/Harare'
  });
  
  logger.info('Expiry reminder cron job started - runs daily at 9:00 AM Harare time');
}

function buildReminderMessage(sub, daysRemaining) {
  const expiryDate = new Date(sub.expiry_date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  let urgencyEmoji = daysRemaining <= 3 ? '🚨' : daysRemaining <= 7 ? '⏰' : '📅';
  let urgencyText = daysRemaining <= 3 ? 'URGENT' : 'Reminder';
  
  return `${urgencyEmoji} *Subscription ${urgencyText}*\n\n` +
    `Hi ${sub.tenant_name},\n\n` +
    `Your ${sub.subscription_status} subscription expires in *${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}* on ${expiryDate}.\n\n` +
    `💡 *Don't lose your clients!*\n` +
    `Your booking link will stop accepting appointments after this date.\n\n` +
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
    `   Example: *PAID 12 ecocash*\n\n` +
    `Thank you for using OnTime! 🎉`;
}

module.exports = { startExpiryReminderJob };
