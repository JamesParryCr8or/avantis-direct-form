const AT_BASE  = 'appwmu552AUleDadr';
const AT_TABLE = 'tblUlFciubEeVTFm7';
const AT_PAT   = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;

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
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const fileBuffer = Buffer.from(fileBase64, 'base64');
    // Build multipart body — field ID goes in the URL path, not the body
    const boundary  = '----AirtableUpload' + Date.now().toString(36);
    const CRLF      = '\r\n';

    const partHeader =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename || 'upload'}"${CRLF}` +
      `Content-Type: ${contentType || 'application/octet-stream'}${CRLF}${CRLF}`;

    const footer = `${CRLF}--${boundary}--${CRLF}`;

    const body = Buffer.concat([
      Buffer.from(partHeader),
      fileBuffer,
      Buffer.from(footer),
    ]);

    // Correct URL format: /v0/{base}/{table}/{recordId}/{fieldId}/uploadAttachment
    const atRes = await fetch(
      `https://content.airtable.com/v0/${AT_BASE}/${AT_TABLE}/${recordId}/${encodeURIComponent(fieldId)}/uploadAttachment`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AT_PAT}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
        body,
      }
    );

    const text = await atRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!atRes.ok) {
      console.error(`Upload failed ${atRes.status} for field ${fieldId}:`, text);
    }
    return res.status(atRes.status).json(data);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: err.message });
  }
};
