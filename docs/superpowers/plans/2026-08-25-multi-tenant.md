# מוצר Multi-Tenant — תוכנית יישום

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להפוך את המערכת הקיימת (קונסרבטוריון דימונה בלבד) לשירות שמארח כמה
קונסרבטוריונים על קוד ומסד נתונים משותפים, עם בידוד מלא בין הנתונים של כל
לקוח, נתיב כתובת אישי לכל לקוח (`/theory-<slug>`), ומסך ניהול-על להוספת
לקוחות חדשים.

**Architecture:** טבלת `tenants` חדשה (מידע פומבי: שם/לוגו/מערכת שעות) +
טבלת `tenant_auth` נפרדת (סיסמה מוצפנת, חסומה לגמרי לציבור). `lesson_slots`
ו-`results` מקבלות `tenant_id`. שתי הפונקציות הקיימות ושתי חדשות
(`api/submit.js`, `api/admin.js`, `api/superadmin.js`) הופכות למודעות-לקוח;
קובץ ה-HTML הקיים משותף לכולם וקורא את זהות הלקוח מהכתובת; מסך הניהול-על
הוא קובץ HTML קטן ונפרד (`superadmin.html`), לא חלק מהאפליקציה הגדולה.

**Tech Stack:** אותו סטאק קיים — Vercel, Supabase (Postgres, RLS, RPC,
pgcrypto להצפנת סיסמאות), `@supabase/supabase-js`.

**Spec:** [docs/superpowers/specs/2026-08-25-multi-tenant-design.md](../specs/2026-08-25-multi-tenant-design.md)

## Global Constraints

- בנק השאלות ולוגיקת האבחון/שיבוץ **לא** משתנים כלל — משותפים לכל הלקוחות.
- מערכת השעות, לוגו וסיסמת ניהול משתנים לפי לקוח.
- נתיב הכתובת: `/theory-<slug>` (לא תת-דומיין).
- דימונה עוברת ל-`/theory-dimona`, בלי טיפול תאימות לאחור (הכתובת הישנה
  עדיין לא הופצה).
- סיסמאות ניהול (לקוח בודד וניהול-על) נשמרות מוצפנות (bcrypt דרך pgcrypto),
  לא כטקסט גלוי.
- כל כתיבה למסד הנתונים עוברת רק דרך שרתי הביניים עם ה-service role;
  פונקציות RPC נשארות חסומות בפני הפעלה ישירה עם ה-anon key (`REVOKE`).
- מסך ניהול-על: מערכת שעות מוזנת כטקסט JSON, לא עורך גרפי (מוסכם, שלב זה).
- אין חבילת טסטים אוטומטית — אימות ידני, כמו בפרויקט הקודם.

## הערה חשובה: מזהי מיקום בקובץ ה-HTML הענק

`Dimona-Theory-Placement-Standalone.html` הוא קובץ ממוזער עם פונקציות שלמות
על שורה אחת. כל מיקום ("Files: ...:שורה") הוא אינדיקטיבי בלבד — כל שלב נותן
את מחרוזת הקוד המדויקת (הישנה) לאיתור, ולא מסתמך על מספר שורה.

---

### Task 1: סכימת Multi-Tenant ב-Supabase + מעבר נתוני דימונה

**Files:**
- Create: `supabase/002-multi-tenant.sql`

**Interfaces:**
- Produces: טבלאות `tenants`, `tenant_auth`; פונקציות
  `book_slot(p_tenant_id uuid, p_slot text, p_row jsonb)`,
  `release_slot(p_tenant_id uuid, p_slot text)` (מחליפות את החתימות הישנות),
  `verify_tenant_password(p_tenant_id uuid, p_password text) returns boolean`,
  `hash_password(p_password text) returns text` — כולן ישמשו את Tasks 2-4.

- [ ] **Step 1: כתיבת supabase/002-multi-tenant.sql**

