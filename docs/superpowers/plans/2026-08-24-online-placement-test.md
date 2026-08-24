# מבחן התאמה אונליין — תוכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להפוך את `Dimona-Theory-Placement-Standalone.html` משירות שמבוסס localStorage
לשירות אונליין עם כתובת אינטרנט וחשבון Supabase חדש ונפרד לשמירת תוצאות, תוך שמירה
מלאה על לוגיקת המבחן, השאלות והאבחון כפי שהם.

**Architecture:** Vercel מארח את קובץ ה-HTML הסטטי + שתי Vercel Serverless Functions
(`api/submit.js`, `api/admin.js`) שמחזיקות את מפתח ה-Service Role של Supabase.
הדפדפן משתמש ב-Supabase anon key (ציבורי, בטוח) רק כדי לקרוא תפוסת קבוצות; כל
כתיבה/קריאה של תוצאות תלמידים עוברת דרך שתי הפונקציות.

**Tech Stack:** Vercel (hosting + serverless functions, Node.js runtime), Supabase
(Postgres, RLS, RPC functions), `@supabase/supabase-js` (v2), ללא build step ל-frontend.

**Spec:** [docs/superpowers/specs/2026-08-24-online-placement-test-design.md](../specs/2026-08-24-online-placement-test-design.md)

## Global Constraints

- חשבון Supabase חדש ונפרד — לא זה שמשמש את kuns_pro.
- כתובת אינטרנט חינמית זמנית (`*.vercel.app`) — לא נדרש דומיין קבוע.
- סיסמת ניהול משותפת אחת — אין דרישה להתחברות אישית פר-משתמש.
- לוגיקת המבחן עצמה (בנק שאלות, אבחון 7 רמות, שיבוץ ל-4 רמות, גיטרה בנפרד) לא
  משתנה כלל — רק שכבת השמירה/הקריאה של נתונים.
- אין חבילת טסטים אוטומטית — אימות ידני בלבד, כפי שהוחלט בספק.

## הערה חשובה: שינוי קטן מהספק

הספק תיאר טבלת `results` עם עמודות נפרדות לכל שדה. בפועל, כדי לצמצם שינויים
בקוד הקיים (ולמנוע כפילות/פספוס שדות), טבלת `results` תשמור את כל פרטי
התלמיד/תוצאה כאובייקט `jsonb` יחיד בעמודה `data` (בדיוק כמו שהאובייקט כבר בנוי
היום ב-`finish()`/`finishGuitar()`), עם עמודות אמיתיות נוספות רק לשדות
שצריך לשאול/לסנן לפיהם: `id`, `status`, `lesson_slot_id`, `guitar`. זה שקול
מבחינת יכולת אך פשוט משמעותית ליישום.

בנוסף, פיצ'ר "ייבוא גיבוי" (`#restore`) שקיים היום מוסר: הוא מניח מסד נתונים
מקומי יחיד שמותר להחליף במלואו, וזה מסוכן מול מסד נתונים משותף שכמה מכשירים
כותבים אליו במקביל — ייבוא כזה עלול למחוק תוצאות שנשלחו מרגע הגיבוי. "הורדת
גיבוי" (קריאה בלבד) נשאר.

---

### Task 1: תשתית הפרויקט (package.json, .gitignore, משתני סביבה)

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: תלות `@supabase/supabase-js` זמינה ל-`api/*.js` בכל המשימות הבאות.

- [ ] **Step 1: יצירת package.json**

```json
{
  "name": "dimona-theory-placement",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  }
}
```

- [ ] **Step 2: יצירת .gitignore**

```
node_modules/
.env
.vercel
```

- [ ] **Step 3: יצירת .env.example (תיעוד בלבד, בלי ערכים אמיתיים)**

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_PASSWORD=
```

- [ ] **Step 4: התקנת התלות מקומית לבדיקה**

Run: `npm install`
Expected: נוצרת תיקיית `node_modules/` בלי שגיאות.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: add project scaffolding for Vercel + Supabase"
```

---

### Task 2: סכימת Supabase ופונקציות RPC אטומיות

**Files:**
- Create: `supabase/migration.sql`

