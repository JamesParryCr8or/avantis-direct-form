const GHL_URL = 'https://services.leadconnectorhq.com';
const { proofFor, headers, postOnly } = require('../lib/validation');

module.exports = async function handler(req, res) {
  if (!postOnly(req, res)) return;


  const {
    contactId,
    firstName, lastName, email, phone,
    companyName, website,
    address1, city, state, postalCode,
    typeOfBusiness, tradingLength,
    siteAbandonUrl,
  } = req.body || {};

  if (!contactId) return res.status(400).json({ error: 'Missing contactId' });

  const customFields = [
    website        ? { id: 'AAPOEyQ1AZbFSlzkAoNz', fieldValue: website }        : null,
    typeOfBusiness ? { id: 'IoLGSormx5QppxBjejP8', fieldValue: typeOfBusiness } : null,
    tradingLength  ? { id: 'ARZfDgj4mYZgJ8dI5ZE7', fieldValue: tradingLength }  : null,
    siteAbandonUrl ? { id: 'W1k4GnSnLg7ncX8a5UWz', fieldValue: siteAbandonUrl } : null,
  ].filter(Boolean);

  try {
    // Page 3 only changes its follow-up URL; contact-detail edits require proof.
    const proof = email !== undefined || phone !== undefined ? proofFor(req.body) : null;
    const updateRes = await fetch(`${GHL_URL}/contacts/${contactId}`, {
      method: 'PUT',
      headers: headers(),
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        firstName, lastName, email: proof?.email, phone: proof?.phone,
        companyName, website,
        address1, city, state, postalCode,
        country: 'GB',
        customFields,
      }),
    });

    const data = await updateRes.json();
    if (!updateRes.ok) {
      console.error('GHL update contact failed:', updateRes.status, data);
    } else {
      console.log('GHL contact updated:', contactId);
    }

    return res.status(updateRes.ok ? 200 : 502).json(updateRes.ok ? { ok: true } : { error: 'We could not update your CRM details. Please try again.' });
  } catch (err) {
    console.error('ghl-update-contact error:', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'We could not save your details. Please try again.' });
  }
};
