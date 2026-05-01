const db = require('../config/db');

const DEFAULT_TRIAL_PERIOD_DAYS = 14;

/**
 * Get a setting value by key
 * @param {string} key - The setting key
 * @returns {string|null} The setting value or null if not found
 */
async function getSetting(key) {
  const result = await db.query(
    'SELECT value FROM system_settings WHERE key = $1',
    [key]
  );
  return result.rows[0]?.value || null;
}

/**
 * Set a setting value (insert or update)
 * @param {string} key - The setting key
 * @param {string} value - The setting value
 * @param {string} description - Optional description
 */
async function setSetting(key, value, description = null) {
  const result = await db.query(
    `INSERT INTO system_settings (key, value, description)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [key, value, description]
  );
  return result.rows[0];
}

/**
 * Get the trial period days setting
 * @returns {number} Trial period in days (defaults to 14)
 */
async function getTrialPeriodDays() {
  const value = await getSetting('trial_period_days');
  const days = parseInt(value, 10);
  return isNaN(days) || days < 1 ? DEFAULT_TRIAL_PERIOD_DAYS : days;
}

/**
 * Set the trial period days
 * @param {number} days - Number of days for trial period
 * @returns {object} The updated setting
 */
async function setTrialPeriodDays(days) {
  const daysNum = parseInt(days, 10);
  if (isNaN(daysNum) || daysNum < 1) {
    throw new Error('Trial period must be at least 1 day');
  }
  return await setSetting(
    'trial_period_days',
    daysNum.toString(),
    'Default trial period duration in days for new salon registrations'
  );
}

/**
 * Get all system settings
 * @returns {array} All settings
 */
async function getAllSettings() {
  const result = await db.query(
    'SELECT * FROM system_settings ORDER BY key'
  );
  return result.rows;
}

module.exports = {
  getSetting,
  setSetting,
  getTrialPeriodDays,
  setTrialPeriodDays,
  getAllSettings,
  DEFAULT_TRIAL_PERIOD_DAYS,
};
