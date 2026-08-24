const { getServiceClient } = require('./_supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const row = req.body;
  if (!row || !row.id) {
    res.status(400).json({ error: 'BAD_REQUEST' });
    return;
  }
  const supabase = getServiceClient();

  if (row.guitar) {
    const { data, error } = await supabase
      .from('results')
      .insert({ id: row.id, status: 'פעיל', guitar: true, data: row })
      .select()
      .single();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ row: data });
    return;
  }

  const { data, error } = await supabase.rpc('book_slot', { p_slot: row.slot, p_row: row });
  if (error) {
    if (error.message.includes('SLOT_FULL')) {
      const { data: slots, error: slotsError } = await supabase.from('lesson_slots').select('id, booked_count, capacity');
      res.status(409).json({ error: 'SLOT_FULL', slots: slotsError ? [] : slots });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ row: data });
};
