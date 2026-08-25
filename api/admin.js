const { getServiceClient } = require('./_supabase');
const { parseScheduleText } = require('./_schedule');
const attempts = new Map();
function attemptKey(req, slug) { return `${req.headers['x-forwarded-for'] || 'unknown'}:${slug || ''}`; }
function isBlocked(key) { const item = attempts.get(key); return Boolean(item && item.until > Date.now() && item.count >= 10); }
function recordFailure(key) { const item = attempts.get(key); attempts.set(key, item && item.until > Date.now() ? { ...item, count: item.count + 1 } : { count: 1, until: Date.now() + 60000 }); }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { tenantSlug, password, action, id, name, logo, scheduleText } = req.body || {};
  const key = attemptKey(req, tenantSlug);
  if (isBlocked(key)) return res.status(429).json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד דקה' });
  const supabase = getServiceClient();
  const { data: tenant } = await supabase.from('tenants').select('id,name,logo,schedule').eq('slug', tenantSlug).single();
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
  const { data: passwordOk, error: verifyError } = await supabase.rpc('verify_tenant_password', { p_tenant_id: tenant.id, p_password: password });
  if (verifyError || !passwordOk) { recordFailure(key); return res.status(401).json({ error: 'סיסמה שגויה' }); }
  attempts.delete(key);
  if (action === 'list') {
    const [{ data: results, error: e1 }, { data: slots, error: e2 }] = await Promise.all([
      supabase.from('results').select('*').eq('tenant_id', tenant.id).neq('status', 'נמחק'),
      supabase.from('lesson_slots').select('*').eq('tenant_id', tenant.id),
    ]);
    if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });
    return res.status(200).json({ tenant, results, slots });
  }
  if (action === 'settings') {
    let schedule;
    try { schedule = parseScheduleText(scheduleText); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (typeof name !== 'string' || name.trim().length < 2 || typeof logo !== 'string') return res.status(400).json({ error: 'יש להזין שם קונסרבטוריון תקין' });
    const { error } = await supabase.rpc('update_tenant_settings', { p_tenant_id: tenant.id, p_name: name, p_logo: logo, p_schedule: schedule });
    if (error) return res.status(400).json({ error: error.message.includes('OCCUPIED_SLOT_REMOVAL') ? 'לא ניתן להסיר קבוצה שכבר משובצים אליה תלמידים' : error.message });
    return res.status(200).json({ ok: true });
  }
  if (action === 'delete') {
    const { data: row, error: e1 } = await supabase.from('results').select('lesson_slot_id,status').eq('id', id).eq('tenant_id', tenant.id).single();
    if (e1) return res.status(404).json({ error: 'התוצאה לא נמצאה' });
    if (row.status === 'נמחק') return res.status(200).json({ ok: true });
    const { error: e2 } = await supabase.from('results').update({ status: 'נמחק' }).eq('id', id).eq('tenant_id', tenant.id);
    if (e2) return res.status(500).json({ error: e2.message });
    if (row.lesson_slot_id) await supabase.rpc('release_slot', { p_tenant_id: tenant.id, p_slot: row.lesson_slot_id });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'פעולה לא מוכרת' });
};
