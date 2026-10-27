const crypto = require('node:crypto');
const { problem, sign, read, emailAddress, phoneNumber, verifyEmail, twilio, postOnly } = require('../lib/validation');

module.exports = async function handler(req, res) {
  if (!postOnly(req, res)) return;
  try {
    const { action, code, challenge } = req.body || {};
    const email = emailAddress(req.body?.email);
    const phone = phoneNumber(req.body?.phone);
    if (action === 'send') {
      // Twilio enforces these persistent service limits across serverless instances.
      // setup:twilio provisions per-number cooldown/hourly and per-IP hourly buckets.
      let previous;
      if (challenge) {
        try { previous = read(challenge, 'challenge'); } catch {}
      }
      const emailResult = previous?.email === email ? previous.emailResult : await verifyEmail(email);
      const ip = req.headers?.['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
      const digest = value => crypto.createHash('sha256').update(value).digest('hex');
      // Ensure signing is configured before incurring an SMS charge.
      const token = sign({ email, phone, emailResult }, 'challenge', 600);
      const result = await twilio('Verifications', {
        To: phone, Channel: 'sms',
        RateLimits: JSON.stringify({ avantis_phone: digest(phone), avantis_ip: digest(ip) }),
      });
      if (result.status !== 'pending') throw problem('Unable to send a code. Please try again.', 502);
      return res.status(200).json({ challenge: token, retryAfter: 60, emailStatus: emailResult.status });
    }
    if (action === 'check') {
      const pending = read(challenge, 'challenge');
      if (pending.email !== email || pending.phone !== phone) throw problem('Your details changed. Please request a new code.', 403);
      if (typeof code !== 'string' || !/^\d{4,10}$/.test(code)) throw problem('Please enter the code from your text message.');
      const result = await twilio('VerificationCheck', { To: phone, Code: code });
      if (result.status !== 'approved') throw problem('That code is incorrect. Please try again.', 422);
      return res.status(200).json({ verificationToken: sign({ email, phone, emailResult: pending.emailResult, verifiedAt: new Date().toISOString() }, 'verified') });
    }
    throw problem('Invalid verification action.');
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.status ? error.message : 'Verification is temporarily unavailable. Please try again.', field: error.field });
  }
};
