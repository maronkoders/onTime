const crypto = require('crypto');

function generateBookingCode(length = 8) {
  return crypto.randomBytes(length).toString('hex').substring(0, length).toUpperCase();
}

function normalizePhone(phone) {
  // Remove whatsapp: prefix if present (Twilio format)
  let cleaned = phone.replace(/^whatsapp:/, '');
  // Remove spaces, dashes, parentheses
  cleaned = cleaned.replace(/[\s\-\(\)]/g, '');
  // Ensure it starts with +
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function formatPhoneForWhatsApp(phone) {
  const normalized = normalizePhone(phone);
  return `whatsapp:${normalized}`;
}

function escapeMessage(text) {
  // Basic sanitization for message content
  return text.replace(/[<>]/g, '');
}

function truncate(str, maxLength = 1000) {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

function parseCommandArgs(body) {
  const trimmed = body.trim();
  const parts = trimmed.split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();
  return { command, args, parts };
}

function formatCurrency(amount) {
  return `$${parseFloat(amount).toFixed(2)}`;
}

function generateBookingLink(botPhone, bookingCode) {
  // Remove + from phone number for wa.me link
  const phone = botPhone.replace('+', '');
  return `https://wa.me/${phone}?text=book%20${bookingCode}`;
}

module.exports = {
  generateBookingCode,
  normalizePhone,
  formatPhoneForWhatsApp,
  escapeMessage,
  truncate,
  parseCommandArgs,
  formatCurrency,
  generateBookingLink,
};
