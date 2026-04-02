const SUPER_ADMIN_USERNAME = 'hyfos';
const SUPER_ADMIN_PASSWORD = 'hyfos2305';

// Middleware to check if user is authenticated as super admin
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.isSuperAdmin) {
    return next();
  }
  // Not authenticated, redirect to login
  return res.redirect('/admin/login');
}

// Middleware to check credentials
function authenticateSuperAdmin(username, password) {
  return username === SUPER_ADMIN_USERNAME && password === SUPER_ADMIN_PASSWORD;
}

module.exports = {
  requireSuperAdmin,
  authenticateSuperAdmin,
};
