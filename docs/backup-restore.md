# 備份與還原

把 Supabase 的資料完整備份下來，以及還原到新的 Supabase 專案（換專案、搬區域、上線前留底）。

備份分三份，缺一不可：

| 檔案 | 內容 | 怎麼還原 |
|---|---|---|
| `dump-postgres-<時間>.sql` | public schema：資料表、view、function、trigger、RLS policy、所有資料 | psql |
| `restore_grants.sql`（已在 repo 裡） | 權限：訪客能讀哪些欄位、哪些 function 只有登入者能執行 | SQL Editor |
| `auth_data.sql` | 登入帳號：`auth.users`、`auth.identities` 的資料（含密碼雜湊） | psql |

> **備份檔放在 `supabase/backup/`，這個資料夾已被 `.gitignore` 排除。** 裡面有老師資料、email 和密碼雜湊，只能放在本機或私人雲端，不要 commit、不要外傳。

## 事前準備

### 連線資訊

Supabase Dashboard → 上方 **Connect** → **Session pooler**（支援 IPv4）：

```
postgresql://postgres.<project-ref>:<資料庫密碼>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

忘記資料庫密碼：Project Settings → Database → Reset database password。

### PostgreSQL 用戶端（pg_dump／psql）

版本要 **≥ Supabase 的 Postgres 版本**（目前是 17），否則會出現 `server version mismatch`：

```powershell
winget install PostgreSQL.PostgreSQL.17
# 把 C:\Program Files\PostgreSQL\17\bin 加進 PATH
```

## 備份

### 方法 A：pg_dump 指令（推薦，一次產生三份裡的兩份）

```powershell
cd C:\Users\yunch\Documents\GitHub\course-scheduler
$DB = "<上面的 session pooler 連線字串>"
$T  = Get-Date -Format yyyyMMddHHmm

# 1. public schema 的結構＋資料；不含 owner 與權限（權限由 restore_grants.sql 補）
pg_dump $DB --schema=public --no-owner --no-privileges -f "supabase/backup/dump-postgres-$T.sql"

# 2. 登入帳號，只要資料。pg_dump 會依 FK 排序，users 會在 identities 前面
pg_dump $DB --data-only --table=auth.users --table=auth.identities -f "supabase/backup/auth_data-$T.sql"
```

### 方法 B：DBeaver

1. 新增 PostgreSQL 連線：Host、Port、Database、Username（`postgres.<project-ref>`）、Password 照連線字串拆開填；SSL 分頁勾 Use SSL、mode 選 `require`。
2. **public**：左側 Schemas → `public` 右鍵 → Tools → Backup
   - Format：Plain
   - 勾 **Discard objects owner**、**Do not backup privileges**
   - 第一次會要求設定 Local client，指到 `C:\Program Files\PostgreSQL\17\bin`
3. **登入帳號**：Schemas → `auth` → Tables，選 `users`、`identities` → Tools → Backup。
   DBeaver 會連表結構一起備份，還原前要先整理成只有資料的 `auth_data.sql`（見下面「整理 DBeaver 的 auth 備份」）。

### 檢查備份是否完整

```powershell
$F = "supabase/backup/dump-postgres-<時間>.sql"
Select-String $F -Pattern "dump complete"            # 有這行＝沒有被截斷
Select-String $F -Pattern "^COPY public\." | Measure-Object   # 應該是 13（13 張資料表）
Select-String $F -Pattern "Type: (VIEW|FUNCTION);" | Measure-Object   # 4 個 view＋8 個 function＝12
```

## 還原

前提：新的 Supabase 專案剛建好、public schema 是空的（**不要**先跑 migrations 或 seed，dump 裡已經有結構）。

### 1. 還原 public schema

dump 檔開頭有兩行要先刪掉：新專案本來就有 public schema，`CREATE SCHEMA` 會報 `already exists`；`COMMENT ON SCHEMA` 可能因為不是 schema owner 而失敗，而且也不需要。

```sql
CREATE SCHEMA public;                                      -- ← 刪掉
COMMENT ON SCHEMA public IS 'standard public schema';      -- ← 刪掉
```

然後用 psql 執行（**不能貼到 SQL Editor**，資料是 `COPY … FROM stdin` 格式，SQL Editor 不支援）：

```powershell
$NEW = "<新專案的 session pooler 連線字串>"
psql $NEW -v ON_ERROR_STOP=1 -f "supabase/backup/dump-postgres-<時間>.sql"
```

`ON_ERROR_STOP=1` 讓 psql 遇到錯誤就停；修正後建議重開一個新專案再來一次，比較乾淨。

### 2. 補回權限

dump 不含權限，還原後 anon（未登入訪客）會拿到 Supabase 預設的全部權限：可以讀請假備註、可以呼叫寫入用的 function。**上線前一定要做這步。**

到新專案 **SQL Editor** 貼上 `supabase/restore_grants.sql` 整份執行（可重複執行）。

檢查：把檔案最後被註解掉的查詢拿出來跑，anon 應該只能讀 `locations`、`teachers`、`calendar_events`、`teaching_blocks`、`v_sessions` 整表，以及 `classes`、`leaves`、`substitutions`、`class_assistants` 的部分欄位。

### 3. 還原登入帳號

```powershell
psql $NEW -v ON_ERROR_STOP=1 -f "supabase/backup/auth_data-<時間>.sql"
```

帳號的 UUID 和密碼都會沿用，原本的密碼可以直接登入；`leaves.created_by` 等欄位也對得上。

若出現 `column ... does not exist`：新專案的 Auth 版本欄位不同。改用 Dashboard → Authentication → Users → Add user 重建帳號（勾 Auto Confirm User），email 要跟 `staff` 資料表一致。

### 4. 收尾

1. Authentication → Sign In / Providers：關掉 *Allow new users to sign up*。
2. Authentication → URL Configuration：*Site URL* 設成 Render 網址。
3. Project Settings → API：拿新的 *Project URL*、*anon public* key，更新 `web/js/config.js`，commit 後 Render 會自動重新部署。
4. 打開網站：
   - 未登入：行事曆看得到，但看不到假別、備註、待處理、負荷
   - 登入：各頁資料都在，可以新增／修改

## 整理 DBeaver 的 auth 備份

DBeaver 備份 `auth.users`、`auth.identities` 時會連 `CREATE TABLE`、索引一起匯出，新專案這些都已存在，整份執行會失敗；而且檔案裡 identities 排在 users 前面，會被 FK 擋下。

只保留兩段資料，並把 users 移到前面：

```sql
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

BEGIN;

COPY auth.users (...) FROM stdin;      -- 從這行
...
\.                                     -- 到這行（整段複製）

COPY auth.identities (...) FROM stdin;
...
\.

COMMIT;
```

複製時保留每行原本的 Tab 分隔，不要用會把 Tab 轉成空白的編輯器。用方法 A 的 pg_dump 指令備份就不需要這一步。
