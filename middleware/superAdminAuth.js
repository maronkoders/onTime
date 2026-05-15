const superAdminModel = require('../models/superAdmin');
const logger = require('../utils/logger');

// Middleware to check if user is authenticated as super admin
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.isSuperAdmin) {
    return next();
  }
  // Not authenticated, redirect to login
  return res.redirect('/admin/login');
}

// Function to check credentials against database
async function authenticateSuperAdmin(username, password) {
  try {
    const admin = await superAdminModel.findByUsername(username);
    if (!admin) {
      return false;
    }
    
    return await superAdminModel.verifyPassword(admin, password);
  } catch (err) {
    logger.error(`Authentication error: ${err.message}`);
    return false;
  }
}

module.exports = {
  requireSuperAdmin,
  authenticateSuperAdmin,
};
