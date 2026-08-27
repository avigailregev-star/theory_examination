const { getServiceClient } = require('./_supabase');
const { parseScheduleText } = require('./_schedule');
const attempts = new Map();
function attemptKey(req, slug) { return `${req.headers['x-forwarded-for'] || 'unknown'}:${slug || ''}`; }
function isBlocked(key) { const item = attempts.get(key); return Boolean(item && item.until > Date.now() && item.count >= 10); }
function recordFailure(key) { const item = attempts.get(key); attempts.set(key, item && item.until > Date.now() ? { ...item, count: item.count + 1 } : { count: 1, until: Date.now() + 60000 }); }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { tenantSlug, username, password, action, id, name, logo, scheduleText, student, slot } = req.body || {};
  const key = attemptKey(req, tenantSlug);
  if (isBlocked(key)) return res.status(429).json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד דקה' });
  const supabase = getServiceClient();
  const { data: tenant } = await supabase.from('tenants').select('id,name,logo,schedule').eq('slug', tenantSlug).single();
  if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
  if (tenant.schedule?._disabled === true) return res.status(403).json({ error: 'החשבון מושבת. יש לפנות למנהלת המערכת.' });
  const [{ data: auth }, { data: passwordOk, error: verifyError }] = await Promise.all([
    supabase.from('tenant_auth').select('admin_email').eq('tenant_id', tenant.id).single(),
    supabase.rpc('verify_tenant_password', { p_tenant_id: tenant.id, p_password: password }),
  ]);
  const usernameOk = !auth?.admin_email || String(auth.admin_email).toLowerCase() === String(username || '').trim().toLowerCase();
  if (verifyError || !passwordOk || !usernameOk) { recordFailure(key); return res.status(401).json({ error: 'שם המשתמש או הסיסמה שגויים' }); }
  attempts.delete(key);
  if (action === 'list') {
    const [{ data: results, error: e1 }, { data: slots, error: e2 }] = await Promise.all([
      supabase.from('results').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
      supabase.from('lesson_slots').select('*').eq('tenant_id', tenant.id),
    ]);
    if (e1 || e2) return res.status(500).json({ error: (e1 || e2).message });
    return res.status(200).json({ tenant, results, slots });
  }
  if (action === 'settings') {
    let schedule;
    try { schedule = parseScheduleText(scheduleText); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (typeof name !== 'string' || name.trim().length < 2 || typeof logo !== 'string') return res.status(400).json({ error: 'יש להזין שם קונסרבטוריון תקין' });
    let savedLogo = logo.trim();
    if (savedLogo.startsWith('data:')) {
      const match = savedLogo.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return res.status(400).json({ error: 'יש לבחור קובץ תמונה מסוג PNG, JPG או WEBP' });
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: 'הלוגו חייב להיות קטן מ־1.5MB' });
      const bucket = 'tenant-logos';
      const { error: bucketError } = await supabase.storage.createBucket(bucket, { public: true, fileSizeLimit: 1572864, allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'] });
      if (bucketError && !/already exists|duplicate/i.test(bucketError.message)) return res.status(500).json({ error: 'לא הצלחנו להכין את אחסון הלוגו' });
      const { error: uploadError } = await supabase.storage.from(bucket).upload(`${tenant.id}/logo`, bytes, { contentType: match[1], upsert: true, cacheControl: '3600' });
      if (uploadError) return res.status(500).json({ error: 'העלאת הלוגו נכשלה: ' + uploadError.message });
      savedLogo = supabase.storage.from(bucket).getPublicUrl(`${tenant.id}/logo`).data.publicUrl + '?v=' + Date.now();
    }
    const { error } = await supabase.rpc('update_tenant_settings', { p_tenant_id: tenant.id, p_name: name, p_logo: savedLogo, p_schedule: schedule });
    if (error) return res.status(400).json({ error: error.message.includes('OCCUPIED_SLOT_REMOVAL') ? 'לא ניתן להסיר קבוצה שכבר משובצים אליה תלמידים' : error.message.includes('CAPACITY_BELOW_BOOKED') ? 'לא ניתן לקבוע מגבלה נמוכה ממספר התלמידים שכבר שובצו' : error.message });
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
  if (action === 'restore') {
    const { data: row, error: findError } = await supabase.from('results').select('lesson_slot_id,status,data').eq('id', id).eq('tenant_id', tenant.id).single();
    if (findError || !row) return res.status(404).json({ error: 'התוצאה לא נמצאה' });
    let restoredSlot = row.lesson_slot_id;
    if (restoredSlot) {
      const { data: target } = await supabase.from('lesson_slots').select('booked_count,capacity').eq('tenant_id', tenant.id).eq('id', restoredSlot).single();
      if (!target || target.booked_count >= target.capacity) restoredSlot = null;
      else await supabase.from('lesson_slots').update({ booked_count: target.booked_count + 1 }).eq('tenant_id', tenant.id).eq('id', restoredSlot);
    }
    const data = { ...(row.data || {}), status: 'פעיל', slot: restoredSlot };
    const { error } = await supabase.from('results').update({ status: 'פעיל', lesson_slot_id: restoredSlot, data }).eq('id', id).eq('tenant_id', tenant.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }
  if (action === 'move' || action === 'unassign') {
    const destination = action === 'unassign' ? null : slot;
    const { data: row, error: findError } = await supabase.from('results').select('lesson_slot_id,status,data').eq('id', id).eq('tenant_id', tenant.id).single();
    if (findError || !row || row.status === 'נמחק') return res.status(404).json({ error: 'התוצאה לא נמצאה' });
    if (destination && destination !== row.lesson_slot_id) {
      const { data: target } = await supabase.from('lesson_slots').select('booked_count,capacity').eq('tenant_id', tenant.id).eq('id', destination).single();
      if (!target) return res.status(400).json({ error: 'המועד שנבחר אינו קיים' });
      if (target.booked_count >= target.capacity) return res.status(409).json({ error: 'הקבוצה שנבחרה מלאה' });
      await supabase.from('lesson_slots').update({ booked_count: target.booked_count + 1 }).eq('tenant_id', tenant.id).eq('id', destination);
    }
    if (row.lesson_slot_id && row.lesson_slot_id !== destination) await supabase.rpc('release_slot', { p_tenant_id: tenant.id, p_slot: row.lesson_slot_id });
    const data = { ...(row.data || {}), slot: destination };
    const { error } = await supabase.from('results').update({ lesson_slot_id: destination, data }).eq('id', id).eq('tenant_id', tenant.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }
  if (action === 'update-student') {
    const { data: existing, error: findError } = await supabase.from('results').select('data').eq('id', id).eq('tenant_id', tenant.id).single();
    if (findError || !existing) return res.status(404).json({ error: 'התוצאה לא נמצאה' });
    const allowed = ['fullName', 'age', 'instrument', 'studentPhone', 'email'];
    const next = { ...(existing.data || {}) };
    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(student || {}, field)) next[field] = String(student[field] || '').trim().slice(0, 200);
    }
    if (!next.fullName || !next.instrument || (!next.studentPhone && !next.email)) return res.status(400).json({ error: 'יש להשאיר שם, כלי נגינה וטלפון או דוא״ל' });
    const { error } = await supabase.from('results').update({ data: next }).eq('id', id).eq('tenant_id', tenant.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: 'פעולה לא מוכרת' });
};
