// 使用導覽：第一次登入先介紹整個系統，之後每個頁面第一次打開時再介紹該頁
// 看過的紀錄存在瀏覽器（localStorage），換電腦或清除資料會再出現一次；頁首「使用導覽」可隨時重看
const VER = 'v1';
const nav = (href) => `.nav a[href="${href}"]`;

// 每一步：sel（要框起來的元素，找不到就略過這步；沒有 sel＝置中顯示）、title、body
const INTRO = [
  { title: '歡迎使用課務排程', body: '這套系統用來管理台南／高雄各班的排課、老師請假與代課安排。<br>花一分鐘帶你認識各個頁面。' },
  { sel: nav('admin.html'), title: '① 基本資料', body: '第一次使用從這裡開始：建立<strong>老師</strong>（顏色、會教的課、可否代課）、<strong>課程</strong>與<strong>課表範本</strong>。' },
  { sel: nav('holidays.html'), title: '② 假日設定', body: '一鍵匯入國定假日，設定全體停課日與補班日。排課時會自動跳過停課日、加上補班日。' },
  { sel: nav('class.html'), title: '③ 班級', body: '新增班級後套用課表範本，系統依上課日自動排出授課區段；之後可以在班級頁調整上課老師、加助教、補課。' },
  { sel: nav('leave.html'), title: '④ 請假紀錄', body: '登記老師請假，系統會列出受影響的課堂，並找出當天有空、可以代課的老師。' },
  { sel: nav('index.html'), title: '⑤ 行事曆', body: '每天打開看這裡：月曆上每班一條色塊（顏色＝老師），請假、代課、待處理事項一目了然。' },
  { sel: '#tourBtn', title: '隨時重看導覽', body: '忘記怎麼用時按這裡，可以重看本頁導覽或這份系統介紹。' },
  { title: '準備好了！', body: '建議順序：<strong>基本資料 → 假日設定 → 班級 → 行事曆／請假</strong>。<br>每個頁面第一次打開時，會再出現該頁的說明。' },
];

