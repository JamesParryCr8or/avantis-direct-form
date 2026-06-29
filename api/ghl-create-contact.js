const GHL_URL     = 'https://services.leadconnectorhq.com';
const LOCATION_ID = '8qkx5Hada8mesjOqMckj';
const WORKFLOW_ID = '07b0fd6c-7eb8-466a-bc09-e1035a6acf80';
const AT_BASE     = 'appwmu552AUleDadr';
const AT_TABLE    = 'tblUlFciubEeVTFm7';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const GHL_TOKEN = process.env.GHL_ACCESS_TOKEN;
  const AT_PAT    = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

  const { firstName, lastName, email, phone, companyName, recordId, cardMachine } = req.body || {};

  const reviewUrl = recordId
    ? `https://avantis-direct-form.vercel.app/review?id=${recordId}`
    : '';

  try {
    // 1. Create GHL contact
    const createRes = await fetch(`${GHL_URL}/contacts/`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        'Authorization': `Bearer ${GHL_TOKEN}`,
        'Version':       '2021-07-28',
      },
      body: JSON.stringify({
        firstName,
        lastName,
        name:       [firstName, lastName].filter(Boolean).join(' '),
        email,
        phone,
        companyName,
        locationId: LOCATION_ID,
        source:     'Avantis Direct Form',
        customFields: [
          recordId    ? { id: 'S1KufkT83xxvvbPh4RAk', fieldValue: recordId }    : null,
          reviewUrl   ? { id: '7Fk4WaOYtd3AjtNSgTPv', fieldValue: reviewUrl }   : null,
          cardMachine ? { id: 'Z0JFokKIXS7lsKddH7bo', fieldValue: cardMachine } : null,
        ].filter(Boolean),
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error('GHL create contact failed:', createRes.status, createData);
      return res.status(createRes.status).json(createData);
    }

    const contactId = createData.contact?.id;
    console.log('GHL contact created:', contactId);

    // 2. Add to onboarding workflow (fire-and-forget)
    if (contactId) {
      fetch(`${GHL_URL}/contacts/${contactId}/workflow/${WORKFLOW_ID}`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Accept':        'application/json',
          'Authorization': `Bearer ${GHL_TOKEN}`,
          'Version':       '2023-02-21',
        },
        body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
      })
        .then(r => r.text().then(t => console.log('GHL workflow:', r.status, t)))
        .catch(err => console.error('GHL workflow error:', err));
    }

    // 3. Write GHL Contact ID back to Airtable (fire-and-forget)
    if (contactId && recordId && AT_PAT) {
      fetch(`https://api.airtable.com/v0/${AT_BASE}/${AT_TABLE}/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AT_PAT}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ fields: { 'GHL Contact ID': contactId } }),
      })
        .then(r => console.log('Airtable GHL ID saved:', r.status))
        .catch(err => console.error('Airtable GHL ID error:', err));
    }

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    console.error('ghl-create-contact error:', err);
    return res.status(500).json({ error: err.message });
  }
};
