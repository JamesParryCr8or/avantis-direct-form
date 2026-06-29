const CH_API_KEY = process.env.COMPANIES_HOUSE_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ items: [] });
  }

  try {
    const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q.trim())}&items_per_page=8`;
    const response = await fetch(url, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(CH_API_KEY + ':').toString('base64'),
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ items: [] });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err) {
    console.error('CH search error:', err);
    return res.status(500).json({ items: [] });
  }
};