const PAGES = {
  'index.html': [
    { sel: '.split .main > .row', title: '切換月份', body: '左右箭頭切換月份，「今天」回到本月。右邊可以只看台南或高雄。' },
    { sel: '.split .main > .chips', title: '本月班級', body: '這個月有上課的班級，點一下進入該班的詳細頁面。' },
    { sel: '.cal', title: '月曆', body: '每班一條色塊，<strong>顏色代表上課老師</strong>。<br>斜紋＝請假已安排代課，紅色＝請假還沒人代課，虛線＝還沒指派老師。<br>點色塊會直接跳到該班當天，可以調整老師。' },
    { sel: '.legend', title: '圖例', body: '每位老師的顏色與各種狀態的樣式對照。' },
    { sel: '.side > .card', title: '今日上課', body: '今天每個班由誰上課、有沒有人請假或代課。' },
    { sel: '.card.warn', title: '待處理', body: '還沒安排代課、還沒指派老師、同一位老師同一天排在兩個班……都會列在這裡，點連結直接去處理。' },
    { sel: '.side > .card:last-child', title: '老師本月負荷', body: '每位老師這個月授課、助教、請假各幾天，方便平均分配。' },
  ],
  'class-list': [
    { sel: '#add', title: '新增班級', body: '填好地點、教室、開訓／結訓日後，會自動打開排課視窗，可以直接套用課表範本。' },
    { sel: '.class-card', title: '班級卡片', body: '依「上課中／即將開課／已結訓」分組。按「查看」進入班級頁排課、調整老師。' },
  ],
  'class-detail': [
    { sel: '.tiles', title: '班級概況', body: '上課期間、課程進度、目前授課老師，以及還有幾天沒指派老師。' },
    { sel: '.card:has(.tl)', title: '授課老師時間軸', body: '整個班從開訓到結訓，每段期間由誰教哪門課，請假、補課也會標在上面。' },
    { sel: '#tab-plan', title: '授課區段', body: '用「排課／套用範本」一次排好整個班，或「新增區段」逐段指定老師。助教／協同老師也在這裡加。' },
    { sel: '#tab-leave', title: '請假與代課', body: '老師請假或臨時換人時，在這裡選一天或一段期間，系統會比對誰有空來上課；也可以讓別班老師來代課，同時指定誰接手他原本的班。' },
    { sel: '#tab-events', title: '補課與活動', body: '只有這個班要補課、停課或標註活動的日子在這裡新增。全體放假請到「假日設定」。' },
    { sel: '#editClass', title: '編輯班級', body: '修改班級名稱、教室、開訓／結訓日，或刪除整個班。' },
  ],
  'leave.html': [
    { sel: '.tiles', title: '本月統計', body: '本月請假筆數、人天、受影響課堂與還沒安排代課的堂數。' },
    { sel: '.card:has(.lgrid)', title: '請假總覽', body: '老師 × 日期一覽：紅色是請假、淺色是有課、深色是去代別人的課。' },
    { sel: '#formCard', title: '登記請假', body: '選老師和日期，系統列出受影響的課與可代課的老師，可以逐堂或一次指定代課，送出後一起寫入。' },
    { sel: '.split .main > .card:nth-child(2)', title: '請假紀錄', body: '本月每筆請假的影響班級、代課老師與處理狀態，可以修改或刪除。' },
  ],
  'holidays.html': [
    { sel: '#import', title: '匯入國定假日', body: '從人事行政總處行事曆匯入這一年的假日。停課日預設全勾、補班日預設不勾，匯入前可以調整。' },
    { sel: '.split .main', title: '停課日', body: '所有班級都不上課的日子（國定假日、補假、颱風假）。照常上課的假日直接刪掉即可。' },
    { sel: '.split .side', title: '補班日', body: '週末額外上課的日子，當天所有開課中的班都會排課。只有某一班要補課，請到該班頁面新增。' },
  ],
  'admin.html': [
    { sel: '.card:has(#addT)', title: '老師', body: '設定老師的顏色（行事曆用）、會教的課、可不可以代課。離職的老師可以停用，保留歷史紀錄。' },
    { sel: '.card:has(#addC)', title: '課程', body: '課程名稱與預設天數，並指定哪些老師會教。排課時選老師會自動帶出他能教的課。' },
    { sel: '.card:has(#addP)', title: '課表範本', body: '一個班依序上哪些課、各幾天、預設誰教。新增班級後套用範本，就能自動排好整個班。' },
  ],
};

// ---------- 看過紀錄 ----------
let who = 'anon';
const key = (name) => `tour:${VER}:${who}:${name}`;
const seen = (name) => { try { return localStorage.getItem(key(name)) === '1'; } catch { return false; } };
const markSeen = (name) => { try { localStorage.setItem(key(name), '1'); } catch { /* 無痕模式之類的，忽略 */ } };

const pageKey = (active) => {
  if (active !== 'class.html') return active;
  return new URLSearchParams(location.search).get('id') ? 'class-detail' : 'class-list';
};

// boot() 登入後呼叫：掛上頁首按鈕，第一次來的話自動開導覽
export function initTour(active, email) {
  who = email || 'anon';
  const page = pageKey(active);
  document.getElementById('tourBtn')?.addEventListener('click', (e) => openMenu(e.currentTarget, page));
  (async () => {
    if (!seen('intro')) {
      await ready(null);
      await run(INTRO);
      markSeen('intro');
    }
    if (!seen(page) && PAGES[page]) {
      await ready(PAGES[page]);
      await run(PAGES[page]);
      markSeen(page);
    }
  })();
}

