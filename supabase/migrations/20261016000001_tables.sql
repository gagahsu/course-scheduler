-- 課務排程：資料表
create extension if not exists btree_gist;

-- 地點：台南、高雄
create table public.locations (
  id    smallint primary key,
  name  text not null unique
);

-- 老師（含可代課的主管，例如張總）
create table public.teachers (
  id              bigint generated always as identity primary key,
  name            text not null unique,          -- 平常怎麼稱呼就怎麼存：董哥、嘎嘎、張總
  short_name      text not null,                 -- 行事曆上的頭像字：董、嘎、張
  color           text not null default '#2B8CC4',
  can_substitute  boolean not null default true,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- 班級
create table public.classes (
  id           bigint generated always as identity primary key,
  name         text not null,                    -- Java ③
  term         text,                             -- 115年下
  location_id  smallint not null references public.locations,
  room         text,                             -- 南台 1104
  start_date   date not null,
  end_date     date not null,
  note         text,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);

-- 授課區段：某段期間由誰負責這個班（白板上「湘 9/14–10/2」那種）
create table public.teaching_blocks (
  id          bigint generated always as identity primary key,
  class_id    bigint not null references public.classes on delete cascade,
  teacher_id  bigint not null references public.teachers,
  start_date  date not null,
  end_date    date not null,
  check (end_date >= start_date),
  -- 同一班同一時間只能有一位主授老師
  constraint teaching_blocks_no_overlap
    exclude using gist (class_id with =, daterange(start_date, end_date, '[]') with &&)
);
create index on public.teaching_blocks (teacher_id);

-- 請假
create table public.leaves (
  id          bigint generated always as identity primary key,
  teacher_id  bigint not null references public.teachers,
  start_date  date not null,
  end_date    date not null,
  type        text not null default '事假' check (type in ('事假','病假','特休','公假','其他')),
  note        text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  check (end_date >= start_date),
  -- 同一位老師的請假期間不能重疊
  constraint leaves_no_overlap
    exclude using gist (teacher_id with =, daterange(start_date, end_date, '[]') with &&)
);
create index on public.leaves (teacher_id, start_date, end_date);

-- 代課 / 換課：每個「班級＋日期」最多一筆
-- leave_id 有值 = 因請假而代課；null = 單純換人上一天
create table public.substitutions (
  id              bigint generated always as identity primary key,
  leave_id        bigint references public.leaves on delete cascade,
  class_id        bigint not null references public.classes on delete cascade,
  day             date not null,
  sub_teacher_id  bigint not null references public.teachers,
  note            text,
  created_at      timestamptz not null default now(),
  unique (class_id, day)
);
create index on public.substitutions (sub_teacher_id, day);

-- 行事曆事件：國定假日、補課日、活動
--   holiday : 不上課（class_id null = 全部班級）
--   makeup  : 額外上課日（例如週六颱風補課），必須指定班級
--   event   : 只是標註（履歷健檢），不影響上課
create table public.calendar_events (
  id        bigint generated always as identity primary key,
  class_id  bigint references public.classes on delete cascade,
  day       date not null,
  kind      text not null check (kind in ('holiday','makeup','event')),
  title     text not null,
  check (kind <> 'makeup' or class_id is not null)
);
create index on public.calendar_events (day);

-- 可以登入後台的人（email 白名單）
create table public.staff (
  email  text primary key,
  name   text
);
