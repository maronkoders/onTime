const HARARE_OFFSET_HOURS = 2; // UTC+2

function nowHarare() {
  const now = new Date();
  return new Date(now.getTime() + HARARE_OFFSET_HOURS * 60 * 60 * 1000);
}

function todayHarare() {
  const h = nowHarare();
  return h.toISOString().split('T')[0]; // YYYY-MM-DD
}

function toHarareTime(utcDate) {
  const d = new Date(utcDate);
  return new Date(d.getTime() + HARARE_OFFSET_HOURS * 60 * 60 * 1000);
}

function toUTC(harareDate) {
  const d = new Date(harareDate);
  return new Date(d.getTime() - HARARE_OFFSET_HOURS * 60 * 60 * 1000);
}

function formatTime(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDate(date) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}

function formatDateTime(utcDate) {
  const h = toHarareTime(utcDate);
  const date = h.toISOString().split('T')[0];
  const time = formatTime(h);
  return `${date} ${time}`;
}

function getDayOfWeek(dateStr) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const d = new Date(dateStr + 'T00:00:00Z');
  return days[d.getUTCDay()];
}

function parseTimeString(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

function isDateInPast(dateStr) {
  const today = todayHarare();
  return dateStr < today;
}

function isValidDate(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return d instanceof Date && !isNaN(d) && d.toISOString().startsWith(dateStr);
}

function createUTCDateTime(dateStr, timeStr) {
  const { hours, minutes } = parseTimeString(timeStr);
  // dateStr is in Harare local, timeStr is in Harare local
  // Convert to UTC by subtracting offset
  const d = new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`);
  // Subtract Harare offset to get UTC
  return new Date(d.getTime() - HARARE_OFFSET_HOURS * 60 * 60 * 1000);
}

module.exports = {
  HARARE_OFFSET_HOURS,
  nowHarare,
  todayHarare,
  toHarareTime,
  toUTC,
  formatTime,
  formatDate,
  formatDateTime,
  getDayOfWeek,
  parseTimeString,
  isDateInPast,
  isValidDate,
  createUTCDateTime,
};
