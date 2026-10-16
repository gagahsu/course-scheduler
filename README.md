# 課務排程

台南／高雄多班的排課、老師請假、代課安排。
前端是純靜態網頁（部署在 Render），資料、登入、權限都在 Supabase。

```
瀏覽器 ──► Render 靜態網站（web/）
              │  supabase-js（anon key）
              ▼
          Supabase：Postgres + Auth + Row Level Security
```

## 功能

| 頁面 | 內容 |
|---|---|
| 行事曆 `index.html` | 月檢視、台南／高雄切換、每班一條色塊（顏色＝老師）、請假與代課標示、今日上課、本月請假、待處理清單、老師本月負荷。**不用登入也能看**（唯讀：不顯示假別、備註、待處理、負荷，色塊不能點），右上角「管理員登入」 |
| 班級 `class.html` | 班級列表（編輯、刪除）；班級詳情含授課老師時間軸、排課／套用課表範本（新增班級後自動打開）、授課區段增修（選老師自動帶出他會教的課）、調整上課老師（單日或區間，自動比對誰有空；可讓別班老師來代課，同時指定誰接手他原本的班）、補課／活動 |
| 請假紀錄 `leave.html` | 老師 × 日期的請假總覽、請假紀錄、登記請假（列出受影響的課，逐堂或一次指定代課老師） |
| 基本資料 `admin.html` | 老師（會教的課、顏色、可否代課、停用、刪除）、課程（預設天數、授課老師）、課表範本 |
| 假日設定 `holidays.html` | 依年份管理全體停課日（國定假日、補假、颱風假）與全體補班日；一鍵匯入人事行政總處行事曆（停課日預設全勾、補班日預設不勾），可編輯、刪除，列出每天影響幾個班 |

規則寫在資料庫裡，不管從哪裡寫入都會檢查：

- 同一班同一時間只能有一位主授老師；需要多位老師同時在場時，其他人加成「助教」（同一天可以多位，助教請假自動標示缺席、不需代課）
- 同一位老師同一天出現在兩個班（主授、代課、助教都算）會列在行事曆「待處理」
- 同一位老師的請假不能重疊
- 代課老師當天不能請假、不能已經在別班上課，日期必須是該班上課日
- 請假＋代課用 `register_leave()` 一次寫入，任何一筆不合法就整筆取消
- 區間調整用 `assign_range()`：例如 A 班老師請假、B 班老師去代課、C 老師接手 B 班，一個交易內完成，任何一天不合法就整筆取消

## 資料結構

| 資料表 | 用途 |
|---|---|
| `locations` | 台南、高雄 |
| `teachers` | 老師（含可代課的主管，例如張總） |
| `classes` | 班級：地點、教室、開訓／結訓日 |
| `teaching_blocks` | 授課區段：某段期間由誰負責這個班 |
| `class_assistants` | 助教／協同老師：某段期間（可以只有一天）另外需要誰一起在場，同一天可多位 |
| `leaves` | 請假 |
| `substitutions` | 代課：每個「班級＋日期」最多一筆 |
| `calendar_events` | 停課日（holiday）、補課日（makeup，可以是週末；不指定班級＝全體補班）、活動標註（event） |
| `courses` | 課程與預設天數 |
| `teacher_courses` | 老師會教哪些課 |
| `curricula` / `curriculum_items` | 課表範本：依序上哪些課、各幾天、預設誰教 |
| `staff` | 可以登入的 email 白名單 |

`apply_plan()` 把一串「老師＋課程＋天數」依班級的上課日（扣停課日、含補課日）依序排成授課區段，整批寫入。

核心是 `v_sessions` 檢視表：把每個班的每個上課日展開成一列（平日 − 停課日 ＋ 補課日），算出原定老師、是否請假、代課老師、實際上課老師、在場助教（`assistant_ids`）與狀態（normal / covered / uncovered / swapped / unassigned）。行事曆、請假影響、衝突檢查都從這裡讀。

## 部署

### 1. Supabase

1. 到 [supabase.com](https://supabase.com) 建立專案（Region 選 Northeast Asia (Tokyo) 或 Southeast Asia (Singapore)）。
2. **SQL Editor** 依序貼上執行：
   - `supabase/migrations/20261016000001_tables.sql`
   - `supabase/migrations/20261016000002_views_and_functions.sql`
   - `supabase/migrations/20261016000003_rls.sql`
   - `supabase/migrations/20261016000004_courses.sql`（課程、課表範本、自動排課）
   - `supabase/migrations/20261016000005_assistants.sql`（助教／協同老師：同一天多位老師在場）
   - `supabase/migrations/20261016000006_assign_range.sql`（區間調整老師、連鎖代課）
   - `supabase/migrations/20261016000007_public_calendar.sql`（公開行事曆：未登入可唯讀）
   - `supabase/migrations/20261016000008_global_makeup.sql`（全體補班日：不指定班級的補課＝所有開課中的班都上）
   - `supabase/seed.sql`（範例資料；**先把最上面的 `you@example.com` 改成你的 email**）

   有裝 Supabase CLI 的話也可以 `supabase link` 後 `supabase db push`，再到 SQL Editor 跑 seed。
3. **Authentication → Sign In / Providers**：關掉 *Allow new users to sign up*（只讓你建的帳號登入）。
4. **Authentication → Users → Add user → Create new user**：輸入 email、密碼，勾 *Auto Confirm User*。
   每個要登入的人都要：(a) 在這裡建帳號，(b) email 加進 `staff` 資料表：
   ```sql
   insert into public.staff (email, name) values ('someone@example.com', '某某');
   ```
5. **Project Settings → API**：記下 *Project URL* 和 *anon public* key。

### 2. 設定前端

編輯 `web/js/config.js`：

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

anon key 是公開的，可以直接提交到 repo。沒登入的人只讀得到行事曆需要的欄位（班級、老師、授課區段、停課／補課、請假日期、代課老師），讀不到假別、各種備註、白名單，也不能寫入；其他頁面與寫入只有 `staff` 裡的人可以用。

### 3. Render

1. 把整個資料夾推到 GitHub。
2. Render → **New → Blueprint** → 選這個 repo，會讀 `render.yaml` 建立靜態網站。
   （或 **New → Static Site**，Publish directory 填 `web`，Build command 留空。）
3. 部署完成後打開網址，用剛建的帳號登入。
4. 回 Supabase **Authentication → URL Configuration**，把 *Site URL* 設成 Render 網址（之後要做「忘記密碼」才用得到）。

### 本機預覽

不需要 build，任何靜態伺服器都可以：

```bash
cd web && npx serve -l 8000     # 或 python3 -m http.server 8000
# 打開 http://localhost:8000
```

`web/serve.json` 關掉了 serve 的 clean URLs；不關的話 `class.html?id=5` 會被轉到 `/class`，網址參數會不見。

## 注意

- Supabase 免費方案的專案 **7 天沒有任何請求會暫停**，到後台按 Restore 就好；每天有人用就不會發生。
- 國定假日請到「假日設定」選年份按「匯入」（資料來自人事行政總處行事曆，經 ruyut/TaiwanCalendar 整理；隔年的通常 6 月左右公布）。颱風假等臨時停班要自己新增；週六補班日匯入時預設不勾，班級也要跟著補課才勾。只停某一班的日子請在該班頁面新增「停課」。
- 範例資料中有幾筆是依白板與請假訊息推測的，請確認：
  - Java ② 10/5–11/16 的授課老師（設為董哥）
  - 嘎嘎 10/27 的請假（當天沒排課，所以沒有代課紀錄，會出現在「待處理」）
  - Java ① 的授課老師（未指派）、Java ③ 的教室
