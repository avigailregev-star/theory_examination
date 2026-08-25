create extension if not exists pgcrypto;

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

alter table results add column tenant_id uuid references tenants(id);
update results set tenant_id = (select id from tenants where slug = 'dimona');
alter table results alter column tenant_id set not null;

alter table results drop constraint results_lesson_slot_id_fkey;
alter table lesson_slots drop constraint lesson_slots_pkey;
alter table lesson_slots add primary key (tenant_id, id);
alter table results add constraint results_lesson_slot_id_fkey foreign key (tenant_id, lesson_slot_id) references lesson_slots(tenant_id, id);

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
set search_path = public, extensions
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

revoke execute on function book_slot(uuid, text, jsonb) from public;
revoke execute on function release_slot(uuid, text) from public;
revoke execute on function verify_tenant_password(uuid, text) from public;
revoke execute on function hash_password(text) from public;
