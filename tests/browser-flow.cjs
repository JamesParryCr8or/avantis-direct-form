// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module.
// All provider traffic is mocked; this never sends SMS or creates live leads.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
Object.assign(process.env, {
  VERIFICATION_SIGNING_SECRET: 'browser-test-secret-with-at-least-32-characters', GHL_ACCESS_TOKEN: 'mock',
  GHL_PIT_TOKEN: 'mock', TWILIO_API_KEY: 'mock', TWILIO_API_SECRET: 'mock', TWILIO_VERIFY_SERVICE_SID: 'mock',
});
let crmCalls = 0;
global.fetch = async (url, options) => {
  let data;
  if (url.includes('/email/verify')) data = { result: JSON.parse(options.body).verify === 'invalid@example.com' ? 'undeliverable' : 'deliverable', risk: 'low' };
  else if (url.endsWith('/Verifications')) data = { status: 'pending' };
  else if (url.endsWith('/VerificationCheck')) data = { status: new URLSearchParams(options.body).get('Code') === '123456' ? 'approved' : 'pending' };
  else if (url.endsWith('/contacts/upsert')) { await new Promise(resolve => setTimeout(resolve, 600)); crmCalls++; data = { contact: { id: 'mock-contact' } }; }
  else throw new Error(`Unexpected provider URL: ${url}`);
  return { ok: true, status: 200, json: async () => data };
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let body = ''; for await (const part of req) body += part;
    req.body = JSON.parse(body || '{}');
    res.status = value => { res.statusCode = value; return res; };
    res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (url.pathname === '/api/airtable-create') return res.json({ id: 'recMock123' });
    if (url.pathname === '/api/airtable-update') return res.json({ ok: true });
    if (url.pathname === '/api/airtable-get') return res.json({ fields: {} });
    return require('../api/' + path.basename(url.pathname) + '.js')(req, res);
  }
  const file = url.pathname === '/' ? 'public/Form.html' : url.pathname === '/page2' ? 'public/Page2.html' : 'public' + url.pathname;
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base);
    await page.evaluate(async () => { await intlTelInput.getInstance(document.getElementById('f-phone')).promise; showStep(3); });
    await page.fill('#f-name', 'Test Merchant');
    await page.fill('#f-email', 'invalid@example.com');
    await page.evaluate(() => ContactValidation.setNumber('f-phone', '+447400123456'));
    assert.equal(await page.evaluate(() => ContactValidation.number('f-phone')), '+447400123456');
    await page.click('#step3-btn');
    await page.waitForSelector('#f-email.invalid');
    assert.equal(await page.locator('#icon-email').textContent(), '❌');
    assert.equal(await page.locator('#err-email').isVisible(), true);
    await page.waitForFunction(() => !document.getElementById('step3-btn').disabled);
    assert.equal(await page.locator('#step3-btn').getAttribute('aria-busy'), null);
    assert.equal(await page.locator('#step3-btn').evaluate(el => el.classList.contains('is-loading')), false);
    await page.fill('#f-email', 'test@example.com');
    await page.click('#step3-btn');
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.locator('#step3-btn').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#step3-btn').evaluate(el => getComputedStyle(el, '::after').animationName), 'button-loading-spin');
    const bounds = await page.locator('.contact-dialog').boundingBox();
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - 640) < 2, 'OTP dialog is horizontally centered');
    assert.equal(await page.locator('.iti__selected-dial-code').textContent(), '+44');
    assert.equal(crmCalls, 0);
    await page.fill('#verify-code', '000000');
    await page.click('.verify-confirm');
    await page.waitForFunction(() => document.querySelector('.verify-error').textContent.includes('incorrect'));
    assert.equal(crmCalls, 0);
    fs.mkdirSync('.vercel/qa', { recursive: true });
    await page.screenshot({ path: '.vercel/qa/phone-verification-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.vercel/qa/phone-verification-mobile.png' });
    assert.ok(await page.locator('.contact-dialog').evaluate(el => el.getBoundingClientRect().width <= innerWidth));
    await page.fill('#verify-code', '123456');
    await page.click('.verify-confirm');
    await page.waitForFunction(() => document.getElementById('step3-btn')?.textContent === 'Submitting…');
    assert.equal(await page.locator('#step3-btn').evaluate(el => el.classList.contains('is-loading')), true);
    await page.screenshot({ path: '.vercel/qa/button-loading-mobile.png' });
    await page.waitForURL('**/page2?id=recMock123');
    assert.equal(crmCalls, 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('avantis_ghl_contact_id')), 'mock-contact');
    await page.evaluate(async () => { await intlTelInput.getInstance(document.getElementById('p2-phone')).promise; });
    assert.equal(await page.evaluate(() => ContactValidation.number('p2-phone')), '+447400123456');
    assert.equal(await page.evaluate(() => ContactValidation.valid('p2-phone')), true);
    assert.deepEqual(errors, []);
    console.log('Browser flow passed: desktop/mobile OTP, wrong-code rejection, one confirmed direct CRM save, navigation and Page 2 phone prefill.');
  } finally { await browser.close(); server.close(); }
})().catch(err => { console.error(err); server.close(); process.exitCode = 1; });