**Interfaces:**
- Produces: טבלאות `lesson_slots`, `results`; פונקציות `book_slot(p_slot text, p_row jsonb)`
  ו-`release_slot(p_slot text)` שישמשו את `api/submit.js` ו-`api/admin.js` במשימות הבאות.

- [ ] **Step 1: יצירת חשבון Supabase חדש (ידני, על ידי בעלת הפרויקט)**

בדפדפן: כניסה ל-supabase.com → New Project → לוודא שזה **חשבון/ארגון נפרד**
מזה של kuns_pro. לשמור בצד: Project URL ו-שני מפתחות מתוך Settings → API:
`anon public key` ו-`service_role key` (הסודי).

- [ ] **Step 2: כתיבת supabase/migration.sql**

```sql
create extension if not exists pgcrypto;

create table lesson_slots (
  id text primary key,
  capacity int not null default 8,
  booked_count int not null default 0
);

create table results (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'פעיל',
  lesson_slot_id text references lesson_slots(id),
  guitar boolean not null default false,
  data jsonb not null
);

alter table lesson_slots enable row level security;
alter table results enable row level security;

create policy "public can read slot capacity"
  on lesson_slots for select
  using (true);

create or replace function book_slot(p_slot text, p_row jsonb)
returns results
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_booked int;
  v_result results;
begin
  select capacity, booked_count into v_capacity, v_booked
  from lesson_slots where id = p_slot
  for update;

  if v_capacity is null then
    raise exception 'SLOT_NOT_FOUND';
  end if;

  if v_booked >= v_capacity then
    raise exception 'SLOT_FULL';
  end if;

  insert into results (id, status, lesson_slot_id, guitar, data)
  values (p_row->>'id', 'פעיל', p_slot, false, p_row)
  returning * into v_result;

  update lesson_slots set booked_count = booked_count + 1 where id = p_slot;

  return v_result;
end;
$$;

create or replace function release_slot(p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update lesson_slots
  set booked_count = greatest(booked_count - 1, 0)
  where id = p_slot;
end;
$$;

insert into lesson_slots (id, capacity) values
  ('a-mon-1500', 8), ('a-mon-1600', 8), ('a-tue-1500', 8), ('a-tue-1600', 8), ('a-wed-1500', 8),
  ('b-mon-1500', 8), ('b-mon-1600', 8), ('b-tue-1915', 8), ('b-wed-1500', 8),
  ('c-wed-1600', 8), ('c-wed-1700', 8),
  ('d-wed-1415', 8);
```

