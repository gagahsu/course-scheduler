-- 課務排程：公開行事曆（不用登入就能看首頁行事曆，唯讀）
-- 只開放行事曆用得到的欄位；請假的假別與備註、代課備註、班級備註、助教備註不公開。
-- 寫入、班級頁、請假頁、基本資料仍然只有 staff 白名單可以用。

grant usage on schema public to anon;

grant select on public.locations, public.teachers, public.calendar_events, public.teaching_blocks to anon;
grant select (id, name, term, location_id, room, start_date, end_date) on public.classes to anon;
grant select (id, teacher_id, start_date, end_date)                     on public.leaves to anon;
grant select (id, leave_id, class_id, day, sub_teacher_id)              on public.substitutions to anon;
grant select (id, class_id, teacher_id, start_date, end_date)           on public.class_assistants to anon;
grant select on public.v_sessions to anon;

create policy public_read on public.locations        for select to anon using (true);
create policy public_read on public.teachers         for select to anon using (true);
create policy public_read on public.classes          for select to anon using (true);
create policy public_read on public.teaching_blocks  for select to anon using (true);
create policy public_read on public.leaves           for select to anon using (true);
create policy public_read on public.substitutions    for select to anon using (true);
create policy public_read on public.calendar_events  for select to anon using (true);
create policy public_read on public.class_assistants for select to anon using (true);