```sql
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  logo text,
  schedule jsonb not null
);

alter table tenants enable row level security;

create policy "public can read tenants"
  on tenants for select
  using (true);

create table tenant_auth (
  tenant_id uuid primary key references tenants(id),
  admin_password_hash text not null
);

alter table tenant_auth enable row level security;

insert into tenants (slug, name, schedule) values (
  'dimona', 'קונסרבטוריון דימונה',
  '{"1":[["a-mon-1500","יום ב׳","15:00–15:45","עדיאל"],["a-mon-1600","יום ב׳","16:00–16:45","עדיאל"],["a-tue-1500","יום ג׳","15:00–15:45","רחל"],["a-tue-1600","יום ג׳","16:00–16:45","רחל"],["a-wed-1500","יום ד׳","15:00–15:45","שחף"]],"2":[["b-mon-1500","יום ב׳","15:00–15:45","רחל"],["b-mon-1600","יום ב׳","16:00–16:45","רחל"],["b-tue-1915","יום ג׳","19:15–20:00","רחל"],["b-wed-1500","יום ד׳","15:00–15:45","רחל"]],"3":[["c-wed-1600","יום ד׳","16:00–16:45","שחף"],["c-wed-1700","יום ד׳","17:00–17:45","שחף"]],"4":[["d-wed-1415","יום ד׳","14:15–15:00","שחף","קומפוזיציה – מתקדמים"]]}'::jsonb
);

alter table lesson_slots add column tenant_id uuid references tenants(id);
update lesson_slots set tenant_id = (select id from tenants where slug = 'dimona');
alter table lesson_slots alter column tenant_id set not null;
alter table lesson_slots drop constraint lesson_slots_pkey;
alter table lesson_slots add primary key (tenant_id, id);

alter table results add column tenant_id uuid references tenants(id);
update results set tenant_id = (select id from tenants where slug = 'dimona');
alter table results alter column tenant_id set not null;

create or replace function hash_password(p_password text)
returns text
language sql
as $$
  select crypt(p_password, gen_salt('bf'));
$$;

insert into tenant_auth (tenant_id, admin_password_hash)
select id, hash_password('REPLACE_WITH_YOUR_CURRENT_ADMIN_PASSWORD')
from tenants where slug = 'dimona';

create or replace function verify_tenant_password(p_tenant_id uuid, p_password text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select admin_password_hash = crypt(p_password, admin_password_hash)
  from tenant_auth where tenant_id = p_tenant_id;
$$;

drop function if exists book_slot(text, jsonb);

create or replace function book_slot(p_tenant_id uuid, p_slot text, p_row jsonb)
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
  from lesson_slots where tenant_id = p_tenant_id and id = p_slot
  for update;

  if v_capacity is null then
    raise exception 'SLOT_NOT_FOUND';
  end if;

  if v_booked >= v_capacity then
    raise exception 'SLOT_FULL';
  end if;

  insert into results (id, status, lesson_slot_id, guitar, data, tenant_id)
  values (p_row->>'id', 'פעיל', p_slot, false, p_row, p_tenant_id)
  returning * into v_result;

  update lesson_slots set booked_count = booked_count + 1
  where tenant_id = p_tenant_id and id = p_slot;

  return v_result;
end;
$$;

drop function if exists release_slot(text);

create or replace function release_slot(p_tenant_id uuid, p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update lesson_slots
  set booked_count = greatest(booked_count - 1, 0)
  where tenant_id = p_tenant_id and id = p_slot;
end;
$$;

revoke execute on function book_slot(uuid, text, jsonb) from anon, authenticated;
revoke execute on function release_slot(uuid, text) from anon, authenticated;
revoke execute on function verify_tenant_password(uuid, text) from anon, authenticated;
revoke execute on function hash_password(text) from anon, authenticated;
```

**חשוב:** לפני הרצה, להחליף את `REPLACE_WITH_YOUR_CURRENT_ADMIN_PASSWORD`
בסיסמת הניהול הנוכחית והאמיתית של דימונה (זו שכבר מוגדרת כ-`ADMIN_PASSWORD`
ב-Vercel היום) — כדי שהכניסה למסך הניהול של דימונה תמשיך לעבוד באותה סיסמה
בדיוק אחרי המעבר.

- [ ] **Step 2: הרצה ב-Supabase SQL Editor (ידני)**

להדביק את כל התוכן (אחרי החלפת הסיסמה) ולהריץ. Expected: "Success. No rows
returned". ב-Table Editor: `tenants` עם שורה אחת ("dimona"), `tenant_auth`
עם שורה אחת, `lesson_slots` עם 12 שורות שכולן עם `tenant_id` מאוכלס.

- [ ] **Step 3: אימות ידני (ב-SQL Editor)**

