// Airtable upload attachment API:
// POST https://content.airtable.com/v0/{baseId}/{recordId}/{fieldIdOrName}/uploadAttachment
// Body: JSON { contentType, file: base64string, filename }

const AT_BASE = 'appwmu552AUleDadr';
const AT_PAT  = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

module.exports.config = {
  api: { bodyParser: { sizeLimit: '12mb' } },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { recordId, fieldId, filename, contentType, fileBase64 } = req.body || {};

  if (!recordId || !fieldId || !fileBase64) {
    return res.status(400).json({ error: 'Missing recordId, fieldId or fileBase64' });
  }

  try {
    const atRes = await fetch(
      `https://content.airtable.com/v0/${AT_BASE}/${recordId}/${encodeURIComponent(fieldId)}/uploadAttachment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AT_PAT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contentType: contentType || 'application/octet-stream',
          file: fileBase64,
          filename: filename || 'upload',
        }),
      }
    );

    const text = await atRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!atRes.ok) {
      console.error(`Upload failed ${atRes.status} field=${fieldId} record=${recordId}:`, text);
    }
    return res.status(atRes.status).json(data);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
};
