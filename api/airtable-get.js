const AT_BASE  = 'appwmu552AUleDadr';
const AT_TABLE = 'tblUlFciubEeVTFm7';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const AT_PAT = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: 'Missing id' });

  try {
    const atRes = await fetch(
      `https://api.airtable.com/v0/${AT_BASE}/${AT_TABLE}/${id}`,
      { headers: { Authorization: `Bearer ${AT_PAT}` } }
    );

    const data = await atRes.json();
    return res.status(atRes.status).json(data);
  } catch (err) {
    console.error('Airtable get error:', err);
    return res.status(500).json({ error: err.message });
  }
};