```sql
select verify_tenant_password(
  (select id from tenants where slug='dimona'),
  'הסיסמה_שהוזנה_למעלה'
);
```

Expected: `true`. עם סיסמה שגויה — `false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/002-multi-tenant.sql
git commit -m "feat: add multi-tenant schema (tenants, tenant_auth, tenant-scoped RPCs)"
```

---

### Task 2: `api/submit.js` — תמיכה בכמה לקוחות

**Files:**
- Modify: `api/submit.js` (קובץ שלם, להחליף)

**Interfaces:**
- Consumes: `tenants` (Task 1), `book_slot(p_tenant_id, p_slot, p_row)` (Task 1).
- Produces: `POST /api/submit` מקבל `{tenantSlug, ...row}` (השדות המוכרים
  של `row` בתוספת `tenantSlug` ברמה העליונה). מחזיר `404 {error:'TENANT_NOT_FOUND'}`
  אם ה-slug לא קיים; אחרת זהה להתנהגות הקודמת.

- [ ] **Step 1: החלפת התוכן המלא של api/submit.js**

```js
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
```

- [ ] **Step 2: בדיקה ידנית עם vercel dev**

```bash
curl -X POST http://localhost:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{"tenantSlug":"dimona","id":"manual-mt-1","fullName":"בדיקה","slot":"d-wed-1415","level":4}'
```

Expected: `200` עם `row`. עם `tenantSlug` לא קיים (למשל `"no-such"`):
Expected `404 {"error":"TENANT_NOT_FOUND"}`. לנקות אחר כך:
`delete from results where id='manual-mt-1'` + איפוס `booked_count` של
`d-wed-1415` ל-0 ב-SQL Editor.

- [ ] **Step 3: Commit**

```bash
git add api/submit.js
git commit -m "feat: make /api/submit tenant-aware"
```

---

### Task 3: `api/admin.js` — תמיכה בכמה לקוחות + אימות מוצפן

**Files:**
- Modify: `api/admin.js` (קובץ שלם, להחליף)

**Interfaces:**
- Consumes: `tenants`, `verify_tenant_password`, `release_slot(p_tenant_id, p_slot)` (Task 1).
- Produces: `POST /api/admin` מקבל `{tenantSlug, password, action, id?}`.
  אימות סיסמה מול `tenant_auth` של הלקוח הספציפי (לא משתנה סביבה גלובלי).

- [ ] **Step 1: החלפת התוכן המלא של api/admin.js**

```js
const { getServiceClient } = require('./_supabase');

const attempts = new Map();

function isRateLimited(key) {
  const entry = attempts.get(key) || { count: 0, resetAt: 0 };
  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + 60000;
  }
  return entry.count > 10;
}

function recordFailedAttempt(key) {
  const entry = attempts.get(key) || { count: 0, resetAt: Date.now() + 60000 };
  if (Date.now() > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = Date.now() + 60000;
  }
  entry.count++;
  attempts.set(key, entry);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { tenantSlug, password, action, id } = req.body || {};
  const key = (req.headers['x-forwarded-for'] || 'unknown') + ':' + tenantSlug;

  if (isRateLimited(key)) {
    res.status(429).json({ error: 'יותר מדי ניסיונות, נסו שוב בעוד דקה' });
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

  const { data: passwordOk, error: verifyError } = await supabase.rpc('verify_tenant_password', {
    p_tenant_id: tenant.id,
    p_password: password,
  });
  if (verifyError || !passwordOk) {
    recordFailedAttempt(key);
    res.status(401).json({ error: 'סיסמה שגויה' });
    return;
  }

  if (action === 'list') {
    const { data: results, error: e1 } = await supabase
      .from('results')
      .select('*')
      .eq('tenant_id', tenant.id)
      .neq('status', 'נמחק');
    const { data: slots, error: e2 } = await supabase
      .from('lesson_slots')
      .select('*')
      .eq('tenant_id', tenant.id);
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
      .select('lesson_slot_id, status')
      .eq('id', id)
      .eq('tenant_id', tenant.id)
      .single();
    if (e1) {
      res.status(500).json({ error: e1.message });
      return;
    }
    if (row.status === 'נמחק') {
      res.status(200).json({ ok: true });
      return;
    }
    await supabase
      .from('results')
      .update({ status: 'נמחק' })
      .eq('id', id)
      .eq('tenant_id', tenant.id);
    if (row.lesson_slot_id) {
      await supabase.rpc('release_slot', { p_tenant_id: tenant.id, p_slot: row.lesson_slot_id });
    }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(400).json({ error: 'פעולה לא מוכרת' });
};
```

