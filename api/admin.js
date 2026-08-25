const { getServiceClient } = require('./_supabase');

const attempts = new Map();

function isRateLimited(key) {
  const entry = attempts.get(key) || { count: 0, resetAt: 0 };
  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + 60000;
  }
  return entry.count > 10;
}

function recordFailedAttempt(key) {
  const entry = attempts.get(key) || { count: 0, resetAt: Date.now() + 60000 };
  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + 60000;
  }
  entry.count++;
  attempts.set(key, entry);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { tenantSlug, password, action, id } = req.body || {};
  const key = (req.headers['x-forwarded-for'] || 'unknown') + ':' + tenantSlug;

  if (isRateLimited(key)) {
    res.status(429).json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד דקה' });
    return;
  }

  const supabase = getServiceClient();

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single();
  if (tenantError || !tenant) {
    res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    return;
  }

  const { data: passwordOk, error: verifyError } = await supabase.rpc('verify_tenant_password', {
    p_tenant_id: tenant.id,
    p_password: password,
  });
  if (verifyError || !passwordOk) {
    recordFailedAttempt(key);
    res.status(401).json({ error: 'סיסמה שגויה' });
    return;
  }

  if (action === 'list') {
    const { data: results, error: e1 } = await supabase
      .from('results')
      .select('*')
      .eq('tenant_id', tenant.id)
      .neq('status', 'נמחק');
    const { data: slots, error: e2 } = await supabase
      .from('lesson_slots')
      .select('*')
      .eq('tenant_id', tenant.id);
    if (e1 || e2) {
      res.status(500).json({ error: (e1 || e2).message });
      return;
    }
    res.status(200).json({ results, slots });
    return;
  }

  if (action === 'delete') {
    const { data: row, error: e1 } = await supabase
      .from('results')
      .select('lesson_slot_id, status')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .single();
    if (e1) {
      res.status(500).json({ error: e1.message });
      return;
    }
    if (row.status === 'נמחק') {
      res.status(200).json({ ok: true });
      return;
    }
    await supabase
      .from('results')
      .update({ status: 'נמחק' })
      .eq('id', id)
      .eq('tenant_id', tenant.id);
    if (row.lesson_slot_id) {
      await supabase.rpc('release_slot', { p_tenant_id: tenant.id, p_slot: row.lesson_slot_id });
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'פעולה לא מוכרת' });
};
