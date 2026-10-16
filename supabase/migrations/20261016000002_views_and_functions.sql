-- 課務排程：檢視表與函式
-- 核心概念：v_sessions 把「每個班的每一個上課日」展開成一列，
-- 並算出當天原定老師、是否請假、是否有人代課、實際由誰上課。
-- 行事曆、今日上課、請假影響、衝突檢查都從這裡讀。

create or replace view public.v_sessions
with (security_invoker = true) as
with raw_days as (
  -- 開課期間內的平日，扣掉假日
  select c.id as class_id, g::date as day, false as is_makeup
  from public.classes c
  cross join lateral generate_series(c.start_date, c.end_date, interval '1 day') g
  where extract(isodow from g) < 6
    and not exists (
      select 1 from public.calendar_events e
      where e.kind = 'holiday' and e.day = g::date
        and (e.class_id is null or e.class_id = c.id))
  union all
  -- 加上補課日（可能是週末）
  select e.class_id, e.day, true
  from public.calendar_events e
  where e.kind = 'makeup'
),
class_days as (
  select class_id, day, bool_or(is_makeup) as is_makeup
  from raw_days group by class_id, day
)
select
  d.class_id,
  c.name            as class_name,
  c.location_id,
  loc.name          as location_name,
  c.room,
  d.day,
  d.is_makeup,
  tb.teacher_id     as planned_teacher_id,
  lv.id             as leave_id,
  s.id              as substitution_id,
  s.sub_teacher_id,
  case
    when s.id is not null  then s.sub_teacher_id
    when lv.id is not null then null
    else tb.teacher_id
  end as actual_teacher_id,
  case
    when s.id is not null and lv.id is not null then 'covered'     -- 請假，已安排代課
    when s.id is not null                       then 'swapped'     -- 沒請假但當天換人
    when tb.teacher_id is null                  then 'unassigned'  -- 還沒排老師
    when lv.id is not null                      then 'uncovered'   -- 請假，還沒安排代課
    else 'normal'
  end as status
from class_days d
join public.classes   c   on c.id = d.class_id
join public.locations loc on loc.id = c.location_id
left join public.teaching_blocks tb
  on tb.class_id = d.class_id and d.day between tb.start_date and tb.end_date
left join lateral (
  select l.id from public.leaves l
  where l.teacher_id = tb.teacher_id and d.day between l.start_date and l.end_date
  order by l.id limit 1
) lv on true
left join public.substitutions s
  on s.class_id = d.class_id and s.day = d.day;

-- 請假了但還沒安排代課的課
create or replace view public.v_uncovered
with (security_invoker = true) as
select * from public.v_sessions where status = 'uncovered';

-- 同一位老師同一天被排到兩個班
create or replace view public.v_teacher_conflicts
with (security_invoker = true) as
select day, actual_teacher_id as teacher_id,
       array_agg(class_id order by class_id)   as class_ids,
       array_agg(class_name order by class_id) as class_names
from public.v_sessions
where actual_teacher_id is not null
group by day, actual_teacher_id
having count(*) > 1;

-- 某一天每位老師的狀態：請假 / 在哪個班上課 / 有空
create or replace function public.teacher_day_status(p_day date)
returns table (
  teacher_id      bigint,
  name            text,
  can_substitute  boolean,
  on_leave        boolean,
  busy_class_id   bigint,
  busy_class_name text,
  busy_location   text
)
language sql stable security invoker
set search_path = public
as $$
  select t.id, t.name, t.can_substitute,
         exists (select 1 from public.leaves l
                 where l.teacher_id = t.id and p_day between l.start_date and l.end_date),
         s.class_id, s.class_name, s.location_name
  from public.teachers t
  left join lateral (
    select v.class_id, v.class_name, v.location_name
    from public.v_sessions v
    where v.day = p_day and v.actual_teacher_id = t.id
    order by v.class_id limit 1
  ) s on true
  where t.active
  order by t.id;
$$;

-- 代課檢查：代課老師當天不能請假、不能已經在別班上課、日期必須是該班上課日
create or replace function public.check_substitution()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_session public.v_sessions%rowtype;
  v_busy    text;
begin
  select * into v_session from public.v_sessions
  where class_id = new.class_id and day = new.day;
  if not found then
    raise exception '% 這天不是這個班的上課日', new.day using errcode = 'P0001';
  end if;

  if v_session.planned_teacher_id = new.sub_teacher_id and new.leave_id is null then
    raise exception '代課老師和原定老師是同一人' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.leaves l
             where l.teacher_id = new.sub_teacher_id
               and new.day between l.start_date and l.end_date) then
    raise exception '代課老師 % 當天請假', new.day using errcode = 'P0001';
  end if;

  select v.location_name || ' ' || v.class_name into v_busy
  from public.v_sessions v
  where v.day = new.day and v.class_id <> new.class_id
    and v.actual_teacher_id = new.sub_teacher_id
  limit 1;
  if v_busy is not null then
    raise exception '代課老師 % 當天已經在 % 上課', new.day, v_busy using errcode = 'P0001';
  end if;

  if new.leave_id is not null and not exists (
       select 1 from public.leaves l
       where l.id = new.leave_id and new.day between l.start_date and l.end_date) then
    raise exception '代課日期 % 不在請假期間內', new.day using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger substitutions_check
before insert or update on public.substitutions
for each row execute function public.check_substitution();

-- 一次登記請假＋代課（同一個交易，任何一筆代課不合法就整筆取消）
-- p_subs: [{"class_id": 2, "day": "2026-10-21", "sub_teacher_id": 3}, ...]
create or replace function public.register_leave(
  p_teacher_id bigint,
  p_start      date,
  p_end        date,
  p_type       text default '事假',
  p_note       text default null,
  p_subs       jsonb default '[]'::jsonb
) returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_id bigint;
  s    jsonb;
begin
  insert into public.leaves (teacher_id, start_date, end_date, type, note)
  values (p_teacher_id, p_start, p_end, coalesce(p_type, '事假'), p_note)
  returning id into v_id;

  for s in select * from jsonb_array_elements(coalesce(p_subs, '[]'::jsonb)) loop
    insert into public.substitutions (leave_id, class_id, day, sub_teacher_id)
    values (v_id, (s->>'class_id')::bigint, (s->>'day')::date, (s->>'sub_teacher_id')::bigint);
  end loop;

  return v_id;
end;
$$;