// 等頁面畫好（載入中消失、至少一個目標出現），也等自動打開的對話框關掉
function ready(steps) {
  const app = document.getElementById('app');
  const ok = () => !app.querySelector(':scope > .loading') && app.querySelector('main')
    && !document.querySelector('dialog[open]')
    && (!steps || steps.some((s) => s.sel && document.querySelector(s.sel)));
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (ok()) return resolve(true);
      // 10 秒內畫不好就照樣開始（找不到的步驟會被略過）；對話框開著就一直等
      if (Date.now() - t0 > 10000 && !document.querySelector('dialog[open]')) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

// ---------- 頁首選單 ----------
function openMenu(btn, page) {
  document.querySelector('.tour-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'tour-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = `${PAGES[page] ? '<button type="button" role="menuitem" data-k="page">本頁導覽</button>' : ''}
    <button type="button" role="menuitem" data-k="intro">系統介紹</button>`;
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.max(16, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 16))}px`;
  m.querySelector('button').focus();
  const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey); };
  const outside = (e) => { if (!m.contains(e.target) && e.target !== btn) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey);
  m.onclick = (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    close();
    run(k === 'intro' ? INTRO : PAGES[page]);
  };
}

// ---------- 導覽本體：一層遮罩＋框起目標＋說明卡 ----------
let running = false;
function run(all) {
  const steps = all.filter((s) => !s.sel || document.querySelector(s.sel));
  if (running || !steps.length) return Promise.resolve();
  running = true;
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML = `<div class="tour-hole" aria-hidden="true"></div>
      <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tourTitle" tabindex="-1">
        <div class="tour-step"></div>
        <h2 id="tourTitle"></h2>
        <div class="tour-body"></div>
        <div class="tour-actions">
          <button type="button" class="btn small" data-a="skip" style="margin-right:auto">略過</button>
          <button type="button" class="btn small" data-a="prev">上一步</button>
          <button type="button" class="btn small primary" data-a="next">下一步</button>
        </div>
      </div>`;
    document.body.append(root);
    const hole = root.querySelector('.tour-hole');
    const pop = root.querySelector('.tour-pop');
    const prevFocus = document.activeElement;
    let i = 0;

    const place = () => {
      const s = steps[i];
      const el = s.sel && document.querySelector(s.sel);
      const pad = 6, gap = 12, W = innerWidth, H = innerHeight;
      if (!el) {
        root.classList.add('center');
        hole.style.cssText = '';
        pop.style.left = `${Math.max(16, (W - pop.offsetWidth) / 2)}px`;
        pop.style.top = `${Math.max(16, (H - pop.offsetHeight) / 2)}px`;
        return;
      }
      root.classList.remove('center');
      const r = el.getBoundingClientRect();
      const top = Math.max(r.top - pad, 4), bottom = Math.min(r.bottom + pad, H - 4);
      hole.style.cssText = `left:${r.left - pad}px;top:${top}px;width:${r.width + pad * 2}px;height:${Math.max(bottom - top, 0)}px`;
      const ph = pop.offsetHeight, pw = pop.offsetWidth;
      let y = bottom + gap;
      if (y + ph > H - 16) y = top - gap - ph >= 16 ? top - gap - ph : Math.max(16, H - ph - 16);
      const x = Math.max(16, Math.min(r.left + r.width / 2 - pw / 2, W - pw - 16));
      pop.style.left = `${x}px`;
      pop.style.top = `${y}px`;
    };

    const show = () => {
      const s = steps[i];
      root.querySelector('.tour-step').textContent = `${i + 1} / ${steps.length}`;
      root.querySelector('#tourTitle').textContent = s.title;
      root.querySelector('.tour-body').innerHTML = s.body;
      root.querySelector('[data-a=prev]').hidden = i === 0;
      root.querySelector('[data-a=skip]').hidden = i === steps.length - 1;
      root.querySelector('[data-a=next]').textContent = i === steps.length - 1 ? '完成' : '下一步';
      const el = s.sel && document.querySelector(s.sel);
      // 太高的目標（例如月曆）捲到頂端，其他捲到中間
      if (el) el.scrollIntoView({ block: el.offsetHeight > innerHeight * 0.6 ? 'start' : 'center', behavior: 'instant' });
      place();
      pop.focus({ preventScroll: true });
    };

    const end = () => {
      removeEventListener('resize', place);
      removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', onKey, true);
      root.remove();
      running = false;
      prevFocus?.focus?.({ preventScroll: true });
      resolve();
    };
    const go = (d) => { const n = i + d; if (n < 0) return; if (n >= steps.length) return end(); i = n; show(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); end(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Tab') {   // 焦點留在說明卡裡
        const bs = [...pop.querySelectorAll('button:not([hidden])')];
        const k = bs.indexOf(document.activeElement);
        e.preventDefault();
        bs[(k + (e.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
      }
    };
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'skip') end(); else if (a === 'prev') go(-1); else if (a === 'next') go(1);
    });
    addEventListener('resize', place);
    addEventListener('scroll', place, true);
    document.addEventListener('keydown', onKey, true);
    show();
  });
}