- [ ] **Step 2: בדיקה ידנית עם vercel dev**

עם הסיסמה האמיתית של דימונה: `curl -X POST http://localhost:3000/api/admin -H "Content-Type: application/json" -d '{"tenantSlug":"dimona","password":"<הסיסמה>","action":"list"}'`
Expected: `200` עם `results`/`slots` של דימונה בלבד. עם סיסמה שגויה: `401`.

- [ ] **Step 3: Commit**

```bash
git add api/admin.js
git commit -m "feat: make /api/admin tenant-aware with encrypted password verification"
```

---

### Task 4: מסך ניהול-על — `superadmin.html` + `api/superadmin.js`

**Files:**
- Create: `superadmin.html`
- Create: `api/superadmin.js`

**Interfaces:**
- Consumes: `tenants`, `tenant_auth`, `hash_password(p_password)` (Task 1).
- Produces: `POST /api/superadmin` עם `{password, action}` (`list`) או
  `{password, action:'create', slug, name, adminPassword, schedule}` (`create`,
  `schedule` הוא מחרוזת JSON). מוגן במשתנה סביבה `SUPERADMIN_PASSWORD`.

- [ ] **Step 1: יצירת api/superadmin.js**

```js
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
```

- [ ] **Step 2: יצירת superadmin.html**

```html
<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>ניהול-על</title><style>body{font-family:Arial;max-width:700px;margin:40px auto;padding:0 20px}input,textarea{width:100%;padding:8px;margin:6px 0;box-sizing:border-box;font:inherit}button{padding:10px 20px;cursor:pointer}table{width:100%;border-collapse:collapse;margin-top:20px}td,th{border:1px solid #ccc;padding:6px;text-align:right}</style></head><body>
<h1>ניהול קונסרבטוריונים</h1>
<div id="login"><input id="pass" type="password" placeholder="סיסמת ניהול-על"><button id="login-btn">כניסה</button><p id="login-err" style="color:red"></p></div>
<div id="app" style="display:none">
<h2>קונסרבטוריונים קיימים</h2>
<table id="tenants-table"><thead><tr><th>שם</th><th>slug</th><th>קישור</th></tr></thead><tbody id="tenants-body"></tbody></table>
<h2>הוספת קונסרבטוריון</h2>
<input id="name" placeholder="שם תצוגה">
<input id="slug" placeholder="slug (באנגלית, למשל hadera)">
<input id="admin-password" type="password" placeholder="סיסמת ניהול ללקוח">
<textarea id="schedule" rows="6" placeholder='מערכת שעות בפורמט JSON, למשל: {"1":[["a-mon-1500","יום ב׳","15:00–15:45","שם המורה"]]}'></textarea>
<button id="create-btn">הוספה</button>
<p id="create-err" style="color:red"></p>
<p id="create-ok" style="color:green"></p>
</div>
<script>
let pass='';
document.getElementById('login-btn').onclick=async()=>{
  pass=document.getElementById('pass').value;
  const res=await fetch('/api/superadmin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'list'})});
  if(!res.ok){document.getElementById('login-err').textContent='סיסמה שגויה';return}
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='block';
  loadTenants();
};
async function loadTenants(){
  const res=await fetch('/api/superadmin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'list'})});
  const {tenants}=await res.json();
  document.getElementById('tenants-body').innerHTML=tenants.map(t=>'<tr><td>'+t.name+'</td><td>'+t.slug+'</td><td><a href="/theory-'+t.slug+'" target="_blank">/theory-'+t.slug+'</a></td></tr>').join('');
}
document.getElementById('create-btn').onclick=async()=>{
  const body={
    password:pass,
    action:'create',
    name:document.getElementById('name').value,
    slug:document.getElementById('slug').value,
    adminPassword:document.getElementById('admin-password').value,
    schedule:document.getElementById('schedule').value
  };
  const res=await fetch('/api/superadmin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json();
  if(!res.ok){document.getElementById('create-err').textContent=data.error;document.getElementById('create-ok').textContent='';return}
  document.getElementById('create-err').textContent='';
  document.getElementById('create-ok').textContent='נוצר בהצלחה!';
  loadTenants();
};
</script>
</body></html>
```

