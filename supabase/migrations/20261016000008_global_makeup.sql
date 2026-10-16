-- 課務排程：全體補班日
-- 例如人事行政總處公布的週六補班日：class_id 為 null 的 makeup ＝ 當天所有開課中的班都要上課。
-- （原本 makeup 一定要指定班級）

alter table public.calendar_events drop constraint if exists calendar_events_check;

-- v_sessions 只改補課那一段：全體補班日套用到當天在開訓～結訓期間的所有班
create or replace view public.v_sessions
with (security_invoker = true) as
with raw_days as (
  select c.id as class_id, g::date as day, false as is_makeup
  from public.classes c
  cross join lateral generate_series(c.start_date, c.end_date, interval '1 day') g
  where extract(isodow from g) < 6
    and not exists (
      select 1 from public.calendar_events e
      where e.kind = 'holiday' and e.day = g::date
        and (e.class_id is null or e.class_id = c.id))
  union all
  select c.id, e.day, true
  from public.calendar_events e
  join public.classes c
    on c.id = e.class_id
    or (e.class_id is null and e.day between c.start_date and c.end_date)
  where e.kind = 'makeup'
),
class_days as (
  select class_id, day, bool_or(is_makeup) as is_makeup
  from raw_days group by class_id, day
),
base as (
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
      when s.id is not null and lv.id is not null then 'covered'
      when s.id is not null                       then 'swapped'
      when tb.teacher_id is null                  then 'unassigned'
      when lv.id is not null                      then 'uncovered'
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
    on s.class_id = d.class_id and s.day = d.day
)
select b.*, a.assistant_ids, a.absent_assistant_ids
from base b
left join lateral (
  select
    coalesce(array_agg(x.teacher_id order by x.teacher_id) filter (where not x.on_leave), '{}') as assistant_ids,
    coalesce(array_agg(x.teacher_id order by x.teacher_id) filter (where x.on_leave), '{}')     as absent_assistant_ids
  from (
    select ca.teacher_id,
           exists (select 1 from public.leaves l
                   where l.teacher_id = ca.teacher_id and b.day between l.start_date and l.end_date) as on_leave
    from public.class_assistants ca
    where ca.class_id = b.class_id and b.day between ca.start_date and ca.end_date
      and ca.teacher_id is distinct from b.actual_teacher_id
  ) x
) a on true;
