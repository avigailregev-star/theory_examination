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

revoke execute on function book_slot(text, jsonb) from anon, authenticated;
revoke execute on function release_slot(text) from anon, authenticated;
