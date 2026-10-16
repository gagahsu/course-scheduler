-- 課務排程：區間調整老師（含連鎖代課）
-- 例：A 班老師 10/23–10/27 請假，改由 B 班老師去 A 班代課，再找 C 老師去上 B 班。
-- assign_range() 在同一個交易裡：
--   1. 代課老師那幾天如果在別班當主授（或代課），先把那班改由 p_backfill_id 接手
--   2. 再把這個班那幾天改由代課老師上課
-- 任何一天不合法（請假、已在別處上課…）就整筆取消。
-- 代課老師本來就是原定老師的那幾天（沒請假）＝取消代課、恢復原定。

create or replace function public.assign_range(
  p_class_id     bigint,
  p_from         date,
  p_to           date,
  p_teacher_id   bigint,
  p_backfill_id  bigint default null,
  p_note         text   default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s          record;
  o          record;
  v_days     int := 0;
  v_back     int := 0;
  v_skipped  int := 0;
begin
  if p_to < p_from then
    raise exception '結束日不能早於開始日' using errcode = 'P0001';
  end if;
  if p_backfill_id = p_teacher_id then
    raise exception '接手的老師不能和代課老師同一人' using errcode = 'P0001';
  end if;

  for s in
    select * from public.v_sessions
    where class_id = p_class_id and day between p_from and p_to
    order by day
  loop
    if s.status = 'unassigned' then
      v_skipped := v_skipped + 1;          -- 還沒有主授老師的日子不動
      continue;
    end if;
    continue when s.actual_teacher_id = p_teacher_id;

    -- 先放掉這班這天原本的代課人（兩人對調時，他才能去接手別班）
    delete from public.substitutions where id = s.substitution_id;

    -- 代課老師當天在別班上課 → 那班改由接手老師上
    for o in
      select * from public.v_sessions
      where day = s.day and class_id <> p_class_id and actual_teacher_id = p_teacher_id
    loop
      if p_backfill_id is null then
        raise exception '% % 在 % % 上課，請指定誰去接手那個班', to_char(o.day, 'MM/DD'),
          (select name from public.teachers where id = p_teacher_id), o.location_name, o.class_name
          using errcode = 'P0001';
      end if;
      if p_backfill_id = o.planned_teacher_id and o.leave_id is null then
        delete from public.substitutions where id = o.substitution_id;   -- 接手的就是那班原定老師
      elsif o.substitution_id is not null then
        update public.substitutions set sub_teacher_id = p_backfill_id, note = coalesce(p_note, note)
        where id = o.substitution_id;
      else
        insert into public.substitutions (leave_id, class_id, day, sub_teacher_id, note)
        values (o.leave_id, o.class_id, o.day, p_backfill_id, p_note);
      end if;
      v_back := v_back + 1;
    end loop;

    -- 指定的就是原定老師（沒請假）＝ 上面刪掉代課就恢復了；否則新增代課
    if not (s.planned_teacher_id = p_teacher_id and s.leave_id is null) then
      insert into public.substitutions (leave_id, class_id, day, sub_teacher_id, note)
      values (s.leave_id, s.class_id, s.day, p_teacher_id, p_note);
    end if;
    v_days := v_days + 1;
  end loop;

  return jsonb_build_object('days', v_days, 'backfilled', v_back, 'skipped', v_skipped);
end;
$$;

revoke execute on function public.assign_range(bigint, date, date, bigint, bigint, text) from anon, public;
grant execute on function public.assign_range(bigint, date, date, bigint, bigint, text) to authenticated;
