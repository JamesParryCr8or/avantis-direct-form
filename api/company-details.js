const CH_BASE = 'https://api.company-information.service.gov.uk';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const CH_API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
  const { number }  = req.query;
  if (!number) return res.status(400).json({ error: 'Company number required' });

  const auth = 'Basic ' + Buffer.from(CH_API_KEY + ':').toString('base64');

  try {
    const [compRes, offRes] = await Promise.all([
      fetch(`${CH_BASE}/company/${encodeURIComponent(number)}`,          { headers: { Authorization: auth } }),
      fetch(`${CH_BASE}/company/${encodeURIComponent(number)}/officers`, { headers: { Authorization: auth } }),
    ]);

    const company  = compRes.ok ? await compRes.json() : null;
    const officers = offRes.ok  ? await offRes.json()  : null;

    const directors = (officers?.items || [])
      .filter(o => !o.resigned_on && ['director', 'corporate-director'].includes(o.officer_role))
      .map(o => ({
        name:      formatName(o.name),
        role:      o.officer_role,
        appointed: o.appointed_on,
        dob:       o.date_of_birth
                     ? { month: o.date_of_birth.month, year: o.date_of_birth.year }
                     : null,
      }));

    return res.status(200).json({
      company: company ? {
        name:          company.company_name,
        number:        company.company_number,
        status:        company.company_status,
        incorporatedOn: company.date_of_creation,
        address:       company.registered_office_address || null,
        sicCodes:      company.sic_codes || [],
      } : null,
      directors,
    });
  } catch (err) {
    console.error('Company details error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function formatName(raw) {
  if (!raw) return '';
  const comma = raw.indexOf(',');
  if (comma === -1) return toTitleCase(raw);
  const surname   = toTitleCase(raw.slice(0, comma).trim());
  const forenames = toTitleCase(raw.slice(comma + 1).trim());
  return `${forenames} ${surname}`;
}

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
