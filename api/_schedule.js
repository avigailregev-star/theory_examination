function parseScheduleText(text) {
  const schedule = {};
  const ids = new Set();
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error('יש להזין לפחות מועד אחד');
  lines.forEach((line, index) => {
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 4) throw new Error(`שורה ${index + 1}: יש להזין רמה, יום, שעה ושם מורה`);
    const [level, day, time, teacher, note] = parts;
    if (!/^[1-4]$/.test(level) || !day || !time || !teacher) throw new Error(`שורה ${index + 1}: הפרטים אינם תקינים`);
    const base = `${level}-${day}-${time}`.toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g, '-');
    let id = base, suffix = 2;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    (schedule[level] ||= []).push(note ? [id, day, time, teacher, note] : [id, day, time, teacher]);
  });
  return schedule;
}

module.exports = { parseScheduleText };