- [ ] **Step 3: בדיקה ידנית עם vercel dev**

לפתוח `http://localhost:3000/superadmin.html` (הרוט לא עדיין מוגדר, זה נבדק
דרך שם הקובץ הישיר בשלב הזה — ה-rewrite ל-`/superadmin` מגיע ב-Task 6).
להיכנס עם `SUPERADMIN_PASSWORD` מה-`.env` המקומי, ליצור לקוח בדיקה עם
`slug` כמו `test-tenant` ומערכת שעות מינימלית, למשל:
`{"1":[["t-mon-1000","יום ב׳","10:00–10:45","מורה בדיקה"]]}`. Expected:
"נוצר בהצלחה!", והלקוח מופיע ברשימה. לוודא ב-Supabase שנוצרו שורות ב-
`tenants`, `tenant_auth`, ו-`lesson_slots` (שורה אחת, `t-mon-1000`).
**לא למחוק את לקוח הבדיקה** — הוא ישמש לבדיקת בידוד נתונים ב-Task 7.

- [ ] **Step 4: Commit**

```bash
git add superadmin.html api/superadmin.js
git commit -m "feat: add super-admin screen for onboarding new tenants"
```

---

### Task 5: Frontend — קריאת זהות לקוח מהכתובת והחלפת SCHEDULE הקבוע

**Files:**
- Modify: `Dimona-Theory-Placement-Standalone.html`

**Interfaces:**
- Consumes: טבלת `tenants` (Task 1, קריאה פומבית עם ה-anon key), `POST /api/submit`
  ו-`POST /api/admin` בפורמט `{tenantSlug, ...}` (Tasks 2-3).
- Produces: `state.tenant = {id, name, logo, schedule}` — כל שאר הפונקציות
  בקובץ שמשתמשות היום ב-`SCHEDULE` הגלובלי צריכות לעבור ל-`state.tenant.schedule`.

- [ ] **Step 1: הוספת tenantSlug() ו-loadTenant(), החלפת שורת ה-bootstrap**

לאתר את השורה (בסוף הקובץ, אותה שורה שמכילה `retryPending();` בסופה):

```js
function render(){state.stage==='quiz'?quiz():state.stage==='choice'?choice():intro()}window.addEventListener('hashchange',()=>location.hash==='#admin'?admin():intro());async function retryPending(){const pending=localStorage.getItem('dimona-pending-result');if(!pending)return;if(!confirm('נמצאה תוצאת מבחן שלא נשלחה בעבר. לנסות לשלוח אותה עכשיו?'))return;try{const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:pending});if(res.ok){localStorage.removeItem('dimona-pending-result');alert('התוצאה נשלחה בהצלחה.')}else if(res.status===409){alert('הקבוצה שנבחרה בעבר כבר התמלאה. יש להיכנס למבחן מחדש ולבחור מועד אחר.');localStorage.removeItem('dimona-pending-result')}else{alert('עדיין יש בעיה בשליחה. ננסה שוב בפעם הבאה.')}}catch{alert('אין עדיין חיבור תקין לאינטרנט. ננסה שוב בפעם הבאה.')}}render();retryPending();
```

להחליף ב:

```js
function render(){state.stage==='quiz'?quiz():state.stage==='choice'?choice():intro()}window.addEventListener('hashchange',()=>location.hash==='#admin'?admin():intro());async function retryPending(){const pending=localStorage.getItem('dimona-pending-result');if(!pending)return;if(!confirm('נמצאה תוצאת מבחן שלא נשלחה בעבר. לנסות לשלוח אותה עכשיו?'))return;try{const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:pending});if(res.ok){localStorage.removeItem('dimona-pending-result');alert('התוצאה נשלחה בהצלחה.')}else if(res.status===409){alert('הקבוצה שנבחרה בעבר כבר התמלאה. יש להיכנס למבחן מחדש ולבחור מועד אחר.');localStorage.removeItem('dimona-pending-result')}else{alert('עדיין יש בעיה בשליחה. ננסה שוב בפעם הבאה.')}}catch{alert('אין עדיין חיבור תקין לאינטרנט. ננסה שוב בפעם הבאה.')}}function tenantSlug(){const m=location.pathname.match(/\/theory-([^/]+)/);return m?m[1]:null}async function loadTenant(){const slug=tenantSlug();if(!slug){app.innerHTML='<div class="shell"><section class="card"><h1>קונסרבטוריון לא נמצא</h1><p>יש לגשת לכתובת שקיבלתם מהקונסרבטוריון.</p></section></div>';return false}const{data,error}=await sb.from('tenants').select('id,name,logo,schedule').eq('slug',slug).single();if(error||!data){app.innerHTML='<div class="shell"><section class="card"><h1>קונסרבטוריון לא נמצא</h1><p>הכתובת אינה תקינה.</p></section></div>';return false}state.tenant=data;return true}(async()=>{if(await loadTenant()){render();retryPending()}})();
```

