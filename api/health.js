const { getServiceClient } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false });
  const started = Date.now();
  try {
    const { error } = await getServiceClient().from('tenants').select('id', { head: true, count: 'exact' }).limit(1);
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, database: 'available', responseMs: Date.now() - started });
  } catch (error) {
    console.error(JSON.stringify({ event: 'health_check_failed', message: error.message }));
    return res.status(503).json({ ok: false, database: 'unavailable' });
  }
};
