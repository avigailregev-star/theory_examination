const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validTenantSlug(slug) {
  return typeof slug === 'string' && TENANT_SLUG.test(slug);
}

async function findTenant(supabase, slug, columns) {
  if (!validTenantSlug(slug)) return { data: null, error: { message: 'TENANT_NOT_FOUND' } };
  return supabase.from('tenants').select(columns).eq('slug', slug).maybeSingle();
}

function scheduleSlot(schedule, level, slotId) {
  const slots = schedule?.[String(level)];
  if (!Array.isArray(slots)) return null;
  return slots.find((slot) => Array.isArray(slot) && String(slot[0]) === String(slotId)) || null;
}

module.exports = { validTenantSlug, findTenant, scheduleSlot };
