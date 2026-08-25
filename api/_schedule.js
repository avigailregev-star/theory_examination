function parseScheduleText(text) {
  const schedule = {};
  const ids = new Set();
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('יש להזין לפחות מועד אחד');
  lines.forEach((line, index) => {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 4) throw new Error(`שורה ${index + 1}: יש להזין רמה, יום, שעה ושם מורה`);
    const [level, day, time, teacher, fifth, sixth] = parts;
    if (!/^[1-4]$/.test(level) || !day || !time || !teacher) throw new Error(`שורה ${index + 1}: הפרטים אינם תקינים`);
    const base = `${level}-${day}-${time}`.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, '-');
    let id = base, suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    const hasCapacity = /^\d+$/.test(fifth || '');
    const capacity = hasCapacity ? Number(fifth) : 8;
    const note = hasCapacity ? sixth : fifth;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) throw new Error(`שורה ${index + 1}: המגבלה חייבת להיות מספר בין 1 ל־500`);
    (schedule[level] ||= []).push([id, day, time, teacher, note || '', capacity]);
  });
  return schedule;
}

module.exports = { parseScheduleText };
