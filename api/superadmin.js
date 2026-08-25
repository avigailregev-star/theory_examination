const { getServiceClient } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { password, action, slug, name, adminPassword, schedule } = req.body || {};
  if (password !== process.env.SUPERADMIN_PASSWORD) {
    res.status(401).json({ error: 'סיסמה שגויה' });
    return;
  }

  const supabase = getServiceClient();

  if (action === 'list') {
    const { data, error } = await supabase.from('tenants').select('id, slug, name');
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ tenants: data });
    return;
  }

  if (action === 'create') {
    if (!slug || !name || !adminPassword || !schedule) {
      res.status(400).json({ error: 'BAD_REQUEST' });
      return;
    }
    let parsedSchedule;
    try {
      parsedSchedule = JSON.parse(schedule);
    } catch {
      res.status(400).json({ error: 'מערכת השעות אינה JSON תקין' });
      return;
    }

    const { data: tenant, error: e1 } = await supabase
      .from('tenants')
      .insert({ slug, name, schedule: parsedSchedule })
      .select()
      .single();
    if (e1) {
      res.status(500).json({ error: e1.message });
      return;
    }

    const { data: hash, error: hashError } = await supabase.rpc('hash_password', {
      p_password: adminPassword,
    });
    if (hashError) {
      res.status(500).json({ error: hashError.message });
      return;
    }

    const { error: e2 } = await supabase
      .from('tenant_auth')
      .insert({ tenant_id: tenant.id, admin_password_hash: hash });
    if (e2) {
      res.status(500).json({ error: e2.message });
      return;
    }

    const slots = Object.values(parsedSchedule)
      .flat()
      .map((s) => ({ id: s[0], tenant_id: tenant.id, capacity: 8 }));
    const { error: e3 } = await supabase.from('lesson_slots').insert(slots);
    if (e3) {
      res.status(500).json({ error: e3.message });
      return;
    }

    res.status(200).json({ ok: true, tenant });
    return;
  }

  res.status(400).json({ error: 'פעולה לא מוכרת' });
};
