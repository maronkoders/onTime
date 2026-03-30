const redis = require('../config/redis');
const logger = require('../utils/logger');

const SESSION_TTL = 1800; // 30 minutes in seconds
const KEY_PREFIX = 'session:';

async function getSession(phone) {
  try {
    const data = await redis.get(`${KEY_PREFIX}${phone}`);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    logger.error(`Failed to get session for ${phone}: ${err.message}`);
    return null;
  }
}

async function setSession(phone, session) {
  try {
    await redis.set(
      `${KEY_PREFIX}${phone}`,
      JSON.stringify(session),
      'EX',
      SESSION_TTL
    );
  } catch (err) {
    logger.error(`Failed to set session for ${phone}: ${err.message}`);
  }
}

async function updateSession(phone, updates) {
  const session = (await getSession(phone)) || {};
  const merged = { ...session, ...updates };
  if (updates.context) {
    merged.context = { ...(session.context || {}), ...updates.context };
  }
  await setSession(phone, merged);
  return merged;
}

async function clearSession(phone) {
  try {
    await redis.del(`${KEY_PREFIX}${phone}`);
  } catch (err) {
    logger.error(`Failed to clear session for ${phone}: ${err.message}`);
  }
}

module.exports = {
  getSession,
  setSession,
  updateSession,
  clearSession,
};
