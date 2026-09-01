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
    .select('id,schedule')
    .eq('slug', tenantSlug)
    .single();
  if (tenantError || !tenant) {
    res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    return;
  }
  if (tenant.schedule?._disabled === true) {
    res.status(403).json({ error: 'TENANT_DISABLED' });
    return;
  }

  // A client may retry after the server saved the result but the response was
  // interrupted. Treat the stable result id as an idempotency key so that a
  // retry succeeds instead of creating an error loop or a duplicate booking.
  const { data: existing, error: existingError } = await supabase
    .from('results')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('id', row.id)
    .maybeSingle();
  if (existingError) return res.status(500).json({ error: existingError.message });
  if (existing) return res.status(200).json({ row: existing, duplicate: true });

  if (typeof row.fullName !== 'string' || !row.fullName.trim() || typeof row.instrument !== 'string' || !row.instrument.trim() || (!row.studentPhone && !row.email) || row.privacyConsent !== true) {
    return res.status(400).json({ error: 'INVALID_STUDENT_DETAILS' });
  }
  // Temporary rollout compatibility: an already-open pre-update Dimona form may
  // still submit the former payload without answers. New clients never create it.
  const legacyOpenForm = tenantSlug === 'dimona' && row.guitar === true && row.instrument === 'גיטרה' && row.diagnostic == null && row.level == null && !row.slot;
  const diagnosticValid = Number.isInteger(Number(row.diagnostic)) && Number(row.diagnostic) >= 1 && Number(row.diagnostic) <= 7;
  const levelValid = Number.isInteger(Number(row.level)) && Number(row.level) >= 1 && Number(row.level) <= 7;
  const waitlistValid = row.waitlist === true && row.level == null && !row.slot;
  if (!legacyOpenForm && (!diagnosticValid || (!levelValid && !waitlistValid))) {
    return res.status(400).json({ error: 'INVALID_LEVEL' });
  }
  const levelSlots = tenant.schedule?.[String(row.level)] || [];
  const savesLevelOnly = !row.slot && levelSlots.length === 0;
  if (legacyOpenForm || savesLevelOnly) {
    const { data, error } = await supabase
      .from('results')
      .insert({ id: row.id, status: 'פעיל', data: row, tenant_id: tenant.id })
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ row: data });
    return;
  }

  if (!row.slot) {
    res.status(400).json({ error: 'SLOT_REQUIRED' });
    return;
  }
  if (!levelSlots.some((slot) => slot[0] === row.slot)) return res.status(400).json({ error: 'SLOT_LEVEL_MISMATCH' });

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
