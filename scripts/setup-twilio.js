// Idempotently provision distributed OTP send limits on the existing Verify service.
const { twilio } = require('../lib/validation');
async function get(path) {
  const user = process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID;
  const password = process.env.TWILIO_API_KEY ? process.env.TWILIO_API_SECRET : process.env.TWILIO_AUTH_TOKEN;
  const response = await fetch(`https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}/${path}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Twilio setup failed: HTTP ${response.status}`);
  return response.json();
}
async function setup() {
  const { rate_limits: limits } = await get('RateLimits?PageSize=100');
  for (const [name, buckets] of [['avantis_phone', [[1, 60], [5, 3600]]], ['avantis_ip', [[20, 3600]]]]) {
    const limit = limits.find(item => item.unique_name === name) || await twilio('RateLimits', { UniqueName: name });
    const existing = (await get(`RateLimits/${limit.sid}/Buckets?PageSize=100`)).buckets;
    for (const [max, interval] of buckets) {
      const bucket = existing.find(item => item.interval === interval);
      if (!bucket) await twilio(`RateLimits/${limit.sid}/Buckets`, { Max: max, Interval: interval });
      else if (bucket.max !== max) await twilio(`RateLimits/${limit.sid}/Buckets/${bucket.sid}`, { Max: max, Interval: interval });
    }
    console.log(`Configured ${name}`);
  }
}
if (require.main === module) setup().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = setup;
