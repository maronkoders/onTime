const logger = require('../utils/logger');

// Redis disabled for Railway deployment
// Using in-memory sessions instead
const mockRedis = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(),
  del: () => Promise.resolve(),
  exists: () => Promise.resolve(0),
  expire: () => Promise.resolve(),
};

logger.info('Redis disabled - using in-memory sessions');

module.exports = mockRedis;
