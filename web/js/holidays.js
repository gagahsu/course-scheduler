// 假日設定：全體停課日（國定假日、補假）與全體補班日，依年份管理
import * as api from './api.js';
import { boot } from './auth.js';
import { esc, parse, today, mdw, isWeekend, toast, formDialog, confirmDialog, qs } from './ui.js';

await boot('holidays.html');
const app = document.getElementById('app');
const state = { y: Number(qs('y')) || parse(today()).getFullYear() };
const classes = await api.listClasses();

render();

async function render() {
  const { y } = state;
  history.replaceState(null, '', `?y=${y}`);
  let events;
  try { events = await api.listEvents(`${y}-01-01`, `${y}-12-31`); } catch (e) { toast(e.message, true); return; }
  const global = events.filter((e) => e.class_id == null);
  const offs = global.filter((e) => e.kind === 'holiday');
  const works = global.filter((e) => e.kind === 'makeup');
  const kindOf = (e) => (e.title.startsWith('補假') ? ['補假', 'warn'] : ['停課', 'bad']);
  // 當天在開訓～結訓期間的班（停課／補班會影響到的）
  const hit = (day) => classes.filter((c) => day >= c.start_date && day <= c.end_date);

  const table = (list, empty, isWork) => list.length ? `<div class="scroll-x"><table class="tbl" style="min-width:520px">
    <thead><tr><th>日期</th><th>名稱</th><th>類型</th><th>影響班級</th><th><span hidden>操作</span></th></tr></thead>
    <tbody>${list.map((e) => {
      const [k, cls] = isWork ? ['補班', 'ok'] : kindOf(e);
      const cs = hit(e.day);
      const warn = !isWork && isWeekend(e.day) ? ' <span class="pill mute">週末</span>' : '';
      return `<tr${e.day < today() ? ' style="opacity:.6"' : ''}><td>${mdw(e.day)}${warn}</td><td class="wrap">${esc(e.title)}</td>
        <td><span class="pill ${cls}">${k}</span></td>
        <td class="wrap" style="font-size:13px;color:var(--text-2)" title="${esc(cs.map((c) => c.name).join('、'))}">${cs.length ? `${cs.length} 班` : '—'}</td>
        <td class="actions"><button class="btn small" data-edit="${e.id}">編輯</button></td></tr>`;
    }).join('')}</tbody></table></div>` : `<div class="empty">${empty}</div>`;

  app.innerHTML = `
  <main class="page">
    <div class="row">
      <div class="row" style="gap:6px">
        <button class="btn icon" id="prev" aria-label="前一年"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button class="btn icon" id="next" aria-label="下一年"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <h1 class="page-title">假日設定<small>${y} 年（民國 ${y - 1911} 年）</small></h1>
      <button class="btn primary" id="import" style="margin-left:auto">匯入 ${y} 年國定假日</button>
    </div>
    <div class="sub" style="margin-top:-8px">這裡設定的日子套用到<strong>所有班級</strong>。只停某一班、或只有某一班要補課，請到該班頁面的「補課與活動」新增。</div>

    <div class="tiles">
      <div class="tile"><div class="label">停課日（平日）</div><div class="value">${offs.filter((e) => !isWeekend(e.day)).length} 天</div>
        <div class="sub">其中補假 ${offs.filter((e) => e.title.startsWith('補假')).length} 天</div></div>
      <div class="tile"><div class="label">補班日</div><div class="value">${works.length} 天</div><div class="sub">週末要上課的日子</div></div>
    </div>

    <div class="split">
      <section class="main card">
        <div class="card-head"><h2>停課日</h2><button class="btn small" id="addOff">新增停課日</button></div>
        <div class="sub" style="margin:-6px 0 8px">國定假日、補假、颱風假等全部班級都不上課的日子。不想放的假（例如勞動節照常上課）直接刪掉就好。</div>
        ${table(offs, `${y} 年還沒有設定停課日，按上面「匯入」帶入國定假日`, false)}
      </section>
      <section class="side card">
        <div class="card-head"><h2>補班日</h2><button class="btn small" id="addWork">新增補班日</button></div>
        <div class="sub" style="margin:-6px 0 8px">週六補班等額外上課的日子，當天所有開課中的班都會排課（由當時的授課老師上）。</div>
        ${table(works, '沒有補班日', true)}
      </section>
    </div>
  </main>`;

  document.getElementById('prev').onclick = () => { state.y--; render(); };
  document.getElementById('next').onclick = () => { state.y++; render(); };
  document.getElementById('addOff').onclick = () => edit({ kind: 'holiday' });
  document.getElementById('addWork').onclick = () => edit({ kind: 'makeup' });
  document.getElementById('import').onclick = () => importYear(global);
  app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => edit(global.find((e) => e.id === Number(b.dataset.edit)))));
}

