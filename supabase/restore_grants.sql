-- 課務排程：還原備份後補回權限
--
-- 用途：DBeaver Backup 勾了「Do not backup privileges」，dump 檔裡沒有 GRANT／REVOKE。
--      還原到新的 Supabase 專案後，anon（未登入訪客）會拿到 Supabase 預設的全部權限，
--      公開行事曆的欄位限制、function 的執行限制都會消失。這支檔案把權限恢復成 migrations 001–008 跑完的狀態。
--
-- 什麼時候跑：還原 dump 檔之後、上線之前，在 Supabase SQL Editor 整份貼上執行一次。可以重複執行。
-- 內容來源：migrations 003、004、005、006、007 裡的 grant／revoke（照原本順序合併）。

begin;

-- ---------- 1. 先把訪客的資料表權限全部收回 ----------
-- 003 + 004 + 005：還原時所有資料表與 view 是一起建的，一次全部收回即可
revoke all on all tables in schema public from anon;

-- ---------- 2. 只給登入者執行的 function ----------
-- 003
revoke execute on function public.register_leave(bigint, date, date, text, text, jsonb) from anon, public;
revoke execute on function public.teacher_day_status(date) from anon, public;
grant execute on function public.register_leave(bigint, date, date, text, text, jsonb) to authenticated;
grant execute on function public.teacher_day_status(date) to authenticated;
-- 004
revoke execute on function public.save_curriculum(bigint, text, text, jsonb) from anon, public;
revoke execute on function public.apply_plan(bigint, jsonb, boolean) from anon, public;
grant execute on function public.save_curriculum(bigint, text, text, jsonb) to authenticated;
grant execute on function public.apply_plan(bigint, jsonb, boolean) to authenticated;
-- 006
revoke execute on function public.assign_range(bigint, date, date, bigint, bigint, text) from anon, public;
grant execute on function public.assign_range(bigint, date, date, bigint, bigint, text) to authenticated;

-- ---------- 3. 公開行事曆：訪客只能讀行事曆用得到的欄位（007） ----------
-- 請假的假別與備註、代課備註、班級備註、助教備註不公開
grant usage on schema public to anon;

grant select on public.locations, public.teachers, public.calendar_events, public.teaching_blocks to anon;
grant select (id, name, term, location_id, room, start_date, end_date) on public.classes to anon;
grant select (id, teacher_id, start_date, end_date)                     on public.leaves to anon;
grant select (id, leave_id, class_id, day, sub_teacher_id)              on public.substitutions to anon;
grant select (id, class_id, teacher_id, start_date, end_date)           on public.class_assistants to anon;
grant select on public.v_sessions to anon;

commit;

-- ---------- 檢查（可選）：列出 anon 現在能讀哪些資料表／欄位 ----------
-- 預期：locations、teachers、calendar_events、teaching_blocks、v_sessions 整表；
--       classes、leaves、substitutions、class_assistants 只有上面列的欄位；其他表都沒有。
-- select table_name, string_agg(column_name, ', ' order by column_name) as columns
-- from information_schema.column_privileges
-- where grantee = 'anon' and table_schema = 'public' and privilege_type = 'SELECT'
-- group by table_name order by table_name;
