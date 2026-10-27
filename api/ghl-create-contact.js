const GHL_URL     = 'https://services.leadconnectorhq.com';
const LOCATION_ID = '8qkx5Hada8mesjOqMckj';
const AT_BASE     = 'appwmu552AUleDadr';
const AT_TABLE    = 'tblUlFciubEeVTFm7';
const { proofFor, headers, postOnly, leadTag } = require('../lib/validation');

module.exports = async function handler(req, res) {
  if (!postOnly(req, res)) return;

  const AT_PAT    = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

  const { firstName, lastName, companyName, recordId, cardMachine, leadSource } = req.body || {};

  const reviewUrl = recordId
    ? `https://avantis-direct-form.vercel.app/review?id=${recordId}`
    : '';

  try {
    const proof = proofFor(req.body || {});
    // Upsert makes a retry safe when a provider response or navigation is interrupted.
    const createRes = await fetch(`${GHL_URL}/contacts/upsert`, {
      method: 'POST',
      headers: headers(),
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        firstName,
        lastName,
        name:       [firstName, lastName].filter(Boolean).join(' '),
        email: proof.email,
        phone: proof.phone,
        companyName,
        locationId: process.env.GHL_LOCATION_ID || LOCATION_ID,
        source:     'public api',
        tags:       ['website', 'phone-verified', `email-${proof.emailResult.status}`, leadTag(leadSource)].filter(Boolean),
        customFields: [
          recordId    ? { id: 'S1KufkT83xxvvbPh4RAk', fieldValue: recordId }    : null,
          reviewUrl   ? { id: '7Fk4WaOYtd3AjtNSgTPv', fieldValue: reviewUrl }   : null,
          cardMachine ? { id: 'Z0JFokKIXS7lsKddH7bo', fieldValue: cardMachine } : null,
          recordId    ? { id: 'W1k4GnSnLg7ncX8a5UWz', fieldValue: `https://avantis-direct-form.vercel.app/page2?id=${recordId}` } : null,
        ].filter(Boolean),
      }),
    });

    const createData = await createRes.json();
    if (!createRes.ok) {
      console.error('GHL create contact failed:', createRes.status, createData);
      return res.status(502).json({ error: 'We could not save your details to our CRM. Please try again.' });
    }

    const contactId = createData.contact?.id;
    if (!contactId) return res.status(502).json({ error: 'CRM did not confirm your contact. Please try again.' });
    console.log('GHL contact created:', contactId);

    // 2. Write GHL Contact ID to Airtable immediately (before workflow, so a slow
    //    workflow call can't prevent this from completing within Vercel's timeout)
    if (contactId && recordId && AT_PAT) {
      try {
        const atRes = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${AT_TABLE}/${recordId}`, {
          method: 'PATCH',
          signal: AbortSignal.timeout(8000),
          headers: {
            'Authorization': `Bearer ${AT_PAT}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify({ fields: { 'GHL Contact ID': contactId } }),
        });
        const atData = await atRes.json();
        console.log('Airtable GHL ID saved:', atRes.status, JSON.stringify(atData).slice(0, 200));
      } catch (err) {
        console.error('Airtable GHL ID error:', err);
      }
    }

    return res.status(200).json({ ok: true, contactId });
  } catch (err) {
    console.error('ghl-create-contact error:', err);
    return res.status(err.status || 500).json({ error: err.status ? err.message : 'We could not save your details. Please try again.' });
  }
};
