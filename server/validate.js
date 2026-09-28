const { bad } = require('./errors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_.]{3,24}$/;

const OFFER_REASONS = {
  wrong_order: 'Wrong order',
  delayed_order: 'Delayed delivery',
  unclaimed_order: 'Order never picked up',
  overproduction: 'Made too much',
  end_of_day: 'End-of-day surplus',
  other: 'Other',
};

const DIETARY_TAGS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'nut-free', 'halal', 'kosher', 'spicy'];

function str(value, field, { min = 0, max = 200, optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    throw bad(`${field} is required.`);
  }
  if (typeof value !== 'string') throw bad(`${field} must be text.`);
  const v = value.trim();
  if (v.length < min) throw bad(`${field} must be at least ${min} characters.`);
  if (v.length > max) throw bad(`${field} must be at most ${max} characters.`);
  return v;
}

function int(value, field, { min, max }) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number from ${min} to ${max}.`);
  return n;
}

function dollarsToCents(value, field, { min, max }) {
  const n = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw bad(`${field} must be between $${min.toFixed(2)} and $${max.toFixed(2)}.`);
  }
  return Math.round(n * 100);
}

function isoDate(value, field) {
  const d = new Date(value);
  if (typeof value !== 'string' || Number.isNaN(d.getTime())) throw bad(`${field} must be a valid date and time.`);
  return d;
}

function coord(value, field, limit) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw bad(`${field} is invalid.`);
  return n;
}

function email(value) {
  const v = str(value, 'Email', { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw bad('Please enter a valid email address.');
  return v;
}

function username(value) {
  const v = str(value, 'User name', { max: 24 });
  if (!USERNAME_RE.test(v)) throw bad('User name must be 3-24 characters: letters, numbers, dots or underscores.');
  return v;
}

function password(value) {
  if (typeof value !== 'string' || value.length < 8) throw bad('Password must be at least 8 characters.');
  if (value.length > 200) throw bad('Password is too long.');
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) throw bad('Password must include at least one letter and one number.');
  return value;
}

function zip(value) {
  const v = str(value, 'ZIP code', { max: 10 });
  if (!/^\d{5}(-\d{4})?$/.test(v)) throw bad('Please enter a valid ZIP code.');
  return v;
}

function dietary(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const tags = [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  for (const t of tags) if (!DIETARY_TAGS.includes(t)) throw bad(`Unknown dietary tag: ${t}`);
  return tags.join(',');
}

module.exports = { str, int, dollarsToCents, isoDate, coord, email, username, password, zip, dietary, OFFER_REASONS, DIETARY_TAGS };