שינוי המפתח: `render();retryPending();` בסוף הפכו ל-IIFE אסינכרוני שקודם טוען
את הלקוח (`loadTenant()`) ורק אם הצליח מריץ את שאר האתחול. `SCHEDULE` הגלובלי
נשאר בקובץ (חלק מבנק השאלות) אך **לא נקרא יותר** — מוחלף ב-`state.tenant.schedule`
בכל הפונקציות הבאות.

- [ ] **Step 2: החלפת choice() לשימוש ב-state.tenant.schedule**

לאתר:
```js
async function choice(){const lvl=state.placement.level,slots=SCHEDULE[lvl];
```
(תחילת השורה של הפונקציה — שאר השורה ארוכה ונשארת זהה).

להחליף רק את התחילית הזו ב:
```js
async function choice(){const lvl=state.placement.level,slots=state.tenant.schedule[lvl];
```

- [ ] **Step 3: החלפת finish() — הוספת tenantSlug לבקשה, שימוש ב-schedule דינמי**

לאתר את הפונקציה (מתחילה ב-`async function finish(){const row=`):

```js
async function finish(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,diagnostic:state.placement.diagnostic,level:state.placement.level,total:state.placement.total,scores:state.placement.scores,slot:state.slot,status:'פעיל'};let res;try{res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)})}catch{localStorage.setItem('dimona-pending-result',JSON.stringify(row));alert('אין חיבור לאינטרנט כרגע. התוצאה נשמרה במכשיר ותישלח אוטומטית כשתפתחו את העמוד שוב עם חיבור תקין.');return}if(res.status===409){alert('הקבוצה התמלאה. יש לבחור מועד אחר.');state.slot=null;choice();return}if(!res.ok){localStorage.setItem('dimona-pending-result',JSON.stringify(row));alert('שגיאה בשמירת התוצאה. התוצאה נשמרה במכשיר, ננסה שוב בפתיחה הבאה.');return}const s=Object.values(SCHEDULE).flat().find(x=>x[0]===state.slot);result(row,s)}
```

להחליף ב:

```js
async function finish(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,diagnostic:state.placement.diagnostic,level:state.placement.level,total:state.placement.total,scores:state.placement.scores,slot:state.slot,status:'פעיל'};const payload={tenantSlug:tenantSlug(),...row};let res;try{res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})}catch{localStorage.setItem('dimona-pending-result',JSON.stringify(payload));alert('אין חיבור לאינטרנט כרגע. התוצאה נשמרה במכשיר ותישלח אוטומטית כשתפתחו את העמוד שוב עם חיבור תקין.');return}if(res.status===409){alert('הקבוצה התמלאה. יש לבחור מועד אחר.');state.slot=null;choice();return}if(!res.ok){localStorage.setItem('dimona-pending-result',JSON.stringify(payload));alert('שגיאה בשמירת התוצאה. התוצאה נשמרה במכשיר, ננסה שוב בפתיחה הבאה.');return}const s=Object.values(state.tenant.schedule).flat().find(x=>x[0]===state.slot);result(row,s)}
```

- [ ] **Step 4: החלפת finishGuitar() — הוספת tenantSlug לבקשה**

לאתר:

```js
async function finishGuitar(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,guitar:true,status:'פעיל'};try{const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});if(!res.ok)throw 0}catch{localStorage.setItem('dimona-pending-result',JSON.stringify(row))}app.innerHTML='<div class="shell"><section class="card result"><div class="seal">♬</div><p class="eyebrow">הפרטים נשמרו</p><h1>מסלול התאוריה לגיטריסטים</h1><p>השיבוץ ייקבע לאחת משתי קבוצות יום ה׳: 15:00–15:45 או 16:00–16:45.</p><button onclick="location.reload()">מבחן נוסף</button></section></div>'}
```

