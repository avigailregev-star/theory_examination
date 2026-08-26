const { getServiceClient } = require('./_supabase');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { password, action, slug, email, temporaryPassword } = req.body || {};
  if (!process.env.SUPERADMIN_PASSWORD || password !== process.env.SUPERADMIN_PASSWORD) return res.status(401).json({ error: 'סיסמה שגויה' });
  const supabase = getServiceClient();
  if (action === 'list') {
    const [tenantQuery, resultQuery, slotQuery] = await Promise.all([
      supabase.from('tenants').select('id,slug,name,schedule').order('name'),
      supabase.from('results').select('tenant_id,status'),
      supabase.from('lesson_slots').select('tenant_id,booked_count,capacity'),
    ]);
    const error = tenantQuery.error || resultQuery.error || slotQuery.error;
    if (error) return res.status(500).json({ error: error.message });
    const activeByTenant = new Map();
    for (const result of resultQuery.data || []) {
      if (result.status !== 'נמחק') activeByTenant.set(result.tenant_id, (activeByTenant.get(result.tenant_id) || 0) + 1);
    }
    const occupancyByTenant = new Map();
    for (const slot of slotQuery.data || []) {
      const occupancy = occupancyByTenant.get(slot.tenant_id) || { booked: 0, capacity: 0 };
      occupancy.booked += Number(slot.booked_count) || 0;
      occupancy.capacity += Number(slot.capacity) || 0;
      occupancyByTenant.set(slot.tenant_id, occupancy);
    }
    const tenants = tenantQuery.data.map((tenant) => ({
      ...tenant,
      configured: Object.keys(tenant.schedule || {}).length > 0,
      activeStudents: activeByTenant.get(tenant.id) || 0,
      occupancy: occupancyByTenant.get(tenant.id) || { booked: 0, capacity: 0 },
    }));
    return res.status(200).json({
      tenants,
      totals: {
        tenants: tenants.length,
        configured: tenants.filter((tenant) => tenant.configured).length,
        activeStudents: tenants.reduce((sum, tenant) => sum + tenant.activeStudents, 0),
      },
    });
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
