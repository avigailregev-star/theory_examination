const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'Dimona-Theory-Placement-Standalone.html'), 'utf8');
const qStart = html.indexOf('const QUESTIONS=') + 'const QUESTIONS='.length;
const qEnd = html.indexOf('],ABC=', qStart) + 1;
const questions = JSON.parse(html.slice(qStart, qEnd));
const abcStart = html.indexOf('ABC=', qEnd) + 4;
const abcEnd = html.indexOf(',SCHEDULE=', abcStart);
const abc = JSON.parse(html.slice(abcStart, abcEnd));

assert.equal(new Set(questions.map(q => q.id)).size, questions.length, 'question ids must be unique');
assert.equal(questions.filter(q => q.tier === 7).length, 2, 'exactly two tier-seven questions are required');
for (const q of questions) {
  assert.ok(q.options.includes(q.answer), `${q.id}: answer must be one of the options`);
  assert.ok(q.tier >= 1 && q.tier <= 7, `${q.id}: tier must be 1-7`);
  if (q.figure !== 'none') assert.ok(abc[q.figure], `${q.id}: missing notation ${q.figure}`);
  if (q.optionFigures) for (const option of Object.keys(q.optionFigures)) assert.ok(q.options.includes(option), `${q.id}: orphan option figure`);
}
assert.match(html, /Math\.min\(7,diag\)/, 'diagnostic must be able to reach tier seven');
assert.doesNotMatch(html, /dimona-pending-result/, 'offline storage must not be shared across tenants');
assert.match(html, /privacyConsent/, 'privacy consent is required');
assert.doesNotMatch(html, /גיל \*/, 'age must not be mandatory');
assert.doesNotMatch(html, /לתלמיד מתחת לגיל 18/, 'there must be no age-based restriction');
assert.doesNotMatch(html, /פעמות גדולות/, 'deprecated wording must not return');
assert.doesNotMatch(html, /diag===1\?1:diag<=3/, 'legacy four-level placement mapping must not return');
assert.doesNotMatch(html, /professionalCompass|level-pills|admin-framework/, 'removed professional-compass panel code must not return');

for (const [i, script] of [...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean).entries()) {
  new vm.Script(script, { filename: `inline-${i}.js` });
}

const { parseScheduleText } = require(path.join(root, 'api', '_schedule'));
for (let level = 1; level <= 7; level++) assert.ok(parseScheduleText(`${level}, יום ב׳, 15:00–15:45, מורה`)[level]);
assert.throws(() => parseScheduleText('8, יום ב׳, 15:00–15:45, מורה'));

const submitSource = fs.readFileSync(path.join(root, 'api', 'submit.js'), 'utf8');
assert.match(submitSource, /SLOT_LEVEL_MISMATCH/, 'the server must reject a slot from a different level');
assert.match(submitSource, /legacyOpenForm/, 'the staged rollout must preserve already-open legacy submissions');
assert.match(submitSource, /if \(!legacyOpenForm && \(!diagnosticValid \|\| \(!levelValid && !waitlistValid\)\)\)/, 'new submissions must include a valid assessment level');
assert.match(html, /state\.stage='quiz';saveProgress\(\);trackEvent\('quiz_started'\);render\(\)/, 'the intake form must continue into the standard questionnaire');
assert.match(submitSource, /duplicate: true/, 'result submission retries must be idempotent');
assert.doesNotMatch(html, /state\.slot=b\.dataset\.id;choice\(\)/, 'slot selection must not reload the entire choice screen');
assert.match(html, /setInterval\(refreshLiveData,5000\)/, 'admin data must refresh in the background');
assert.match(html, /overallOccupancyPercent/, 'admin must show one overall institution occupancy percentage');
assert.match(html, /totals\.booked\/totals\.capacity\*100/, 'overall occupancy must use total booked places over total capacity');
assert.doesNotMatch(html, /n\+'\/'\+capacity\+' · '\+percent\+'%'/, 'individual lesson rows must not show percentages');
assert.match(html, /document\.hidden\|\|editingStudentId/, 'live refresh must pause while the page is hidden or a student is being edited');
assert.match(html, /const slotCell=/, 'the admin schedule column must use the compact renderer');
assert.match(html, /slot-compact/, 'compact schedule cell styles must be present');
assert.match(html, /table-layout:fixed/, 'the admin student table must fit the available width');
assert.match(html, /@media\(max-width:900px\)/, 'narrow screens must use the card layout');
assert.match(html, /data-label="מועד"/, 'responsive student cells must include labels');
assert.doesNotMatch(html, /\.museum-admin table\{min-width:900px\}/, 'the admin table must not force horizontal scrolling');
const adminSource = fs.readFileSync(path.join(root, 'api', 'admin.js'), 'utf8');
assert.match(adminSource, /lesson_slot_id: null/, 'removing a lesson must clear affected student assignments');
assert.match(adminSource, /\.from\('lesson_slots'\)[\s\S]*?\.delete\(\)/, 'removed lessons must be deleted from storage');
const superadminHtml = fs.readFileSync(path.join(root, 'superadmin.html'), 'utf8');
assert.match(superadminHtml, /id="loginForm"/, 'superadmin login must support form submission and the Enter key');
assert.match(superadminHtml, /id="createForm"/, 'tenant creation must support form submission and the Enter key');
for (const [i, script] of [...superadminHtml.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean).entries()) {
  new vm.Script(script, { filename: `superadmin-inline-${i}.js` });
}
const superadminSource = fs.readFileSync(path.join(root, 'api', 'superadmin.js'), 'utf8');
assert.match(superadminSource, /status\(429\)/, 'superadmin login must throttle repeated password attempts');
JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

console.log(`Prelaunch audit passed: ${questions.length} questions, levels 1-7, scripts valid.`);