להחליף ב:

```js
async function finishGuitar(){const row={id:crypto.randomUUID?.()||'mt-'+Date.now(),created:new Date().toISOString(),...state.student,guitar:true,status:'פעיל'};const payload={tenantSlug:tenantSlug(),...row};try{const res=await fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!res.ok)throw 0}catch{localStorage.setItem('dimona-pending-result',JSON.stringify(payload))}app.innerHTML='<div class="shell"><section class="card result"><div class="seal">♬</div><p class="eyebrow">הפרטים נשמרו</p><h1>מסלול התאוריה לגיטריסטים</h1><p>השיבוץ ייקבע לאחת משתי קבוצות יום ה׳: 15:00–15:45 או 16:00–16:45.</p><button onclick="location.reload()">מבחן נוסף</button></section></div>'}
```

- [ ] **Step 5: החלפת csv() לשימוש ב-state.tenant.schedule**

לאתר את המחרוזת `Object.values(SCHEDULE).flat().find(x=>x[0]===r.slot)` בתוך
`function csv(rows){...}` ולהחליף ל-`Object.values(state.tenant.schedule).flat().find(x=>x[0]===r.slot)`
(מופע יחיד בפונקציה הזו).

- [ ] **Step 6: החלפת admin() — tenantSlug בבקשות, state.tenant.schedule בתצוגה**

לאתר את תחילת הפונקציה:
```js
async function admin(){const savedPass=sessionStorage.getItem('dimona-admin-pass');const pass=savedPass||prompt('סיסמת ניהול:');if(!pass){location.hash='';intro();return}app.innerHTML='<div class="shell"><section class="card"><p>טוען…</p></section></div>';const res=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'list'})});
```

להחליף ב:
```js
async function admin(){const savedPass=sessionStorage.getItem('dimona-admin-pass');const pass=savedPass||prompt('סיסמת ניהול:');if(!pass){location.hash='';intro();return}app.innerHTML='<div class="shell"><section class="card"><p>טוען…</p></section></div>';const res=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantSlug:tenantSlug(),password:pass,action:'list'})});
```

בהמשך אותה פונקציה, שני מופעים של `Object.values(SCHEDULE).flat()` (אחד
בבניית בארי התפוסה, אחד בפונקציית `draw` הפנימית לטבלת התוצאות) — להחליף
את שניהם ל-`Object.values(state.tenant.schedule).flat()`.

ולבסוף, בתוך ה-handler של כפתור המחיקה באותה פונקציה, לאתר:
```js
const dr=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass,action:'delete',id:b.dataset.id})});
```
ולהחליף ב:
```js
const dr=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantSlug:tenantSlug(),password:pass,action:'delete',id:b.dataset.id})});
```

- [ ] **Step 7: בדיקה ידנית עם vercel dev**

לפתוח `http://localhost:3000/theory-dimona` (יש לוודא ש-vercel.json כבר
כולל את ה-rewrite הזה — אם Task 6 עדיין לא רץ, ניתן לבדוק זמנית ישירות דרך
`http://localhost:3000/Dimona-Theory-Placement-Standalone.html?...` עם
`location.pathname` מדומה, או לבצע את Task 6 לפני הבדיקה הזו). לוודא: המבחן
עולה, מציג מועדים של דימונה בלבד, מבחן מלא מסתיים בהצלחה, ומסך הניהול
(`#admin`) מציג רק תוצאות של דימונה עם הסיסמה הקיימת.

- [ ] **Step 8: Commit**

```bash
git add Dimona-Theory-Placement-Standalone.html
git commit -m "feat: make frontend tenant-aware via URL-based tenant resolution"
```

---

### Task 6: ניתוב Vercel למבנה Multi-Tenant

**Files:**
- Modify: `vercel.json`

**Interfaces:**
- Produces: `/theory-<slug>` ו-`/superadmin` מוגשים כראוי.

- [ ] **Step 1: עדכון vercel.json**

להחליף את כל התוכן:

