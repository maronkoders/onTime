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
  // After toHarareTime conversion, use local hours (getHours) not UTC (getUTCHours)
  // because the Date timestamp has already been adjusted
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
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
  const isoString = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`;
  console.log(`[TIME DEBUG] createUTCDateTime - isoString: ${isoString}`);
  const d = new Date(isoString);
  console.log(`[TIME DEBUG] createUTCDateTime - initial Date: ${d.toISOString()}`);
  console.log(`[TIME DEBUG] createUTCDateTime - initial timestamp: ${d.getTime()}`);
  console.log(`[TIME DEBUG] createUTCDateTime - HARARE_OFFSET_HOURS: ${HARARE_OFFSET_HOURS}`);
  const offsetMs = HARARE_OFFSET_HOURS * 60 * 60 * 1000;
  console.log(`[TIME DEBUG] createUTCDateTime - offsetMs: ${offsetMs}`);
  // Subtract Harare offset to get UTC
  const result = new Date(d.getTime() - offsetMs);
  console.log(`[TIME DEBUG] createUTCDateTime - result timestamp: ${result.getTime()}`);
  console.log(`[TIME DEBUG] createUTCDateTime - result ISO: ${result.toISOString()}`);
  return result;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatDateLong(dateStr) {
  // Input: '2026-04-08', Output: '08 April 2026'
  const [year, month, day] = dateStr.split('-');
  const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
  return `${day} ${monthName} ${year}`;
}

module.exports = {
  HARARE_OFFSET_HOURS,
  MONTH_NAMES,
  nowHarare,
  todayHarare,
  toHarareTime,
  toUTC,
  formatTime,
  formatDate,
  formatDateLong,
  formatDateTime,
  getDayOfWeek,
  parseTimeString,
  isDateInPast,
  isValidDate,
  createUTCDateTime,
};