מזהי המועדים (`a-mon-1500` וכו') מועתקים בדיוק מ-`SCHEDULE` הקיים בקובץ
ה-HTML (שורה 7) — כך שהתפוסה תתאים למועדים האמיתיים שכבר מוצגים לתלמידים.

- [ ] **Step 2: הרצת הסכימה (ידני, ב-Supabase SQL Editor)**

להדביק את כל תוכן `supabase/migration.sql` ל-SQL Editor בפרויקט Supabase החדש וללחוץ Run.
Expected: "Success. No rows returned" ואפשר לראות את הטבלאות `lesson_slots` (עם 12
שורות) ו-`results` (ריקה) תחת Table Editor.

- [ ] **Step 3: אימות ידני של המרוץ על תפוסה (ב-SQL Editor)**

```sql
update lesson_slots set capacity = 1, booked_count = 0 where id = 'd-wed-1415';
select book_slot('d-wed-1415', '{"id":"test-1","fullName":"בדיקה 1"}'::jsonb);
select book_slot('d-wed-1415', '{"id":"test-2","fullName":"בדיקה 2"}'::jsonb);
```

Expected: הקריאה הראשונה מחזירה שורה חדשה; השנייה נכשלת עם שגיאה `SLOT_FULL`.
לנקות אחרי הבדיקה:

```sql
delete from results where id in ('test-1','test-2');
update lesson_slots set capacity = 8, booked_count = 0 where id = 'd-wed-1415';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migration.sql
git commit -m "feat: add Supabase schema and atomic slot-booking RPC functions"
```

---

### Task 3: פונקציית שרת להגשת תוצאה (`api/submit.js`)

**Files:**
- Create: `api/_supabase.js`
- Create: `api/submit.js`

**Interfaces:**
- Consumes: `book_slot`, `release_slot`, טבלאות `lesson_slots`/`results` מ-Task 2.
- Produces: `POST /api/submit` — מקבל את אובייקט ה-`row` בדיוק כפי שהקוד הקיים כבר
  בונה אותו (`id`, `created`, `fullName`, `age`, `grade`, `instrument`, `years`,
  `teacher`, `studentPhone`, `parentPhone`, `email`, `diagnostic`, `level`, `total`,
  `scores`, `slot`, `status`, ואופציונלית `guitar:true`). מחזיר `200 {row}` בהצלחה,
  `409 {error:'SLOT_FULL', slots}` אם הקבוצה התמלאה, `500 {error}` בשגיאת שרת.

- [ ] **Step 1: יצירת api/_supabase.js**

```js
const { createClient } = require('@supabase/supabase-js');

function getServiceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

module.exports = { getServiceClient };
```

- [ ] **Step 2: יצירת api/submit.js**

```js
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
      const { data: slots } = await supabase.from('lesson_slots').select('id, booked_count, capacity');
      res.status(409).json({ error: 'SLOT_FULL', slots });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ row: data });
};
```

- [ ] **Step 3: בדיקה ידנית מקומית עם vercel dev**

Run: `npx vercel dev` (בפעם הראשונה יבקש להתחבר לחשבון Vercel — זה בסדר, זה
אותו חשבון שנחבר בהמשך). לוודא ש-`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY`
מוגדרים בקובץ `.env` מקומי (מועתקים מ-Task 2, לא מ-`.env.example`).

בטרמינל נפרד:
```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{"id":"manual-test-1","fullName":"בדיקה ידנית","slot":"d-wed-1415","level":4}'
```

Expected: JSON עם `row` שמכיל את הנתונים שנשלחו. הרצה שנייה עם אותו `slot`
שבע פעמים נוספות (סה"כ 8) אמורה להצליח, והתשיעית להחזיר `409` עם `error:"SLOT_FULL"`.
לנקות בסיום דרך Supabase SQL Editor (`delete from results where id like 'manual-test%'`
ו-`update lesson_slots set booked_count=0 where id='d-wed-1415'`).

- [ ] **Step 4: Commit**

```bash
git add api/_supabase.js api/submit.js
git commit -m "feat: add /api/submit serverless function with atomic capacity check"
```

---

### Task 4: פונקציית שרת לניהול (`api/admin.js`)

**Files:**
- Create: `api/admin.js`

**Interfaces:**
- Consumes: `getServiceClient` מ-Task 3; `release_slot` מ-Task 2.
- Produces: `POST /api/admin` עם גוף `{password, action, id?}`.
  `action:'list'` מחזיר `200 {results, slots}`. `action:'delete'` עם `id` מסמן
  `status='נמחק'` ומשחרר מקום בקבוצה, מחזיר `200 {ok:true}`. סיסמה שגויה → `401`.
  יותר מ-10 ניסיונות בדקה מאותה כתובת → `429`.

- [ ] **Step 1: יצירת api/admin.js**

```js
const { getServiceClient } = require('./_supabase');

const attempts = new Map();

function rateLimited(key) {
  const entry = attempts.get(key) || { count: 0, resetAt: 0 };
  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + 60000;
  }
  entry.count++;
  attempts.set(key, entry);
  return entry.count > 10;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { password, action, id } = req.body || {};
  const key = req.headers['x-forwarded-for'] || 'unknown';

  if (rateLimited(key)) {
    res.status(429).json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד דקה' });
    return;
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'סיסמה שגויה' });
    return;
  }

  const supabase = getServiceClient();

  if (action === 'list') {
    const { data: results, error: e1 } = await supabase
      .from('results')
      .select('*')
      .neq('status', 'נמחק');
    const { data: slots, error: e2 } = await supabase.from('lesson_slots').select('*');
    if (e1 || e2) {
      res.status(500).json({ error: (e1 || e2).message });
      return;
    }
    res.status(200).json({ results, slots });
    return;
  }

  if (action === 'delete') {
    const { data: row, error: e1 } = await supabase
      .from('results')
      .select('lesson_slot_id')
      .eq('id', id)
      .single();
    if (e1) {
      res.status(500).json({ error: e1.message });
      return;
    }
    await supabase.from('results').update({ status: 'נמחק' }).eq('id', id);
    if (row.lesson_slot_id) {
      await supabase.rpc('release_slot', { p_slot: row.lesson_slot_id });
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'פעולה לא מוכרת' });
};
```

הערה: מגבלת הקצב מבוססת זיכרון תהליך (`Map`), ולכן היא best-effort בלבד
בסביבת serverless (כל instance עם זיכרון נפרד) — מספיקה כהגנה בסיסית מול
ניחושים אוטומטיים, לא כהגנה הרמטית. תואם את מה שסוכם (סיסמה משותפת פשוטה
מספיקה כרגע).

- [ ] **Step 2: בדיקה ידנית עם vercel dev (ממשיך מ-Task 3)**

```bash
curl -X POST http://localhost:3000/api/admin \
  -H "Content-Type: application/json" \
  -d '{"password":"wrong","action":"list"}'
```
Expected: `401 {"error":"סיסמה שגויה"}`.

```bash
curl -X POST http://localhost:3000/api/admin \
  -H "Content-Type: application/json" \
  -d '{"password":"'"$ADMIN_PASSWORD"'","action":"list"}'
```
(או להציב את הסיסמה מ-`.env` המקומי ישירות). Expected: `200` עם `results`
ו-`slots`.

- [ ] **Step 3: Commit**

```bash
git add api/admin.js
git commit -m "feat: add /api/admin serverless function with password gate and rate limiting"
```

---

### Task 5: Frontend — שכבת נתונים (Supabase anon client, הגשה, ניסיון חוזר)

**Files:**
- Modify: `Dimona-Theory-Placement-Standalone.html:11` (הגדרת `db`/`saveDb` מוסרת)
- Modify: `Dimona-Theory-Placement-Standalone.html:19` (`used`+`choice` מוחלפים)
- Modify: `Dimona-Theory-Placement-Standalone.html:20` (`finish` מוחלף)
- Modify: `Dimona-Theory-Placement-Standalone.html:21` (`finishGuitar` מוחלף)
- Modify: `Dimona-Theory-Placement-Standalone.html:26` (הוספת `retryPending()`)
- Modify: `<head>` (הוספת סקריפט supabase-js)

**Interfaces:**
- Consumes: `POST /api/submit` מ-Task 3.
- Produces: `fetchSlotCounts()` (async, מחזיר `{[slotId]: bookedCount}`) — ישמש גם
  את Task 6.

- [ ] **Step 1: הוספת סקריפט supabase-js ל-head**

ב-`<head>`, אחרי תגית ה-`<title>` (שורה 1), להוסיף:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

- [ ] **Step 2: החלפת שורה 11 (הגדרת db/saveDb) ביצירת לקוח Supabase**

להחליף את:
```js
const db=()=>JSON.parse(localStorage.getItem('dimona-theory-results')||'[]');const saveDb=x=>localStorage.setItem('dimona-theory-results',JSON.stringify(x));
```

ב:
```js
const sb=supabase.createClient('__SUPABASE_URL__','__SUPABASE_ANON_KEY__');
async function fetchSlotCounts(){const{data,error}=await sb.from('lesson_slots').select('id,booked_count,capacity');if(error)return{};return Object.fromEntries(data.map(s=>[s.id,s.booked_count]))}
```

`__SUPABASE_URL__` ו-`__SUPABASE_ANON_KEY__` יוחלפו בערכים האמיתיים ב-Task 7
(שלב הפריסה) — ה-anon key מיועד לחשיפה ציבורית (מוגן ע"י RLS), בניגוד
ל-service role key שנשאר אך ורק במשתני הסביבה של Vercel.

- [ ] **Step 3: החלפת שורה 19 (`used`+`choice`)**

להחליף את:
```js
function used(id){return db().filter(r=>r.status!=='נמחק'&&r.slot===id).length}function choice(){const lvl=state.placement.level,slots=SCHEDULE[lvl];app.innerHTML='<div class="shell"><section class="card"><p class="eyebrow">האבחון הסתיים</p><h1>השיבוץ שלך: רמה '+LETTERS[lvl]+'</h1><p>בחרו מועד. בכל קבוצה עד 8 תלמידים.</p><div class="slots">'+slots.map(s=>{const n=used(s[0]);return '<button class="slot '+(state.slot===s[0]?'selected':'')+'" data-id="'+s[0]+'" '+(n>=8?'disabled':'')+'><strong>'+s[1]+' · '+s[2]+'</strong><br><span>'+(s[4]||'עם '+s[3])+'</span><br><small>'+(n>=8?'הקבוצה מלאה':'נותרו '+(8-n)+' מקומות')+'</small></button>'}).join('')+'</div><br><button id="confirm" '+(!state.slot?'disabled':'')+'>אישור המועד ושמירת השיבוץ</button></section></div>';document.querySelectorAll('.slot').forEach(b=>b.onclick=()=>{state.slot=b.dataset.id;choice()});$('#confirm').onclick=finish}
```

ב:
```js
async function choice(){const lvl=state.placement.level,slots=SCHEDULE[lvl];app.innerHTML='<div class="shell"><section class="card"><p>טוען מועדים…</p></section></div>';const counts=await fetchSlotCounts();app.innerHTML='<div class="shell"><section class="card"><p class="eyebrow">האבחון הסתיים</p><h1>השיבוץ שלך: רמה '+LETTERS[lvl]+'</h1><p>בחרו מועד. בכל קבוצה עד 8 תלמידים.</p><div class="slots">'+slots.map(s=>{const n=counts[s[0]]||0;return '<button class="slot '+(state.slot===s[0]?'selected':'')+'" data-id="'+s[0]+'" '+(n>=8?'disabled':'')+'><strong>'+s[1]+' · '+s[2]+'</strong><br><span>'+(s[4]||'עם '+s[3])+'</span><br><small>'+(n>=8?'הקבוצה מלאה':'נותרו '+(8-n)+' מקומות')+'</small></button>'}).join('')+'</div><br><button id="confirm" '+(!state.slot?'disabled':'')+'>אישור המועד ושמירת השיבוץ</button></section></div>';document.querySelectorAll('.slot').forEach(b=>b.onclick=()=>{state.slot=b.dataset.id;choice()});$('#confirm').onclick=finish}
```

- [ ] **Step 4: החלפת שורה 20 (`finish`)**

להחליף את:
```js
function finish(){if(used(state.slot)>=8){alert('הקבוצה התמלאה. יש לבחור מועד אחר.');choice();return}const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,diagnostic:state.placement.diagnostic,level:state.placement.level,total:state.placement.total,scores:state.placement.scores,slot:state.slot,status:'פעיל'};const rows=db();rows.push(row);saveDb(rows);const s=Object.values(SCHEDULE).flat().find(x=>x[0]===state.slot);result(row,s)}
```

ב:
```js
async function finish(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,diagnostic:state.placement.diagnostic,level:state.placement.level,total:state.placement.total,scores:state.placement.scores,slot:state.slot,status:'פעיל'};let res;try{res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)})}catch{localStorage.setItem('dimona-pending-result',JSON.stringify(row));alert('אין חיבור לאינטרנט כרגע. התוצאה נשמרה במכשיר ותישלח אוטומטית כשתפתחו את העמוד שוב עם חיבור תקין.');return}if(res.status===409){alert('הקבוצה התמלאה. יש לבחור מועד אחר.');state.slot=null;choice();return}if(!res.ok){localStorage.setItem('dimona-pending-result',JSON.stringify(row));alert('שגיאה בשמירת התוצאה. התוצאה נשמרה במכשיר, ננסה שוב בפתיחה הבאה.');return}const s=Object.values(SCHEDULE).flat().find(x=>x[0]===state.slot);result(row,s)}
```

- [ ] **Step 5: החלפת שורה 21 (`finishGuitar`)**

להחליף את:
```js
function finishGuitar(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,guitar:true,status:'פעיל'};const rows=db();rows.push(row);saveDb(rows);app.innerHTML='<div class="shell"><section class="card result"><div class="seal">♬</div><p class="eyebrow">הפרטים נשמרו</p><h1>מסלול התאוריה לגיטריסטים</h1><p>השיבוץ ייקבע לאחת משתי קבוצות יום ה׳: 15:00–15:45 או 16:00–16:45.</p><button onclick="location.reload()">מבחן נוסף</button></section></div>'}
```

ב:
```js
async function finishGuitar(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,guitar:true,status:'פעיל'};try{const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});if(!res.ok)throw 0}catch{localStorage.setItem('dimona-pending-result',JSON.stringify(row))}app.innerHTML='<div class="shell"><section class="card result"><div class="seal">♬</div><p class="eyebrow">הפרטים נשמרו</p><h1>מסלול התאוריה לגיטריסטים</h1><p>השיבוץ ייקבע לאחת משתי קבוצות יום ה׳: 15:00–15:45 או 16:00–16:45.</p><button onclick="location.reload()">מבחן נוסף</button></section></div>'}
```

- [ ] **Step 6: הוספת retryPending לפני render() בשורה 26**

להחליף את השורה האחרונה (26):
```js
function render(){state.stage==='quiz'?quiz():state.stage==='choice'?choice():intro()}window.addEventListener('hashchange',()=>location.hash==='#admin'?admin():intro());render();
```

ב:
```js
function render(){state.stage==='quiz'?quiz():state.stage==='choice'?choice():intro()}window.addEventListener('hashchange',()=>location.hash==='#admin'?admin():intro());async function retryPending(){const pending=localStorage.getItem('dimona-pending-result');if(!pending)return;if(!confirm('נמצאה תוצאת מבחן שלא נשלחה בעבר. לנסות לשלוח אותה עכשיו?'))return;try{const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:pending});if(res.ok){localStorage.removeItem('dimona-pending-result');alert('התוצאה נשלחה בהצלחה.')}else if(res.status===409){alert('הקבוצה שנבחרה בעבר כבר התמלאה. יש להיכנס למבחן מחדש ולבחור מועד אחר.');localStorage.removeItem('dimona-pending-result')}else{alert('עדיין יש בעיה בשליחה. ננסה שוב בפעם הבאה.')}}catch{alert('אין עדיין חיבור תקין לאינטרנט. ננסה שוב בפעם הבאה.')}}render();retryPending();
```

- [ ] **Step 7: בדיקה ידנית ב-vercel dev**

Run: `npx vercel dev`, לפתוח `http://localhost:3000` בדפדפן, להשלים מבחן מלא
עד למסך "השיבוץ נשמר". Expected: השורה מופיעה ב-Supabase Table Editor תחת
`results`, ו-`booked_count` של המועד שנבחר עלה ב-1 תחת `lesson_slots`.

- [ ] **Step 8: Commit**

```bash
git add Dimona-Theory-Placement-Standalone.html
git commit -m "feat: wire student quiz flow to /api/submit and Supabase-backed capacity"
```

---

### Task 6: Frontend — מסך ניהול מוגן בסיסמה

**Files:**
- Modify: `Dimona-Theory-Placement-Standalone.html:24` (`csv` הופך לפרמטר)
- Modify: `Dimona-Theory-Placement-Standalone.html:25` (`admin` נבנה מחדש מול API)

**Interfaces:**
- Consumes: `POST /api/admin` מ-Task 4.

- [ ] **Step 1: החלפת שורה 24 (`csv`) כך שתקבל rows כפרמטר**

להחליף את:
```js
function csv(){const rows=db().filter(r=>r.status!=='נמחק'),head=[...
```
(תחילת השורה בלבד — שאר השורה נשארת זהה) ב:
```js
function csv(rows){const head=[...
```
כלומר מסירים את `const rows=db().filter(r=>r.status!=='נמחק'),` ומשאירים
`head=[...` ואילך בדיוק כפי שהוא, כשה-`,` שבין `rows=...` ל-`head=` הופך
לתחילת ה-`const head=`.

- [ ] **Step 2: החלפת שורה 25 (`admin`) במלואה**

```js
async function admin(){const savedPass=sessionStorage.getItem('dimona-admin-pass');const pass=savedPass||prompt('סיסמת ניהול:');if(!pass){location.hash='';intro();return}app.innerHTML='<div class="shell"><section class="card"><p>טוען…</p></section></div>';const res=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'list'})});if(res.status===401){alert('סיסמה שגויה');sessionStorage.removeItem('dimona-admin-pass');location.hash='';intro();return}if(res.status===429){const b=await res.json();alert(b.error);location.hash='';intro();return}if(!res.ok){alert('שגיאה בטעינת הנתונים');location.hash='';intro();return}sessionStorage.setItem('dimona-admin-pass',pass);const body=await res.json();const rows=body.results.map(r=>({...r.data,id:r.id,status:r.status,slot:r.lesson_slot_id,guitar:r.guitar}));const slotCounts=Object.fromEntries(body.slots.map(s=>[s.id,s.booked_count]));app.innerHTML='<div class="shell"><section class="card"><p class="eyebrow">ניהול</p><h1>תוצאות ושיבוצים</h1><div class="admin-grid"><div class="metric"><strong>'+rows.length+'</strong>נבחנים פעילים</div><div class="metric"><strong>'+rows.filter(r=>r.level===1).length+'</strong>רמה א׳</div><div class="metric"><strong>'+rows.filter(r=>r.level===2).length+'</strong>רמה ב׳</div><div class="metric"><strong>'+rows.filter(r=>r.level>=3).length+'</strong>רמות ג׳–ד׳</div></div><h2>תפוסת קבוצות</h2><div class="bars">'+Object.values(SCHEDULE).flat().map(s=>{const n=slotCounts[s[0]]||0;return '<div class="bar-row"><span>'+s[1]+' '+s[2]+' · '+(s[4]||s[3])+'</span><div class="bar"><i class="'+(n>=8?'full':'')+'" style="width:'+(n/8*100)+'%"></i></div><strong>'+n+'/8</strong></div>'}).join('')+'</div><h2>תוצאות</h2><input id="search" class="search" placeholder="חיפוש לפי שם, כלי או טלפון"><div class="table-wrap"><table><thead><tr><th>תאריך</th><th>שם</th><th>כלי</th><th>רמה</th><th>מועד</th><th>טלפון</th><th>דוא״ל</th><th>ציון</th><th></th></tr></thead><tbody id="tbody"></tbody></table></div><br><div class="actions"><button id="csv">ייצוא ל־CSV</button><button class="secondary" id="backup">הורדת גיבוי</button><button class="secondary" onclick="location.hash=String();intro()">חזרה למבחן</button></div></section></div>';const draw=()=>{const q=$('#search').value.toLowerCase();$('#tbody').innerHTML=rows.filter(r=>JSON.stringify(r).toLowerCase().includes(q)).map(r=>{const s=Object.values(SCHEDULE).flat().find(x=>x[0]===r.slot);return '<tr><td>'+new Date(r.created).toLocaleDateString('he-IL')+'</td><td>'+esc(r.fullName)+'</td><td>'+esc(r.instrument)+'</td><td>'+(r.guitar?'גיטרה':LETTERS[r.level])+'</td><td>'+(s?esc(s[1]+' '+s[2]):'—')+'</td><td>'+esc(r.parentPhone||r.studentPhone)+'</td><td>'+esc(r.email)+'</td><td>'+esc(r.total??'—')+'</td><td><button class="danger del" data-id="'+r.id+'">מחיקה</button></td></tr>'}).join('');document.querySelectorAll('.del').forEach(b=>b.onclick=async()=>{if(!confirm('למחוק את התוצאה? המקום בקבוצה יתפנה.'))return;const dr=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'delete',id:b.dataset.id})});if(!dr.ok){alert('מחיקה נכשלה');return}admin()})};draw();$('#search').oninput=draw;$('#csv').onclick=()=>csv(rows);$('#backup').onclick=()=>download('גיבוי-שיבוצי-תאוריה.json',JSON.stringify(rows,null,2),'application/json')}
```

- [ ] **Step 3: בדיקה ידנית ב-vercel dev**

לפתוח `http://localhost:3000#admin`, להזין את `ADMIN_PASSWORD` מה-`.env`
המקומי. Expected: מסך הניהול נטען עם התוצאות שנוצרו ב-Task 5 (Step 7),
תפוסת הקבוצות תואמת, וכפתור "מחיקה" מסמן תוצאה כ-`נמחק` ומשחרר את המקום
בקבוצה (התפוסה יורדת ב-1 אחרי רענון).

- [ ] **Step 4: Commit**

```bash
git add Dimona-Theory-Placement-Standalone.html
git commit -m "feat: gate admin screen behind shared password and Supabase-backed data"
```

---

### Task 7: פריסה ל-Vercel ואימות מקצה לקצה

**Files:**
- Modify: `Dimona-Theory-Placement-Standalone.html` (הצבת ערכי Supabase אמיתיים)

**Interfaces:**
- Produces: כתובת אינטרנט חיה (`*.vercel.app`) שהתלמידים וההורים יכולים להשתמש בה.

- [ ] **Step 1: הצבת ה-anon key האמיתי בקוד (ידני)**

ב-`Dimona-Theory-Placement-Standalone.html`, במקום שנוסף ב-Task 5 Step 2,
להחליף `__SUPABASE_URL__` ב-Project URL האמיתי (למשל
`https://xxxxx.supabase.co`) ו-`__SUPABASE_ANON_KEY__` ב-anon public key
האמיתי (שניהם מותרים בפרסום פומבי — מוגנים ע"י ה-RLS מ-Task 2).

- [ ] **Step 2: יצירת פרויקט Vercel חדש (ידני, על ידי בעלת הפרויקט)**

בדפדפן: vercel.com → Add New Project → Import Git Repository → לבחור
`avigailregev-star/theory_examination`. להשאיר את הגדרות ברירת המחדל (אין
Build Command, אין Output Directory — זה פרויקט סטטי + serverless functions).

- [ ] **Step 3: הגדרת משתני סביבה ב-Vercel (ידני)**

ב-Project Settings → Environment Variables, להוסיף (לכל הסביבות: Production,
Preview, Development):
- `SUPABASE_URL` — Project URL מ-Supabase.
- `SUPABASE_SERVICE_ROLE_KEY` — ה-service role key הסודי מ-Supabase.
- `ADMIN_PASSWORD` — סיסמת הניהול המשותפת שנבחרה.

- [ ] **Step 4: Commit ו-Push**

```bash
git add Dimona-Theory-Placement-Standalone.html
git commit -m "chore: wire real Supabase project URL and anon key for production"
git push
```

- [ ] **Step 5: אימות מקצה לקצה בסביבת production**

Vercel יפרוס אוטומטית אחרי ה-push. לפתוח את כתובת ה-`*.vercel.app`
שהתקבלה, להשלים מבחן מלא עד "השיבוץ נשמר", ואז להיכנס ל-`/#admin` עם
הסיסמה ולוודא שהתוצאה מופיעה. לבדוק גם מבחן גיטרה (`finishGuitar`), ומחיקת
תוצאה מהמסך.

**זהו השלב הראשון שבו ניתן לבדוק גישה משני מכשירים/דפדפנים שונים** —
מומלץ לבדוק פעם אחת משני מכשירים בו-זמנית כדי לוודא שהתוצאות מסונכרנות.

---

## Self-Review

**כיסוי הספק:** ארכיטקטורה (Task 1,3,4,7), מבנה נתונים (Task 2, עם ההערה
המתועדת על השינוי מעמודות נפרדות ל-jsonb), שתי נקודות הקצה (Task 3,4), זרימת
תלמיד/מנהל ומגבלת 8 (Task 2 RPC + Task 5,6), טיפול בשגיאות/ניסיון חוזר
(Task 5 Step 4-6), פריסה (Task 7), בדיקות ידניות (מוטמעות בכל משימה) —
כל סעיף בספק יש לו משימה מתאימה.

**סריקת placeholders:** אין TBD/TODO. `__SUPABASE_URL__`/`__SUPABASE_ANON_KEY__`
הם ערכי תצורה אמיתיים שהוגדר בדיוק היכן ומתי להציב אותם (Task 7 Step 1),
לא placeholder מעורפל.

**עקביות טיפוסים/שמות:** `row.id`/`row.slot`/`row.guitar` עקביים בין Task 5
(frontend) ל-Task 3 (`api/submit.js`); `book_slot`/`release_slot` עקביים בין
Task 2 (SQL) ל-Task 3/4 (JS); מבנה התגובה `{results, slots}` מ-`api/admin.js`
(Task 4) תואם בדיוק את השימוש בו ב-`admin()` (Task 6).