async function edit(e) {
  const work = e.kind === 'makeup';
  const r = await formDialog({
    title: `${e.id ? '編輯' : '新增'}${work ? '補班日' : '停課日'}`,
    fields: [
      { name: 'day', label: '日期', type: 'date', value: e.day, required: true },
      { name: 'title', label: work ? '名稱（例：補班）' : '名稱（例：國慶日、補假（國慶日）、颱風假）', value: e.title ?? (work ? '補班' : ''), required: true },
    ],
    danger: e.id ? '刪除' : null,
  });
  if (!r) return;
  try {
    if (r.__danger) {
      if (!(await confirmDialog(`刪除 ${mdw(e.day)} ${e.title}？`, '刪除'))) return;
      await api.deleteEvent(e.id);
    } else {
      if (!work && isWeekend(r.day) && !(await confirmDialog(`${mdw(r.day)} 是週末，本來就不上課，還是要加嗎？`, '加入'))) return;
      if (work && !isWeekend(r.day) && !(await confirmDialog(`${mdw(r.day)} 是平日，本來就要上課，還是要加嗎？`, '加入'))) return;
      const row = { day: r.day, title: r.title, kind: e.kind, class_id: null };
      if (e.id) await api.updateEvent({ id: e.id, ...row }); else await api.addEvent(row);
    }
    toast('已儲存');
    state.y = parse(r.day ?? e.day).getFullYear();
    render();
  } catch (err) { toast(err.message, true); }
}

// 從人事行政總處行事曆匯入：停課日預設全勾，補班日預設不勾（看單位是否跟著補班）
async function importYear(global) {
  const { y } = state;
  let cal;
  try { cal = await api.fetchTaiwanCalendar(y); } catch (e) { toast(e.message, true); return; }
  const have = new Set(global.map((e) => `${e.kind}|${e.day}`));
  const offs = cal.holidays.filter((h) => !have.has(`holiday|${h.day}`));
  const works = cal.workdays.filter((h) => !have.has(`makeup|${h.day}`));
  if (!offs.length && !works.length) { toast(`${y} 年的國定假日與補班日都已經加過了`); return; }
  const skipped = cal.holidays.length - offs.length + cal.workdays.length - works.length;
  const fields = [];
  if (offs.length) fields.push({ name: 'offs', label: `停課日（平日放假 ${offs.length} 天）`, type: 'checkboxes',
    value: offs.map((h) => h.day), options: offs.map((h) => [h.day, `${mdw(h.day)} ${h.title}`]) });
  if (works.length) fields.push({ name: 'works', label: `補班日 ${works.length} 天（行政機關要上班的週末；班級也要補課才勾）`, type: 'checkboxes',
    value: [], options: works.map((h) => [h.day, `${mdw(h.day)} ${h.title}`]) });
  const r = await formDialog({ title: `匯入 ${y} 年國定假日${skipped ? `（已有 ${skipped} 天略過）` : ''}`, submitLabel: '加入勾選的日子', fields });
  if (!r) return;
  const pickO = new Set(r.offs ?? []), pickW = new Set(r.works ?? []);
  const rows = [
    ...offs.filter((h) => pickO.has(h.day)).map((h) => ({ ...h, kind: 'holiday', class_id: null })),
    ...works.filter((h) => pickW.has(h.day)).map((h) => ({ ...h, kind: 'makeup', class_id: null })),
  ];
  if (!rows.length) return;
  try {
    await api.addEvents(rows);
    toast(`已加入 ${pickO.size} 天停課日${pickW.size ? `、${pickW.size} 天補班日` : ''}`);
    render();
  } catch (e) { toast(e.message, true); }
}
