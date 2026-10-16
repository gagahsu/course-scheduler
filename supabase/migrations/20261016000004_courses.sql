-- 課務排程：課程、老師專長、課表範本、自動排課

-- 課程（Java 基礎、Spring Boot、SQL…）
create table public.courses (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  default_days  int  not null default 5 check (default_days > 0),   -- 排課時預設上幾天
  note          text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- 老師會教哪些課
create table public.teacher_courses (
  teacher_id  bigint not null references public.teachers on delete cascade,
  course_id   bigint not null references public.courses  on delete cascade,
  primary key (teacher_id, course_id)
);
create index on public.teacher_courses (course_id);

-- 課表範本：一個班依序上哪些課、各幾天、預設誰教
create table public.curricula (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  note        text,
  created_at  timestamptz not null default now()
);
create table public.curriculum_items (
  id             bigint generated always as identity primary key,
  curriculum_id  bigint not null references public.curricula on delete cascade,
  position       int    not null,
  course_id      bigint references public.courses on delete cascade,
  days           int    not null check (days > 0),
  teacher_id     bigint references public.teachers on delete set null
);
create index on public.curriculum_items (curriculum_id, position);

-- 授課區段記錄教哪門課
alter table public.teaching_blocks
  add column course_id bigint references public.courses on delete set null;

-- 儲存範本（名稱＋整串課程一次寫入）
-- p_items: [{"course_id": 1, "days": 15, "teacher_id": 2}, ...]
create or replace function public.save_curriculum(
  p_id     bigint,
  p_name   text,
  p_note   text,
  p_items  jsonb
) returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  it   jsonb;
  i    int := 0;
begin
  if p_id is null then
    insert into public.curricula (name, note) values (p_name, p_note) returning id into v_id;
  else
    update public.curricula set name = p_name, note = p_note where id = p_id returning id into v_id;
    if v_id is null then
      raise exception '找不到這個課表範本' using errcode = 'P0001';
    end if;
    delete from public.curriculum_items where curriculum_id = v_id;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    i := i + 1;
    insert into public.curriculum_items (curriculum_id, position, course_id, days, teacher_id)
    values (v_id, i, nullif(it->>'course_id', '')::bigint, (it->>'days')::int, nullif(it->>'teacher_id', '')::bigint);
  end loop;

  return v_id;
end;
$$;

-- 自動排課：依這個班的上課日（已扣停課日、含補課日）把每一列依序往後排成授課區段
-- 沒指定老師的列只佔天數、不建區段（會顯示成「未指派」）；超出上課日的部分略過
create or replace function public.apply_plan(
  p_class_id  bigint,
  p_items     jsonb,
  p_replace   boolean default false
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_days     date[];
  v_total    int;
  v_pos      int := 1;
  v_n        int;
  v_req      int := 0;
  v_blocks   int := 0;
  v_skipped  int := 0;
  it         jsonb;
begin
  select array_agg(day order by day) into v_days
  from public.v_sessions where class_id = p_class_id;
  if v_days is null then
    raise exception '這個班沒有任何上課日' using errcode = 'P0001';
  end if;
  v_total := array_length(v_days, 1);

  if p_replace then
    delete from public.teaching_blocks where class_id = p_class_id;
  elsif exists (select 1 from public.teaching_blocks where class_id = p_class_id) then
    raise exception '這個班已經有授課區段，請勾選「取代現有區段」' using errcode = 'P0001';
  end if;

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_n := (it->>'days')::int;
    if v_n is null or v_n < 1 then
      raise exception '每一列的天數都要大於 0' using errcode = 'P0001';
    end if;
    v_req := v_req + v_n;
    continue when v_pos > v_total;
    if nullif(it->>'teacher_id', '') is not null then
      insert into public.teaching_blocks (class_id, teacher_id, course_id, start_date, end_date)
      values (p_class_id, (it->>'teacher_id')::bigint, nullif(it->>'course_id', '')::bigint,
              v_days[v_pos], v_days[least(v_pos + v_n - 1, v_total)]);
      v_blocks := v_blocks + 1;
    else
      v_skipped := v_skipped + 1;
    end if;
    v_pos := v_pos + v_n;
  end loop;

  return jsonb_build_object(
    'blocks', v_blocks, 'skipped', v_skipped,
    'requested_days', v_req, 'total_days', v_total);
end;
$$;

-- 權限
alter table public.courses          enable row level security;
alter table public.teacher_courses  enable row level security;
alter table public.curricula        enable row level security;
alter table public.curriculum_items enable row level security;

create policy staff_all on public.courses          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.teacher_courses  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.curricula        for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.curriculum_items for all to authenticated using (public.is_staff()) with check (public.is_staff());

revoke all on public.courses, public.teacher_courses, public.curricula, public.curriculum_items from anon;
revoke execute on function public.save_curriculum(bigint, text, text, jsonb) from anon, public;
revoke execute on function public.apply_plan(bigint, jsonb, boolean) from anon, public;
grant execute on function public.save_curriculum(bigint, text, text, jsonb) to authenticated;
grant execute on function public.apply_plan(bigint, jsonb, boolean) to authenticated;
