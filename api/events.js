const ALLOWED = new Set(['quiz_started', 'quiz_resumed', 'quiz_completed', 'submit_failed', 'admin_load_failed', 'settings_failed']);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { tenantSlug, event, detail } = req.body || {};
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantSlug || '') || !ALLOWED.has(event)) return res.status(400).json({ ok: false });
  const safeDetail = typeof detail === 'string' ? detail.slice(0, 120) : null;
  console.info(JSON.stringify({ type: 'product_event', tenantSlug, event, detail: safeDetail, at: new Date().toISOString() }));
  return res.status(202).json({ ok: true });
};
