// UAE address lookup via Google Places API (New).
// Autocomplete returns suggestions (?q=), Place Details resolves one (?id=).
const AUTOCOMPLETE = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS      = 'https://places.googleapis.com/v1/places';
// The key may carry a website restriction for this site, so server calls send it as the referrer.
const REFERER      = 'https://avantis-direct-form.vercel.app/';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const KEY = process.env.GOOGLE_PLACES_API;
  const { q, id } = req.query;

  if (!KEY) {
    console.error('GOOGLE_PLACES_API is not set');
    return q ? res.status(200).json({ items: [] }) : res.status(503).json({ error: 'Address lookup is not configured' });
  }

  // ── Retrieve: resolve a place ID into structured address parts ──
  if (id) {
    try {
      const r = await fetch(`${DETAILS}/${encodeURIComponent(id)}?languageCode=en`, {
        headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'addressComponents,formattedAddress', Referer: REFERER },
        signal: AbortSignal.timeout(8000),
      });
      const place = await r.json();
      if (!r.ok) {
        console.error('Google place details error:', r.status, JSON.stringify(place.error || {}).slice(0, 200));
        return res.status(404).json({ error: 'Not found' });
      }

      const parts = type => place.addressComponents?.find(c => c.types?.includes(type))?.longText || '';
      const streetNo = parts('street_number') || parts('premise');
      const route    = parts('route');
      const line1    = [streetNo, route].filter(Boolean).join(' ')
        || (place.formattedAddress || '').split(',')[0].trim();

      return res.status(200).json({
        address: {
          line1,
          line2:    parts('sublocality_level_1') || parts('neighborhood'),
          city:     parts('locality') || parts('sublocality_level_1'),
          county:   parts('administrative_area_level_1'), // emirate, e.g. "Dubai"
          postcode: parts('postal_code'),                 // usually empty in the UAE
          country:  parts('country'),                     // e.g. "United Arab Emirates"
        },
      });
    } catch (err) {
      console.error('Google place details error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Find: autocomplete restricted to the UAE ──
  if (q) {
    try {
      const r = await fetch(AUTOCOMPLETE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, Referer: REFERER },
        // Bias ranks UAE results first but still returns addresses from elsewhere.
        body: JSON.stringify({
          input: q,
          languageCode: 'en',
          locationBias: { rectangle: { low: { latitude: 22.6, longitude: 51.5 }, high: { latitude: 26.1, longitude: 56.4 } } },
        }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await r.json();
      if (!r.ok) {
        console.error('Google autocomplete error:', r.status, JSON.stringify(data.error || {}).slice(0, 200));
        return res.status(200).json({ items: [] });
      }

      return res.status(200).json({
        items: (data.suggestions || [])
          .map(s => s.placePrediction)
          .filter(Boolean)
          .slice(0, 10)
          .map(p => ({
            id:          p.placeId,
            text:        p.structuredFormat?.mainText?.text || p.text?.text || '',
            description: p.structuredFormat?.secondaryText?.text || '',
            type:        'Address', // every Google prediction is a place, so the page retrieves it directly
          })),
      });
    } catch (err) {
      console.error('Google autocomplete error:', err);
      return res.status(200).json({ items: [] });
    }
  }

  return res.status(400).json({ error: 'Provide ?q= or ?id=' });
};
