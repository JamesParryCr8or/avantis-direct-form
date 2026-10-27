const crypto = require('node:crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

function problem(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function secret() {
  const value = process.env.VERIFICATION_SIGNING_SECRET;
  if (!value || value.length < 32) throw problem('Verification is not configured. Please contact our team.', 503);
  return value;
}
function sign(data, kind, ttl = 1800) {
  const payload = Buffer.from(JSON.stringify({ ...data, kind, exp: Math.floor(Date.now() / 1000) + ttl })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret()).update(payload).digest('base64url')}`;
}
function read(token, kind) {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw new Error();
    const [payload, signature, extra] = token.split('.');
    if (extra || !signature) throw new Error();
    const expected = crypto.createHmac('sha256', secret()).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error();
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.kind !== kind || !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000) throw new Error();
    return data;
  } catch {
    throw problem('Verification expired. Please verify your mobile number again.', 403);
  }
}
function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw problem('Please check your email address.');
  return email;
}
function phoneNumber(value) {
  if (typeof value !== 'string' || !/^\+[1-9]\d{7,14}$/.test(value)) throw problem('Please enter a valid international mobile number.');
  const parsed = parsePhoneNumberFromString(value);
  if (!parsed?.isValid()) throw problem('Please enter a valid mobile number.');
  // All countries are accepted unless PHONE_ALLOWED_COUNTRIES is explicitly set to a list.
  const restriction = process.env.PHONE_ALLOWED_COUNTRIES;
  if (restriction) {
    const allowed = restriction.split(',').map(c => c.trim().toUpperCase());
    if (!allowed.includes(parsed.country)) throw problem('SMS verification is not available for this country. Please contact our team.');
  }
  if (!['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(parsed.getType())) throw problem('Please use a mobile number that can receive text messages.');
  return parsed.number;
}
function proofFor(body) {
  const proof = read(body.verificationToken, 'verified');
  if (proof.phone !== phoneNumber(body.phone) || proof.email !== emailAddress(body.email)) {
    throw problem('Your contact details changed. Please verify them again.', 403);
  }
  return proof;
}
function headers() {
  const token = process.env.GHL_ACCESS_TOKEN || process.env.GHL_PIT_TOKEN;
  if (!token) throw problem('Lead submission is temporarily unavailable. Please try again later.', 503);
  return { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' };
}
async function verifyEmail(email) {
  const token = process.env.GHL_PIT_TOKEN || process.env.GHL_ACCESS_TOKEN;
  if (!token) throw problem('Email validation is not configured.', 503);
  try {
    const response = await fetch(`https://services.leadconnectorhq.com/email/verify?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID || '8qkx5Hada8mesjOqMckj')}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Version: 'v3', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', verify: email }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.verified === false) return { status: 'unverified', risk: 'unknown' };
    const valid = data.leadConnectorRecommendation?.isEmailValid ?? data.isEmailValid;
    if (valid === false || ['undeliverable', 'do_not_send'].includes(data.result)) throw Object.assign(problem('Please check your email address.', 422), { field: 'email' });
    return { status: data.result || (valid === true ? 'deliverable' : 'unknown'), risk: data.risk || 'unknown' };
  } catch (error) {
    if (error.status === 422) throw error;
    console.warn('GHL email validation unavailable:', error.message);
    return { status: 'unverified', risk: 'unknown' };
  }
}
async function twilio(path, params) {
  const user = process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID;
  const password = process.env.TWILIO_API_KEY ? process.env.TWILIO_API_SECRET : process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!user || !password || !service) throw problem('SMS verification is not configured. Please contact our team.', 503);
  const response = await fetch(`https://verify.twilio.com/v2/Services/${service}/${path}`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) {
    console.warn('Twilio verification error:', response.status, data.code);
    if (response.status === 429 || [60202, 60203, 60212].includes(data.code)) throw problem('Too many attempts. Please wait before trying again.', 429);
    if (response.status === 404 || data.code === 60200) throw problem('The code has expired. Please request a new code.', 410);
    throw problem('We could not verify this number. Please try again shortly.', 502);
  }
  return data;
}
function postOnly(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Method not allowed' }); return false; }
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (origin && host && new URL(origin).host !== host) { res.status(403).json({ error: 'Invalid request origin' }); return false; }
  return true;
}
// CRM tag for the page a lead came in on. Only these keys are accepted from the browser.
const LEAD_TAGS = {
  'uk-terminals': 'UK terminals',
  'uae-terminals': 'UAE terminals',
  'uae-payment-gateways': 'UAE payment gateways',
};
function leadTag(key) {
  return LEAD_TAGS[key] || null;
}
module.exports = { problem, sign, read, emailAddress, phoneNumber, proofFor, headers, verifyEmail, twilio, postOnly, leadTag };
