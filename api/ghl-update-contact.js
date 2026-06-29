const GHL_URL = 'https://services.leadconnectorhq.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const GHL_TOKEN = process.env.GHL_ACCESS_TOKEN;

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
    const updateRes = await fetch(`${GHL_URL}/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${GHL_TOKEN}`,
        'Version':       '2021-07-28',
      },
      body: JSON.stringify({
        firstName, lastName, email, phone,
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

    return res.status(updateRes.ok ? 200 : updateRes.status).json({ ok: updateRes.ok, data });
  } catch (err) {
    console.error('ghl-update-contact error:', err);
    return res.status(500).json({ error: err.message });
  }
};