```json
{
  "rewrites": [
    { "source": "/superadmin", "destination": "/superadmin.html" },
    { "source": "/theory-:slug", "destination": "/Dimona-Theory-Placement-Standalone.html" }
  ]
}
```

הכלל הקודם (`/` → קובץ המבחן) מוסר בכוונה — לפי הספסיפיקציה, אין עוד "לקוח
יחיד" בכתובת השורש; מי שנכנס ל-`/` בלי שם לקוח מקבל 404 בשלב זה (אין דרישה
לעמוד נחיתה כרגע).

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: route /theory-:slug and /superadmin instead of single-tenant root"
```

---

### Task 7: פריסה ואימות בידוד נתונים מקצה לקצה

**Files:**
- אין שינויי קוד — פריסה ובדיקה בלבד.

- [ ] **Step 1: הגדרת משתנה סביבה חדש ב-Vercel (ידני)**

Project Settings → Environments → (Production/Preview/Development, כל
השלושה) → Add Environment Variable: `SUPERADMIN_PASSWORD`, ערך לבחירתך.
(משתנה `ADMIN_PASSWORD` הישן הפך ללא נחוץ — אפשר להשאיר אותו או להסיר,
אין הבדל פונקציונלי כרגע.)

- [ ] **Step 2: Push ופריסה**

```bash
git push
```

- [ ] **Step 3: אימות דימונה בסביבת production/preview**

לפתוח את הכתובת שהתקבלה + `/theory-dimona`. לעבור מבחן מלא, לוודא שהתוצאה
מופיעה במסך הניהול (`/theory-dimona#admin`) עם הסיסמה הקיימת של דימונה.

- [ ] **Step 4: הוספת לקוח בדיקה חדש ואימות בידוד**

לפתוח `/superadmin`, להיכנס עם `SUPERADMIN_PASSWORD`, ליצור לקוח בדיקה
(אם עדיין לא קיים מ-Task 4 — אם קיים, אפשר להשתמש בו). לעבור מבחן מלא תחת
`/theory-<slug-הבדיקה>`. **לוודא:**
- התוצאה **לא** מופיעה במסך הניהול של דימונה.
- מסך הניהול של לקוח הבדיקה מציג רק את התוצאה שלו, לא את של דימונה.
- סיסמת הניהול של דימונה **לא** עובדת על מסך הניהול של לקוח הבדיקה ולהפך.

- [ ] **Step 5: ניקוי לקוח הבדיקה**

ב-SQL Editor:
```sql
delete from lesson_slots where tenant_id = (select id from tenants where slug = 'שם-לקוח-הבדיקה');
delete from results where tenant_id = (select id from tenants where slug = 'שם-לקוח-הבדיקה');
delete from tenant_auth where tenant_id = (select id from tenants where slug = 'שם-לקוח-הבדיקה');
delete from tenants where slug = 'שם-לקוח-הבדיקה';
```

---

## Self-Review

**כיסוי הספק:** ארכיטקטורה ומבנה נתונים (Task 1), זרימת תלמיד/מנהל/ניהול-על
(Tasks 2-4), אבטחה — הצפנת סיסמאות + REVOKE על כל הפונקציות (Task 1),
מעבר נתוני דימונה (Task 1), ניתוב לפי נתיב (Task 6), בדיקות בידוד (Task 7)
— כל סעיף בספק יש לו משימה מתאימה.

**סריקת placeholders:** אין TBD/TODO. `REPLACE_WITH_YOUR_CURRENT_ADMIN_PASSWORD`
הוא ערך תצורה אמיתי עם הוראה מדויקת מתי ואיך להחליפו (Task 1), לא placeholder
מעורפל. שמות לקוח בדיקה (`שם-לקוח-הבדיקה`) ב-Task 7 מכוונים במפורש למה
שנבחר בפועל ב-Task 4/7 Step 4.

**עקביות טיפוסים/שמות:** חתימות `book_slot(uuid,text,jsonb)`/`release_slot(uuid,text)`
עקביות בין Task 1 (SQL) ל-Tasks 2-3 (JS `supabase.rpc` calls). מבנה הבקשה
`{tenantSlug, ...}` עקבי בין Task 5 (frontend) ל-Tasks 2-3 (שרת). `state.tenant`
עקבי בין Step 1 (יצירה ב-`loadTenant`) ל-Steps 2,3,5,6 (צריכה).
