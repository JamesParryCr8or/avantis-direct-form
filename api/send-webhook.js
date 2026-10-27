module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({ error: 'Webhook submission has been retired. Use the verified direct GHL API submission.' });
};
