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

function formatServiceTable(services, { showId = false } = {}) {
  // Calculate column widths
  const rows = services.map((s, i) => ({
    num: `${i + 1}`,
    name: s.name,
    dur: `${s.duration_minutes} min`,
    price: formatCurrency(s.price),
    id: showId ? `${s.id}` : '',
  }));

  const nameW = Math.max(7, ...rows.map(r => r.name.length));
  const durW = Math.max(8, ...rows.map(r => r.dur.length));
  const priceW = Math.max(5, ...rows.map(r => r.price.length));

  const pad = (str, w) => str + ' '.repeat(Math.max(0, w - str.length));

  let header = `#  ${pad('Service', nameW)}  ${pad('Duration', durW)}  Price`;
  let divider = '-'.repeat(header.length);

  if (showId) {
    header += '   ID';
    divider = '-'.repeat(header.length);
  }

  const lines = rows.map(r => {
    let line = `${r.num}. ${pad(r.name, nameW)}  ${pad(r.dur, durW)}  ${r.price}`;
    if (showId) line += `   ${r.id}`;
    return line;
  });

  return '```\n' + header + '\n' + divider + '\n' + lines.join('\n') + '\n```';
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
  formatServiceTable,
  generateBookingLink,
};
