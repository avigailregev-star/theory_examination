const { getServiceClient } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { tenantSlug, ...row } = req.body || {};
  if (!tenantSlug || !row.id) {
    res.status(400).json({ error: 'BAD_REQUEST' });
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

  if (row.guitar) {
    const { data, error } = await supabase
      .from('results')
      .insert({ id: row.id, status: 'פעיל', guitar: true, data: row, tenant_id: tenant.id })
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ row: data });
    return;
  }

  const { data, error } = await supabase.rpc('book_slot', {
    p_tenant_id: tenant.id,
    p_slot: row.slot,
    p_row: row,
  });
  if (error) {
    if (error.message.includes('SLOT_FULL')) {
      const { data: slots, error: slotsError } = await supabase
        .from('lesson_slots')
        .select('id, booked_count, capacity')
        .eq('tenant_id', tenant.id);
      res.status(409).json({ error: 'SLOT_FULL', slots: slotsError ? [] : slots });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ row: data });
};
