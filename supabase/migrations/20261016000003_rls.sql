-- 課務排程：權限
-- 只有 staff 白名單裡的 email 登入後可以讀寫；沒登入（anon）什麼都看不到。

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.staff
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.locations        enable row level security;
alter table public.teachers         enable row level security;
alter table public.classes          enable row level security;
alter table public.teaching_blocks  enable row level security;
alter table public.leaves           enable row level security;
alter table public.substitutions    enable row level security;
alter table public.calendar_events  enable row level security;
alter table public.staff            enable row level security;

create policy staff_all on public.locations       for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.teachers        for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.classes         for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.teaching_blocks for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.leaves          for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.substitutions   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy staff_all on public.calendar_events for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 白名單本身：登入者只看得到自己那筆（用來判斷有沒有權限），新增請在 Supabase SQL Editor 做
create policy staff_self on public.staff for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

revoke all on all tables in schema public from anon;
revoke execute on function public.register_leave(bigint, date, date, text, text, jsonb) from anon, public;
revoke execute on function public.teacher_day_status(date) from anon, public;
grant execute on function public.register_leave(bigint, date, date, text, text, jsonb) to authenticated;
grant execute on function public.teacher_day_status(date) to authenticated;
