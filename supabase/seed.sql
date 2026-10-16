-- 範例資料：白板上的 115 年上 / 下 Java 班，加上董哥、嘎嘎的請假訊息
-- 在 Supabase SQL Editor 執行一次即可（重跑前先清空資料表）

-- ★ 改成你自己登入用的 email（可以放多個）
insert into public.staff (email, name) values
  ('admin@csr.dev', '管理員');

insert into public.locations (id, name) values (1, '台南'), (2, '高雄');

insert into public.teachers (name, short_name, color, can_substitute) values
  ('湘吟',   '湘吟', '#2B8CC4', true),
  ('董哥', '董', '#5868E0', true),
  ('倫哥', '倫', '#D97A0B', true),
  ('男哥', '男', '#2F9461', true),
  ('嘎嘎', '嘎', '#9461D6', true),
  ('張總', '張', '#C7417A', true);

insert into public.classes (name, term, location_id, room, start_date, end_date) values
  ('Java ②', '115年上', 1, '南台 1104', '2026-06-24', '2026-11-16'),
  ('Java ③', '115年下', 2, '高軟',      '2026-09-14', '2027-02-17');

-- 授課區段
insert into public.teaching_blocks (class_id, teacher_id, start_date, end_date)
select c.id, t.id, b.s::date, b.e::date
from (values
  ('Java ②', '湘吟',   '2026-07-20', '2026-08-07'),
  ('Java ②', '董哥', '2026-08-10', '2026-09-04'),
  ('Java ②', '倫哥', '2026-09-07', '2026-10-02'),
  ('Java ②', '董哥', '2026-10-05', '2026-11-16'),   -- 白板綠字，依請假訊息判斷為董哥
  ('Java ③', '湘吟',   '2026-09-14', '2026-10-02'),
  ('Java ③', '男哥', '2026-10-05', '2026-10-30'),
  ('Java ③', '嘎嘎', '2026-11-02', '2027-02-17')
) as b(cls, tch, s, e)
join public.classes  c on c.name = b.cls
join public.teachers t on t.name = b.tch;

-- 補課日與活動
insert into public.calendar_events (class_id, day, kind, title)
select c.id, e.d::date, e.k, e.t
from (values
  ('Java ②', '2026-08-30', 'makeup', '補課（週日）'),
  ('Java ②', '2026-09-26', 'makeup', '颱風補課（週六）'),
  ('Java ①', '2026-09-09', 'event',  '履歷健檢（20 人）')
) as e(cls, d, k, t)
join public.classes c on c.name = e.cls;

-- 國定假日（全部班級停課）：依人事行政總處行事曆自行補上，例如
-- insert into public.calendar_events (class_id, day, kind, title) values (null, '2027-01-01', 'holiday', '元旦');

-- 請假＋代課（用 register_leave，代課規則會一起檢查）
do $$
declare
  dong  bigint := (select id from public.teachers where name = '董哥');
  gaga  bigint := (select id from public.teachers where name = '嘎嘎');
  lun   bigint := (select id from public.teachers where name = '倫哥');
  zhang bigint := (select id from public.teachers where name = '張總');
  j2    bigint := (select id from public.classes where name = 'Java ②');
  j3    bigint := (select id from public.classes where name = 'Java ③');
begin
  -- 董哥：10/21、22、23 請假，倫哥到南台代課
  perform public.register_leave(dong, '2026-10-21', '2026-10-23', '其他', null,
    jsonb_build_array(
      jsonb_build_object('class_id', j2, 'day', '2026-10-21', 'sub_teacher_id', lun),
      jsonb_build_object('class_id', j2, 'day', '2026-10-22', 'sub_teacher_id', lun),
      jsonb_build_object('class_id', j2, 'day', '2026-10-23', 'sub_teacher_id', lun)));

  -- 董哥：10/27 請假，張總代課
  perform public.register_leave(dong, '2026-10-27', '2026-10-27', '其他', null,
    jsonb_build_array(
      jsonb_build_object('class_id', j2, 'day', '2026-10-27', 'sub_teacher_id', zhang)));

  -- 嘎嘎：11/02 請假，倫哥代課（高雄 Java ③）
  perform public.register_leave(gaga, '2026-11-02', '2026-11-02', '其他', null,
    jsonb_build_array(
      jsonb_build_object('class_id', j3, 'day', '2026-11-02', 'sub_teacher_id', lun)));
end $$;
