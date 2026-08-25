const { getServiceClient } = require('./_supabase');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, slug, email, temporaryPassword } = req.body || {};
  if (!process.env.SUPERADMIN_PASSWORD || password !== process.env.SUPERADMIN_PASSWORD) return res.status(401).json({ error: 'סיסמה שגויה' });
  const supabase = getServiceClient();
  if (action === 'list') {
    const { data, error } = await supabase.from('tenants').select('id,slug,name,schedule').order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tenants: data.map((t) => ({ ...t, configured: Object.keys(t.schedule || {}).length > 0 })) });
  }
  if (action === 'create') {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || (temporaryPassword || '').length < 8) return res.status(400).json({ error: 'יש להזין מזהה באנגלית, דוא״ל תקין וסיסמה זמנית בת 8 תווים לפחות' });
    const { data, error } = await supabase.rpc('provision_tenant', { p_slug: slug, p_email: email, p_password: temporaryPassword });
    if (error) return res.status(400).json({ error: error.message });
    const proto = req.headers['x-forwarded-proto'] || 'https';
    return res.status(200).json({ tenant: data, inviteUrl: `${proto}://${req.headers.host}/theory-${slug}/admin` });
  }
  return res.status(400).json({ error: 'פעולה לא מוכרת' });
};
