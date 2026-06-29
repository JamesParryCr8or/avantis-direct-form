module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const ROYAL_MAIL_API_KEY = process.env.ROYAL_MAIL_API_KEY;
  // Accept ?q= (typeahead) or legacy ?postcode=
  const query = ((req.query.q || req.query.postcode) || '').trim();
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    // Royal Mail Address Management (PAF) API
    // Swap the URL/headers below if using a reseller (Loqate, getAddress.io, etc.)
    const url = `https://api.royalmail.net/v2/address/addresses?query=${encodeURIComponent(query)}`;
    const rmRes = await fetch(url, {
      headers: { Authorization: ROYAL_MAIL_API_KEY, Accept: 'application/json' },
    });

    if (!rmRes.ok) return fallback(query, res);

    const data = await rmRes.json();
    const addresses = (data.addresses || data.results || []).map(a => ({
      line1:    [a.buildingNumber, a.buildingName, a.thoroughfareName].filter(Boolean).join(' '),
      city:     a.postTown  || a.town || '',
      county:   a.county    || a.dependentLocality || '',
      postcode: a.postcode  || query,
    }));
    return res.status(200).json({ addresses });
  } catch {
    return fallback(query, res);
  }
};

async function fallback(query, res) {
  // postcodes.io only helps for postcode-style queries
  const clean = query.replace(/\s/g, '');
  const isPostcode = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/i.test(clean);
  if (!isPostcode) return res.status(200).json({ addresses: [], fallback: true });

  try {
    const r    = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
    const data = await r.json();
    if (data.status === 200) {
      return res.status(200).json({
        addresses: [{
          line1:    '',
          city:     data.result.admin_district || data.result.parliamentary_constituency || '',
          county:   data.result.admin_county   || data.result.region || '',
          postcode: data.result.postcode,
        }],
        fallback: true,
      });
    }
  } catch {}
  return res.status(200).json({ addresses: [], fallback: true });
}
