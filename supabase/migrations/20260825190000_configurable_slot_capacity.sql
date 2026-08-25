create or replace function update_tenant_settings(
  p_tenant_id uuid, p_name text, p_logo text, p_schedule jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare v_slot jsonb; v_ids text[] := array[]::text[]; v_id text; v_capacity int;
begin
  if length(trim(p_name)) < 2 or jsonb_typeof(p_schedule) <> 'object' then
    raise exception 'INVALID_SETTINGS';
  end if;
  for v_slot in
    select slot from jsonb_each(p_schedule) levels
    cross join lateral jsonb_array_elements(levels.value) slot
  loop
    if jsonb_typeof(v_slot) <> 'array' or jsonb_array_length(v_slot) < 4 then
      raise exception 'INVALID_SCHEDULE';
    end if;
    v_id := v_slot->>0;
    v_capacity := coalesce(nullif(v_slot->>5,'')::int,8);
    if v_id is null or v_id = any(v_ids) or v_capacity < 1 or v_capacity > 500 then
      raise exception 'INVALID_OR_DUPLICATE_SLOT';
    end if;
    if exists(select 1 from lesson_slots where tenant_id=p_tenant_id and id=v_id and booked_count>v_capacity) then
      raise exception 'CAPACITY_BELOW_BOOKED';
    end if;
    v_ids := array_append(v_ids,v_id);
    insert into lesson_slots(tenant_id,id,capacity,booked_count)
    values(p_tenant_id,v_id,v_capacity,0)
    on conflict(tenant_id,id) do update set capacity=excluded.capacity;
  end loop;
  if exists(select 1 from lesson_slots where tenant_id=p_tenant_id and not(id=any(v_ids)) and booked_count>0) then
    raise exception 'OCCUPIED_SLOT_REMOVAL';
  end if;
  delete from lesson_slots where tenant_id=p_tenant_id and not(id=any(v_ids));
  update tenants set name=trim(p_name),logo=nullif(trim(p_logo),''),schedule=p_schedule where id=p_tenant_id;
end $$;

revoke all on function update_tenant_settings(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function update_tenant_settings(uuid,text,text,jsonb) to service_role;
