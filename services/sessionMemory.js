const logger = require('../utils/logger');

// In-memory session store
const sessions = new Map();

const SESSION_TTL = 1800; // 30 minutes in seconds

// Clean up expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL * 1000) {
      sessions.delete(phone);
    }
  }
}, 5 * 60 * 1000);

async function getSession(phone) {
  try {
    const session = sessions.get(phone);
    if (!session) return null;
    
    // Check if expired
    if (Date.now() - session.createdAt > SESSION_TTL * 1000) {
      sessions.delete(phone);
      return null;
    }
    
    return session.data;
  } catch (err) {
    logger.error(`Failed to get session for ${phone}: ${err.message}`);
    return null;
  }
}

async function setSession(phone, sessionData) {
  try {
    sessions.set(phone, {
      data: sessionData,
      createdAt: Date.now(),
    });
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
    sessions.delete(phone);
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
