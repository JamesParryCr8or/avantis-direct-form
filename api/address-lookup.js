// Royal Mail AddressNow (Loqate) – two-step: find → retrieve
const FIND     = 'https://api.addressnow.co.uk/capture/interactive/find/v1.1/json3.ws';
const RETRIEVE = 'https://api.addressnow.co.uk/capture/interactive/retrieve/v1.2/json3.ws';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).end();

  const KEY = process.env.ROYAL_MAIL_API_KEY;
  const { q, id, container } = req.query;

  // ── Retrieve: get full address by Loqate ID ──
  if (id) {
    try {
      const url = `${RETRIEVE}?Key=${encodeURIComponent(KEY)}&Id=${encodeURIComponent(id)}`;
      const r    = await fetch(url);
      const data = await r.json();
      const item = data.Items?.[0];
      if (!item || item.Error) return res.status(404).json({ error: 'Not found' });

      const line1 = [item.BuildingNumber, item.BuildingName, item.PrimaryStreet || item.Street]
        .filter(Boolean).join(' ').trim() || item.Line1 || '';

      return res.status(200).json({
        address: {
          line1,
          line2:    item.SecondaryStreet || item.Line2 || '',
          city:     item.City || item.PostTown || '',
          county:   item.Province || item.AdminAreaName || '',
          postcode: item.PostalCode || '',
        },
      });
    } catch (err) {
      console.error('Loqate retrieve error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Find: search for addresses (with optional container drill-down) ──
  if (q) {
    try {
      const params = new URLSearchParams({
        Key:          KEY,
        Text:         q,
        IsMiddleware: 'false',
        Countries:    'GBR',
        Limit:        '10',
      });
      if (container) params.set('Container', container);

      const r    = await fetch(`${FIND}?${params}`);
      const data = await r.json();

      if (!r.ok || data.Items?.[0]?.Error) {
        console.error('Loqate find error:', JSON.stringify(data.Items?.[0]));
        return res.status(200).json({ items: [] });
      }

      return res.status(200).json({
        items: (data.Items || []).map(i => ({
          id:          i.Id,
          text:        i.Text,
          description: i.Description,
          type:        i.Type, // 'Address' | 'Postcode' | 'Street' | 'BuildingNumber' etc.
        })),
      });
    } catch (err) {
      console.error('Loqate find error:', err);
      return res.status(200).json({ items: [] });
    }
  }

  return res.status(400).json({ error: 'Provide ?q= or ?id=' });
};
