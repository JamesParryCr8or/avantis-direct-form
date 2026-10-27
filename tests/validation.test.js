const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../lib/validation');
const phoneHandler = require('../api/phone-verification');
const createHandler = require('../api/ghl-create-contact');
const updateHandler = require('../api/ghl-update-contact');
const originalFetch = global.fetch;
Object.assign(process.env, {
  VERIFICATION_SIGNING_SECRET: 'test-signing-secret-with-at-least-32-characters',
  GHL_ACCESS_TOKEN: 'test-contact-token', GHL_PIT_TOKEN: 'test-email-token',
  TWILIO_API_KEY: 'test-key', TWILIO_API_SECRET: 'test-secret', TWILIO_VERIFY_SERVICE_SID: 'test-service',
});
afterEach(() => { global.fetch = originalFetch; });
const details = { email: 'test@example.com', phone: '+447400123456' };
const emailResult = { status: 'deliverable', risk: 'low' };
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
async function invoke(handler, body, method = 'POST') {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.statusCode = s; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method, body, headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  return res;
}
test('proof rejects tampering, expiry, changed email and phone', () => {
  const token = validation.sign({ ...details, emailResult }, 'verified');
  assert.equal(validation.proofFor({ ...details, verificationToken: token }).phone, details.phone);
  assert.throws(() => validation.read(token + 'x', 'verified'));
  assert.throws(() => validation.read(validation.sign(details, 'verified', -1), 'verified'));
  assert.throws(() => validation.proofFor({ ...details, email: 'different@example.com', verificationToken: token }));
  assert.throws(() => validation.proofFor({ ...details, phone: '+447400123457', verificationToken: token }));
});
test('server rejects malformed and landline numbers', () => {
  for (const phone of ['07911123456', '+441234', '+442079460123']) assert.throws(() => validation.phoneNumber(phone));
  assert.equal(validation.phoneNumber(details.phone), details.phone);
});
test('server accepts mobile numbers from any country', () => {
  for (const phone of ['+971501234567', '+12025550123']) assert.equal(validation.phoneNumber(phone), phone);
});
test('email decision table handles every documented result shape', async () => {
  for (const data of [{ result: 'undeliverable' }, { result: 'do_not_send' }, { isEmailValid: false }, { leadConnectorRecommendation: { isEmailValid: false } }]) {
    global.fetch = async () => response(data);
    await assert.rejects(validation.verifyEmail(details.email), { status: 422 });
  }
  for (const data of [{ result: 'catch_all' }, { result: 'unknown' }, { isEmailValid: true }, { verified: false }]) {
    global.fetch = async () => response(data);
    assert.ok((await validation.verifyEmail(details.email)).status);
  }
  global.fetch = async () => response({}, 503);
  assert.equal((await validation.verifyEmail(details.email)).status, 'unverified');
});
test('undeliverable email prevents SMS charge', async () => {
  let calls = 0;
  global.fetch = async url => { calls++; assert.match(url, /email\/verify/); return response({ result: 'undeliverable' }); };
  const result = await invoke(phoneHandler, { ...details, action: 'send' });
  assert.equal(result.statusCode, 422);
  assert.equal(result.data.field, 'email');
  assert.equal(calls, 1);
});
test('send uses email v3, SMS channel and distributed rate limits; resend reuses email result', async () => {
  let emailCalls = 0;
  global.fetch = async (url, options) => {
    if (url.includes('/email/verify')) {
      emailCalls++; assert.equal(options.headers.Version, 'v3'); return response({ result: 'deliverable' });
    }
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('To'), details.phone);
    assert.equal(body.get('Channel'), 'sms');
    assert.deepEqual(Object.keys(JSON.parse(body.get('RateLimits'))), ['avantis_phone', 'avantis_ip']);
    return response({ status: 'pending' });
  };
  const first = await invoke(phoneHandler, { ...details, action: 'send' });
  assert.equal(first.statusCode, 200);
  assert.equal(first.data.emailStatus, 'deliverable');
  await invoke(phoneHandler, { ...details, action: 'send', challenge: first.data.challenge });
  assert.equal(emailCalls, 1);
});
test('wrong code, expired code, rate limits and changed challenge never issue proof', async () => {
  const challenge = validation.sign({ ...details, emailResult }, 'challenge');
  for (const [data, status, expected] of [[{ status: 'pending' }, 200, 422], [{ code: 20404 }, 404, 410], [{ code: 60202 }, 429, 429]]) {
    global.fetch = async () => response(data, status);
    const result = await invoke(phoneHandler, { ...details, action: 'check', code: '123456', challenge });
    assert.equal(result.statusCode, expected); assert.equal(result.data.verificationToken, undefined);
  }
  global.fetch = async () => { throw new Error('Provider must not be called'); };
  const changed = await invoke(phoneHandler, { ...details, email: 'changed@example.com', action: 'check', code: '123456', challenge });
  assert.equal(changed.statusCode, 403);
});
test('approved code issues signed proof accepted by direct contact upsert', async () => {
  global.fetch = async () => response({ status: 'approved' });
  const checked = await invoke(phoneHandler, { ...details, action: 'check', code: '123456', challenge: validation.sign({ ...details, emailResult }, 'challenge') });
  assert.equal(checked.statusCode, 200);
  global.fetch = async (url, options) => {
    assert.match(url, /contacts\/upsert$/);
    const body = JSON.parse(options.body);
    assert.equal(body.phone, details.phone);
    assert.ok(body.tags.includes('phone-verified'));
    assert.ok(body.tags.includes('email-deliverable'));
    return response({ contact: { id: 'contact-123' } });
  };
  const created = await invoke(createHandler, { ...details, verificationToken: checked.data.verificationToken });
  assert.equal(created.data.contactId, 'contact-123');
});
test('contact create and contact-detail update cannot bypass SMS proof', async () => {
  global.fetch = async () => { throw new Error('Provider must not be called'); };
  assert.equal((await invoke(createHandler, details)).statusCode, 403);
  assert.equal((await invoke(updateHandler, { ...details, contactId: 'contact-123' })).statusCode, 403);
});
test('CRM failures return actionable error and missing contact ID never reports success', async () => {
  const body = { ...details, verificationToken: validation.sign({ ...details, emailResult }, 'verified') };
  for (const [data, status] of [[{ message: 'Internal provider data' }, 401], [{}, 200]]) {
    global.fetch = async () => response(data, status);
    const result = await invoke(createHandler, body);
    assert.equal(result.statusCode, 502); assert.ok(result.data.error); assert.equal(result.data.contactId, undefined);
  }
});
test('retired webhook never forwards lead data', async () => {
  global.fetch = async () => { throw new Error('Must not call webhook'); };
  assert.equal((await invoke(require('../api/send-webhook'), details)).statusCode, 410);
});
