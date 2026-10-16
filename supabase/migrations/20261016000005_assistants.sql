-- 課務排程：助教／協同老師
-- 主授老師仍然是 teaching_blocks（同一班同一時間只有一位）；
-- class_assistants 記錄「某段期間（可以只有一天）另外需要哪些老師一起在場」，同一天可以有多位。
-- 助教請假時當天自動視為缺席，不需要安排代課；助教也會算進「當天在哪裡上課」的衝突檢查。

create table public.class_assistants (
  id          bigint generated always as identity primary key,
  class_id    bigint not null references public.classes on delete cascade,
  teacher_id  bigint not null references public.teachers,
  start_date  date not null,
  end_date    date not null,
  note        text,                              -- 例如：上機實作助教、專題指導
  created_at  timestamptz not null default now(),
  check (end_date >= start_date),
  -- 同一位老師在同一班的助教期間不能重疊
  constraint class_assistants_no_overlap
    exclude using gist (class_id with =, teacher_id with =, daterange(start_date, end_date, '[]') with &&)
);
create index on public.class_assistants (teacher_id);

-- v_sessions 在最後加兩欄：
--   assistant_ids        當天在場的助教（已扣掉請假、也扣掉當天剛好是主授／代課的人）
--   absent_assistant_ids 排了助教但當天請假的人
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
  select e.class_id, e.day, true
  from public.calendar_events e
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

-- 每位老師每天實際在哪個班：主授（含代課）＋助教
create or replace view public.v_presence
with (security_invoker = true) as
select v.day, v.class_id, v.class_name, v.location_name, v.actual_teacher_id as teacher_id, 'lead'::text as role
from public.v_sessions v
where v.actual_teacher_id is not null
union all
select v.day, v.class_id, v.class_name, v.location_name, a.teacher_id, 'assistant'
from public.v_sessions v
cross join lateral unnest(v.assistant_ids) as a(teacher_id);

-- 衝突：同一位老師同一天出現在兩個班（不論主授或助教）
create or replace view public.v_teacher_conflicts
with (security_invoker = true) as
select day, teacher_id,
       array_agg(class_id order by class_id)   as class_ids,
       array_agg(class_name order by class_id) as class_names
from public.v_presence
group by day, teacher_id
having count(*) > 1;

-- 老師當天狀態：助教也算忙碌（班名後面標「助教」）
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
    select p.class_id,
           p.class_name || case when p.role = 'assistant' then '（助教）' else '' end as class_name,
           p.location_name
    from public.v_presence p
    where p.day = p_day and p.teacher_id = t.id
    order by (p.role = 'lead') desc, p.class_id limit 1
  ) s on true
  where t.active
  order by t.id;
$$;

-- 代課檢查：代課老師不能已經在別班上課或當助教（同一班的助教可以直接升為代課）
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

  select p.location_name || ' ' || p.class_name || case when p.role = 'assistant' then '（助教）' else '' end
    into v_busy
  from public.v_presence p
  where p.day = new.day and p.class_id <> new.class_id
    and p.teacher_id = new.sub_teacher_id
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

-- 助教檢查：期間要在班級期間內、有上課日，而且不能是同期間的主授老師
create or replace function public.check_assistant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c public.classes%rowtype;
begin
  select * into c from public.classes where id = new.class_id;
  if new.start_date < c.start_date or new.end_date > c.end_date then
    raise exception '助教期間要在開訓日 % 到結訓日 % 之間', c.start_date, c.end_date using errcode = 'P0001';
  end if;
  if exists (select 1 from public.teaching_blocks tb
             where tb.class_id = new.class_id and tb.teacher_id = new.teacher_id
               and daterange(tb.start_date, tb.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception '這位老師在這段期間已經是這個班的主授老師' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger class_assistants_check
before insert or update on public.class_assistants
for each row execute function public.check_assistant();

-- 權限
alter table public.class_assistants enable row level security;
create policy staff_all on public.class_assistants for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.class_assistants, public.v_presence from anon;
