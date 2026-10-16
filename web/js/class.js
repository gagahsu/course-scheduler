// 班級列表 / 班級詳情（授課區段、單日調整老師）
import * as api from './api.js';
import { boot } from './auth.js';
import { esc, parse, addDays, today, md, mdw, roc, range, avatar, teacherStyle, toast, formDialog, confirmDialog, qs, STATUS } from './ui.js';
import { planEditor, teacherOptions, courseOptions, autoCourse } from './plan.js';

await boot('class.html');
const app = document.getElementById('app');

let teachers = await api.listTeachers();
let T = Object.fromEntries(teachers.map((t) => [t.id, t]));
const locations = await api.listLocations();
const [courses, teacherCourses] = await Promise.all([api.listCourses(), api.listTeacherCourses()]);
const C = Object.fromEntries(courses.map((c) => [c.id, c]));
const ctx = { teachers, courses, teacherCourses };

const TABS = [['plan', '授課安排'], ['leave', '請假與代課'], ['events', '補課與活動']];
let detailTab = TABS.some(([k]) => k === qs('tab')) ? qs('tab') : null;   // 重畫時保留目前的頁籤

const id = Number(qs('id'));
if (id) renderDetail(id, qs('day'), qs('setup') === '1', qs('to')); else renderList();

// ======================= 班級列表 =======================
async function renderList() {
  const classes = await api.listClasses();
  const td = today();
  const group = (c) => (c.end_date < td ? 'done' : c.start_date > td ? 'soon' : 'now');
  const sections = [['now', '上課中'], ['soon', '即將開課'], ['done', '已結訓']];
  app.innerHTML = `
  <main class="page">
    <div class="row"><h1 class="page-title">班級</h1>
      ${classes.length ? '' : '<span class="hint">還沒有班級，按右邊「新增班級」開始</span>'}
      <button class="btn primary" id="add" style="margin-left:auto">新增班級</button></div>
    ${sections.map(([g, label]) => {
      const list = classes.filter((c) => group(c) === g);
      if (!list.length) return '';
      return `<section style="display:flex;flex-direction:column;gap:10px"><h2 style="font-size:15px;color:var(--text-3)">${label}</h2>
        <div class="class-grid">${list.map((c) => `<div class="class-card">
          <div class="row" style="gap:8px"><span class="loc loc-${c.location_id}">${esc(c.locations.name)}</span><span class="sub">${esc(c.term ?? '')}</span></div>
          <a href="class.html?id=${c.id}" style="font-size:18px;font-weight:700;text-decoration:none;color:inherit">${esc(c.name)}</a>
          <span class="sub">${esc(c.room ?? '')}・${md(c.start_date)} – ${md(c.end_date)}</span>
          <div class="row" style="gap:6px;margin-top:4px">
            <a class="btn small" href="class.html?id=${c.id}" style="text-decoration:none">查看</a>
            <button class="btn small" data-edit-class="${c.id}">編輯</button>
            <button class="btn small danger" data-del-class="${c.id}">刪除</button>
          </div></div>`).join('')}</div></section>`;
    }).join('')}
  </main>`;
  document.getElementById('add').onclick = async () => {
    const saved = await editClass({});
    if (saved) location.href = `class.html?id=${saved.id}&setup=1`;
  };
  const byId = (v) => classes.find((c) => c.id === Number(v));
  app.querySelectorAll('[data-edit-class]').forEach((b) => (b.onclick = async () => {
    if (await editClass(byId(b.dataset.editClass), { afterDelete: renderList })) renderList();
  }));
  app.querySelectorAll('[data-del-class]').forEach((b) => (b.onclick = () => removeClass(byId(b.dataset.delClass), renderList)));
}

// 刪除班級：授課區段、代課、班級自己的補課／活動會一起被資料庫 cascade 刪掉
async function removeClass(c, after = () => (location.href = 'class.html')) {
  if (!(await confirmDialog(`確定刪除 ${c.name}？授課區段、助教、代課紀錄、補課與活動會一起刪除，無法復原`, '刪除'))) return false;
  try {
    await api.deleteClass(c.id);
    toast(`已刪除 ${c.name}`);
    after();
    return true;
  } catch (e) { toast(e.message, true); return false; }
}

async function editClass(c, { afterDelete } = {}) {
  const r = await formDialog({
    title: c.id ? '編輯班級' : '新增班級',
    fields: [
      { name: 'name', label: '班級名稱', value: c.name, required: true },
      { name: 'term', label: '期別（例：115年下）', value: c.term },
      { name: 'location_id', label: '地點', type: 'select', value: c.location_id, options: locations.map((l) => [l.id, l.name]) },
      { name: 'room', label: '教室', value: c.room },
      { name: 'start_date', label: '開訓日', type: 'date', value: c.start_date, required: true },
      { name: 'end_date', label: '結訓日', type: 'date', value: c.end_date, required: true },
      { name: 'note', label: '備註', type: 'textarea', value: c.note },
    ],
    danger: c.id ? '刪除班級' : null,
  });
  if (!r) return null;
  if (r.__danger) { await removeClass(c, afterDelete); return null; }
  if (r.end_date < r.start_date) { toast('結訓日不能早於開訓日', true); return null; }
  try {
    const saved = await api.saveClass({ ...(c.id ? { id: c.id } : {}), ...r, location_id: Number(r.location_id) });
    toast('已儲存');
    return saved;
  } catch (e) { toast(e.message, true); return null; }
}

// ======================= 班級詳情 =======================
async function renderDetail(classId, focusDay, setup = false, focusTo = null) {
  const td = today();
  let c, blocks, sessions, events, assistants;
  try {
    c = await api.getClass(classId);
    [blocks, sessions, events, assistants] = await Promise.all([
      api.listBlocks(classId), api.listSessions(c.start_date, '9999-12-31', { classId }), api.listEvents(c.start_date, c.end_date),
      api.listAssistants(classId),
    ]);
  } catch (e) {
    app.innerHTML = `<main class="page"><a href="class.html" style="font-size:13px;text-decoration:none">← 全部班級</a>
      <div class="card">${esc(e.message)}</div></main>`;
    return;
  }
  events = events.filter((e) => e.class_id === classId || (e.class_id == null && e.kind === 'holiday'));

  const total = sessions.length;
  const done = sessions.filter((s) => s.day <= td).length;
  const prog = total ? Math.round((done / total) * 100) : 0;
  const unassigned = sessions.filter((s) => s.status === 'unassigned');
  const cur = sessions.find((s) => s.day >= td) ?? sessions[sessions.length - 1];
  const curT = cur && T[cur.planned_teacher_id];
  const curBlock = cur && blocks.find((b) => cur.day >= b.start_date && cur.day <= b.end_date);
  const special = sessions.filter((s) => s.day >= td && ['covered', 'uncovered', 'swapped'].includes(s.status));

  // 時間軸
  const t0 = parse(c.start_date).getTime(), span = Math.max(1, parse(c.end_date).getTime() - t0);
  const pct = (k) => Math.max(0, Math.min(100, ((parse(k).getTime() - t0) / span) * 100));
  const segs = [];
  let cursor = c.start_date;
  for (const b of blocks) {
    if (b.start_date > cursor) segs.push({ t: null, a: cursor, b: prevDay(b.start_date) });
    segs.push({ t: T[b.teacher_id], c: C[b.course_id], blk: b, a: b.start_date, b: b.end_date });
    cursor = nextDay(b.end_date);
  }
  if (cursor <= c.end_date) segs.push({ t: null, a: cursor, b: c.end_date });
  // 週末之類沒有上課日的空檔不顯示
  const hasDays = (g) => sessions.some((s) => s.day >= g.a && s.day <= g.b);
  for (let i = segs.length - 1; i >= 0; i--) if (!segs[i].t && !hasDays(segs[i])) segs.splice(i, 1);
  const months = [];
  for (let d = parse(c.start_date); d <= parse(c.end_date); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    if (k >= c.start_date) months.push(k);
  }
  const marks = [
    ...events.filter((e) => e.class_id === classId).map((e) => ({ day: e.day, label: e.title, color: '#E0A21E' })),
    ...sessions.filter((s) => s.leave_id).reduce((acc, s) => {
      const last = acc[acc.length - 1];
      if (last && last.leave === s.leave_id) { last.to = s.day; return acc; }
      acc.push({ leave: s.leave_id, day: s.day, to: s.day, s });
      return acc;
    }, []).map((x) => ({ day: x.day, label: `${T[x.s.planned_teacher_id].name} 請假${x.s.sub_teacher_id ? ' → ' + T[x.s.sub_teacher_id].name : ''}`, color: '#C8382F' })),
    { day: c.end_date, label: '結訓', color: '#0F7B6C' },
  ].sort((a, b) => a.day.localeCompare(b.day));

  const pickDay = focusDay && sessions.some((s) => s.day === focusDay) ? focusDay : (cur?.day ?? c.start_date);
  const pickTo = focusTo && focusTo > pickDay && focusTo <= c.end_date ? focusTo : pickDay;

  // 頁籤：網址有帶日期（從行事曆、請假頁連過來）就打開「請假與代課」
  const tab = detailTab ?? (focusDay ? 'leave' : 'plan');
  detailTab = tab;
  const ownEvents = events.filter((e) => e.class_id === classId);
  const open = special.filter((s) => s.status === 'uncovered').length;
  const badges = {
    plan: unassigned.length ? `<span class="tab-count bad">${unassigned.length} 天未指派</span>` : '',
    leave: open ? `<span class="tab-count bad">${open} 待安排</span>` : special.length ? `<span class="tab-count">${special.length}</span>` : '',
    events: ownEvents.length ? `<span class="tab-count">${ownEvents.length}</span>` : '',
  };

  app.innerHTML = `
  <main class="page">
    <a href="class.html" style="font-size:13px;text-decoration:none">← 全部班級</a>
    <div class="row" style="align-items:flex-end">
      <div>
        <div class="row" style="gap:10px;margin-bottom:6px"><span class="loc loc-${c.location_id}">${esc(c.locations.name)}</span><span class="sub">${esc(c.term ?? '')}・${esc(c.room ?? '教室未填')}</span></div>
        <h1 class="page-title" style="font-size:30px">${esc(c.name)}</h1>
      </div>
      <div class="row" style="margin-left:auto">
        <button class="btn primary" id="editClass">編輯班級</button>
        <button class="btn danger" id="delClass">刪除班級</button>
      </div>
    </div>

    <div class="tiles">
      <div class="tile"><div class="label">上課期間</div><div class="value">${md(c.start_date)} – ${md(c.end_date)}</div><div class="sub">共 ${total} 個上課日</div></div>
      <div class="tile"><div class="label">課程進度</div><div class="value">${prog}%</div>
        <div style="height:6px;border-radius:99px;background:var(--line-soft);margin-top:8px;overflow:hidden"><div style="height:100%;width:${prog}%;background:var(--brand)"></div></div></div>
      <div class="tile"><div class="label">${cur && cur.day > td ? '下一堂' : '目前授課'}</div>
        <div class="row" style="gap:8px">${avatar(curT)}<span class="value" style="font-size:18px">${curT ? esc(curT.name) : '未指派'}</span></div>
        <div class="sub">${curBlock ? `${md(curBlock.start_date)} – ${md(curBlock.end_date)}` : ''}${cur?.assistant_ids?.length ? `・助教 ${esc(names(cur.assistant_ids))}` : ''}</div></div>
      <div class="tile ${unassigned.length ? 'alert' : ''}"><div class="label">未指派老師</div><div class="value">${unassigned.length} 天</div>
        <div class="sub">${unassigned.length ? `${md(unassigned[0].day)} 起` : '全部都排好了'}</div></div>
    </div>

    <section class="card">
      <div class="card-head"><h2>授課老師時間軸</h2></div>
      <div class="scroll-x"><div class="tl">
        <div class="tl-months">${months.map((k) => `<span style="left:${pct(k)}%">${parse(k).getMonth() + 1} 月</span>`).join('')}</div>
        <div class="tl-track">${segs.map((g) => {
          const l = pct(g.a), w = Math.max(1.2, pct(nextDay(g.b)) - l);
          const label = (g.t?.name ?? '未指派') + (g.c ? '・' + g.c.name : '');
          return `<div class="tl-seg ${g.t ? '' : 'none'}" title="${esc(label + ' ' + md(g.a) + '–' + md(g.b))}"
            style="left:calc(${l}% + 2px);width:calc(${w}% - 4px);${g.t ? teacherStyle(g.t) : ''}">${esc(label)}　${md(g.a)}–${md(g.b)}</div>`;
        }).join('')}</div>
        <div class="tl-marks">${marks.map((k, i) => {
          const p = pct(k.day), right = p > 85;
          return `<div class="tl-mark" style="top:${i % 2 ? 28 : 2}px;${right ? `right:${100 - p}%;flex-direction:row-reverse;transform:translateX(6px)` : `left:${p}%;transform:translateX(-6px)`}"><i style="background:${k.color}"></i>${esc(md(k.day) + ' ' + k.label)}</div>`;
        }).join('')}</div>
        ${td >= c.start_date && td <= c.end_date ? `<div class="tl-today" style="left:${pct(td)}%"></div>` : ''}
      </div></div>
    </section>

    <div class="tabs" role="tablist" aria-label="班級內容">${TABS.map(([k, label]) => `<button type="button" role="tab" id="tab-${k}" aria-controls="panel-${k}"
      aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-tab="${k}">${label}${badges[k] ?? ''}</button>`).join('')}</div>

    <div role="tabpanel" id="panel-plan" aria-labelledby="tab-plan" class="tab-panel" ${tab === 'plan' ? '' : 'hidden'}>
        <section class="card">
          <div class="card-head"><h2>授課區段</h2>
            <span class="row" style="gap:6px"><button class="btn small" id="plan">排課／套用範本</button><button class="btn small primary" id="addBlock">新增區段</button></span></div>
          ${segs.length ? '' : '<div class="empty">還沒有排課。按「排課／套用範本」一次排好整個班，或「新增區段」一段一段加。</div>'}
          <div class="scroll-x"><table class="tbl" style="min-width:600px" ${segs.length ? '' : 'hidden'}>
            <thead><tr><th>老師</th><th>課程</th><th>期間</th><th>上課日</th><th><span hidden>操作</span></th></tr></thead>
            <tbody>${segs.map((g) => {
              const b = g.blk;
              const n = sessions.filter((s) => s.day >= g.a && s.day <= g.b).length;
              return `<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(g.t)}<strong>${esc(g.t?.name ?? '未指派')}</strong></span></td>
                <td>${esc(g.c?.name ?? '—')}</td>
                <td>${md(g.a)} – ${md(g.b)}</td><td>${n} 天</td>
                <td class="actions">${b ? `<button class="btn small" data-edit-block="${b.id}">調整</button>` : `<button class="btn small" data-fill="${g.a}|${g.b}">指派老師</button>`}</td></tr>`;
            }).join('')}</tbody></table></div>
        </section>

        <section class="card">
          <div class="card-head"><h2>助教／協同老師</h2><button class="btn small primary" id="addAssist">新增助教</button></div>
          <div class="sub" style="margin-top:-6px">需要多位老師同時在場時使用：主授老師之外，再指定一段期間（可以只有一天）由誰一起在場。助教請假當天會自動標示缺席，不需要代課。</div>
          ${assistants.length ? `<div class="scroll-x"><table class="tbl" style="min-width:600px">
            <thead><tr><th>老師</th><th>期間</th><th>上課日</th><th>備註</th><th><span hidden>操作</span></th></tr></thead>
            <tbody>${assistants.map((a) => {
              const inRange = sessions.filter((s) => s.day >= a.start_date && s.day <= a.end_date);
              const off = inRange.filter((s) => s.absent_assistant_ids?.includes(a.teacher_id)).length;
              return `<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(T[a.teacher_id])}<strong>${esc(T[a.teacher_id]?.name ?? '—')}</strong></span></td>
                <td>${esc(range(a.start_date, a.end_date))}</td>
                <td>${inRange.length} 天${off ? ` <span class="pill bad">請假 ${off} 天</span>` : ''}</td>
                <td class="wrap">${esc(a.note ?? '')}</td>
                <td class="actions"><button class="btn small" data-edit-assist="${a.id}">調整</button></td></tr>`;
            }).join('')}</tbody></table></div>` : '<div class="empty">沒有助教</div>'}
        </section>
    </div>

    <div role="tabpanel" id="panel-leave" aria-labelledby="tab-leave" class="tab-panel" ${tab === 'leave' ? '' : 'hidden'}>
      <div class="split">
        <section class="main card accent adjust" aria-labelledby="adj">
          <div><h2 id="adj" style="margin-bottom:4px">調整上課老師</h2><div class="sub">請假、臨時換人時，指定某一天或一段期間由誰上課</div></div>
          <div class="grid2">
            <label class="field">開始<input type="date" id="adjDay" value="${pickDay}" min="${c.start_date}" max="${c.end_date}"></label>
            <label class="field">結束<input type="date" id="adjTo" value="${pickTo}" min="${c.start_date}" max="${c.end_date}"></label>
          </div>
          <div id="adjBody"></div>
          <div id="adjAssist"></div>
        </section>

        <section class="side card">
          <div class="card-head"><h2>接下來的請假與代課</h2></div>
          ${special.length ? `<div class="sub" style="margin-top:-6px">點日期帶入左邊；「整段」帶入同一筆請假的全部日期</div>
            <div class="list">${special.map((s) => {
              const run = s.leave_id ? special.filter((x) => x.leave_id === s.leave_id) : [];
              const first = run[0] === s;
              return `<div class="item" style="align-items:center">
                <div class="grow"><button type="button" class="linkish" data-range="${s.day}|${s.day}">${mdw(s.day)}</button>
                  <div style="font-size:13px;color:var(--text-2)">${esc(T[s.planned_teacher_id]?.name ?? '—')} → ${esc(T[s.actual_teacher_id]?.name ?? '—')}</div></div>
                <span class="pill ${s.status === 'uncovered' ? 'bad' : 'ok'}">${STATUS[s.status]}</span>
                ${first && run.length > 1 ? `<button type="button" class="btn small" data-range="${run[0].day}|${run.at(-1).day}">整段 ${run.length} 天</button>` : ''}</div>`;
            }).join('')}</div>`
          : '<div class="empty">接下來沒有請假或代課</div>'}
        </section>
      </div>
    </div>

    <div role="tabpanel" id="panel-events" aria-labelledby="tab-events" class="tab-panel" ${tab === 'events' ? '' : 'hidden'}>
        <section class="card">
          <div class="card-head"><h2>補課與活動</h2><button class="btn small primary" id="addEvent">新增補課／活動</button></div>
          ${ownEvents.map((e) => `<div class="row" style="padding:8px 0;border-top:1px solid var(--line-soft)">
            <span class="pill ${e.kind === 'makeup' ? 'warn' : e.kind === 'holiday' ? 'bad' : 'mute'}">${{ makeup: '補課', holiday: '停課', event: '活動' }[e.kind]}</span>
            <span>${mdw(e.day)}</span><span class="grow">${esc(e.title)}</span>
            <button class="btn small danger" data-del-event="${e.id}">刪除</button></div>`).join('') || '<div class="empty">沒有</div>'}
        </section>
    </div>
  </main>`;

  // ---------- 頁籤 ----------
  const tabBtns = [...app.querySelectorAll('[role=tab]')];
  const showTab = (k, focus = false) => {
    detailTab = k;
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === k;
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
      document.getElementById(`panel-${b.dataset.tab}`).hidden = !on;
    });
    history.replaceState(null, '', `class.html?id=${classId}&tab=${k}`);
  };
  tabBtns.forEach((b, i) => {
    b.onclick = () => showTab(b.dataset.tab);
    b.onkeydown = (e) => {
      const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      showTab(tabBtns[(i + d + tabBtns.length) % tabBtns.length].dataset.tab, true);
    };
  });
  history.replaceState(null, '', `class.html?id=${classId}&tab=${tab}`);

  // ---------- 事件綁定 ----------
  document.getElementById('editClass').onclick = async () => { if (await editClass(c)) renderDetail(classId); };
  document.getElementById('delClass').onclick = () => removeClass(c);
  document.getElementById('addEvent').onclick = async () => {
    const r = await formDialog({ title: '新增補課／活動', fields: [
      { name: 'kind', label: '類型', type: 'select', value: 'makeup', options: [['makeup', '補課（額外上課日，例如週六）'], ['event', '活動（只標註，不影響上課）'], ['holiday', '停課（這個班這天不上）']] },
      { name: 'day', label: '日期', type: 'date', required: true },
      { name: 'title', label: '名稱', required: true },
    ] });
    if (!r) return;
    try { await api.addEvent({ ...r, class_id: classId }); toast('已新增'); renderDetail(classId, r.day); } catch (e) { toast(e.message, true); }
  };
  app.querySelectorAll('[data-del-event]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('確定刪除這個項目？', '刪除'))) return;
    try { await api.deleteEvent(Number(b.dataset.delEvent)); renderDetail(classId); } catch (e) { toast(e.message, true); }
  }));
  document.getElementById('addBlock').onclick = () => editBlock({ class_id: classId, start_date: cursorFree(), end_date: c.end_date });
  app.querySelectorAll('[data-edit-block]').forEach((b) => (b.onclick = () => editBlock(blocks.find((x) => x.id === Number(b.dataset.editBlock)))));
  app.querySelectorAll('[data-fill]').forEach((b) => (b.onclick = () => { const [a, z] = b.dataset.fill.split('|'); editBlock({ class_id: classId, start_date: a, end_date: z, fill: true }); }));

  document.getElementById('addAssist').onclick = () => editAssistant({ start_date: c.start_date, end_date: c.end_date });
  app.querySelectorAll('[data-edit-assist]').forEach((b) => (b.onclick = () => editAssistant(assistants.find((x) => x.id === Number(b.dataset.editAssist)))));

  async function editAssistant(a) {
    const r = await formDialog({
      title: a.id ? '調整助教' : '新增助教',
      fields: [
        { name: 'teacher_id', label: '老師', type: 'select', value: a.teacher_id, required: true, options: [] },
        { name: 'start_date', label: '開始', type: 'date', value: a.start_date, required: true },
        { name: 'end_date', label: '結束（只要一天就和開始同一天）', type: 'date', value: a.end_date, required: true },
        { name: 'note', label: '備註（例：上機實作助教）', value: a.note },
      ],
      danger: a.id ? '刪除' : null,
      onMount(dlg) {
        const tSel = dlg.querySelector('#f_teacher_id');
        const start = dlg.querySelector('#f_start_date'), end = dlg.querySelector('#f_end_date');
        // 只排一天時，標出每位老師當天的狀態（主授、請假、在別班上課）
        let seq = 0;
        const fill = async () => {
          const my = ++seq, keep = Number(tSel.value) || a.teacher_id || null;
          let st = [];
          if (start.value && start.value === end.value) {
            try { st = await api.teacherDayStatus(start.value); } catch { st = []; }
          }
          if (my !== seq) return;
          const S = Object.fromEntries(st.map((x) => [x.teacher_id, x]));
          const lead = st.length ? sessions.find((s) => s.day === start.value)?.actual_teacher_id : null;
          tSel.innerHTML = '<option value=""></option>' + teachers.filter((t) => t.active || t.id === keep).map((t) => {
            const x = S[t.id];
            const busy = x?.busy_class_id && x.busy_class_id !== classId;
            const tag = t.id === lead ? '（當天主授）' : x?.on_leave ? '（當天請假）' : busy ? `（在${x.busy_location} ${x.busy_class_name}）` : '';
            return `<option value="${t.id}" ${t.id === keep ? 'selected' : ''}>${esc(t.name + tag)}</option>`;
          }).join('');
        };
        fill();
        start.onchange = () => { if (!end.value || end.value < start.value) end.value = start.value; fill(); };
        end.onchange = fill;
      },
    });
    if (!r) return;
    try {
      if (r.__danger) await api.deleteAssistant(a.id);
      else {
        if (r.end_date < r.start_date) { toast('結束日不能早於開始日', true); return; }
        await api.saveAssistant({ ...(a.id ? { id: a.id } : {}), class_id: classId, teacher_id: Number(r.teacher_id), start_date: r.start_date, end_date: r.end_date, note: r.note });
      }
      toast('已儲存');
      renderDetail(classId, dayInput.value);
    } catch (e) { toast(e.message, true); }
  }

  function cursorFree() { const last = blocks[blocks.length - 1]; return last ? nextDay(last.end_date) : c.start_date; }

  const days = sessions.map((s) => s.day);
  // 對齊到上課日（週末、停課日跳過）：開始往後找、結束往前找
  const nextSession = (k) => days.find((d) => d >= k) ?? null;
  const prevSession = (k) => days.findLast((d) => d <= k) ?? null;
  // 從 start 那天（或之後第一個上課日）起算第 n 個上課日
  const nthDay = (start, n) => {
    const i = days.findIndex((d) => d >= start);
    return i < 0 ? null : days[Math.min(i + n - 1, days.length - 1)];
  };

  const countDays = (a, z) => days.filter((d) => d >= a && d <= z).length;
  // 目前的排法轉成排課列（空檔＝沒指定老師的列）
  const segItems = (list) => list.map((g) => ({ teacher_id: g.t?.id ?? null, course_id: g.c?.id ?? null, days: countDays(g.a, g.b) }));

  // 調整第 k 段後，後面各段保持原本天數，依序順延／提前
  function ripplePlan(k, row) {
    const items = segItems(segs.slice(0, k)).filter((x) => x.days > 0);
    const before = days.filter((d) => d < row.start_date).length;     // 新開始日之前有幾個上課日
    const diff = before - items.reduce((s, x) => s + x.days, 0);
    const last = items[items.length - 1];
    if (diff < 0) {
      // 開始日往前：只能吃掉前面的空檔，不能蓋到前一位老師
      if (!last || last.teacher_id || last.days + diff < 0) throw new Error('開始日不能早於前一段的結束日');
      last.days += diff;
      if (!last.days) items.pop();
    } else if (diff > 0) {
      if (last && !last.teacher_id) last.days += diff; else items.push({ teacher_id: null, course_id: null, days: diff });
    }
    const n = countDays(row.start_date, row.end_date);
    if (!n) throw new Error('這段期間沒有任何上課日');
    items.push({ teacher_id: row.teacher_id, course_id: row.course_id, days: n });
    return [...items, ...segItems(segs.slice(k + 1)).filter((x) => x.days > 0)];
  }

  async function editBlock(b) {
    const firstTeacher = b.teacher_id ?? teachers.find((t) => t.active)?.id ?? null;
    const k = b.id ? segs.findIndex((g) => g.blk?.id === b.id) : -1;
    const hasAfter = k >= 0 && segs.slice(k + 1).some((g) => g.t);
    const r = await formDialog({
      title: b.id ? '調整授課區段' : '新增授課區段',
      fields: [
        { name: 'teacher_id', label: '老師', type: 'select', value: firstTeacher, required: true, options: [] },
        { name: 'course_id', label: '課程（選老師會自動帶出他會教的課）', type: 'select', value: b.course_id, options: [] },
        { name: 'start_date', label: '開始', type: 'date', value: b.start_date, required: true },
        { name: 'end_date', label: '結束（選課程會依預設天數自動算，已扣假日）', type: 'date', value: b.end_date, required: true },
        ...(hasAfter ? [{ name: 'ripple', label: '後面的課程跟著順延／提前（各自天數不變）', type: 'checkbox', value: true }] : []),
      ],
      danger: b.id ? '刪除區段' : null,
      onMount(dlg) {
        const tSel = dlg.querySelector('#f_teacher_id'), cSel = dlg.querySelector('#f_course_id');
        const start = dlg.querySelector('#f_start_date'), end = dlg.querySelector('#f_end_date');
        const num = (v) => (v ? Number(v) : null);
        const fillEnd = () => {
          const c = C[num(cSel.value)];
          let e = c && start.value && nthDay(start.value, c.default_days);
          // 補空檔時不要超過空檔的最後一天，免得和下一段重疊
          if (e && b.end_date && e > b.end_date) e = b.end_date;
          if (e) { end.value = e; snapEnd(); }
        };
        const fillCourses = (cid) => { cSel.innerHTML = courseOptions(ctx, num(tSel.value), cid); };
        const note = (input, text) => {
          let el = input.parentElement.querySelector('.snap-note');
          if (!el) { el = document.createElement('span'); el.className = 'snap-note sub'; input.after(el); }
          el.textContent = text;
        };
        const snap = (input, fn, word) => {
          if (!input.value) return;
          const v = fn(input.value);
          if (v && v !== input.value) { note(input, `${mdw(input.value)} 不是上課日，已${word}到 ${mdw(v)}`); input.value = v; }
          else note(input, '');
        };
        const snapStart = () => snap(start, nextSession, '往後調');
        const snapEnd = () => snap(end, prevSession, '往前調');
        tSel.innerHTML = teacherOptions(ctx, firstTeacher, { blank: '' });
        snapStart();
        snapEnd();
        // 新增時直接帶出這位老師會教的第一門課
        fillCourses(b.id ? b.course_id : autoCourse(ctx, firstTeacher, b.course_id ?? null));
        // 補空檔：預設排滿整段空檔，不用課程天數蓋掉結束日
        if (b.fill) note(end, `空檔 ${md(b.start_date)} – ${md(b.end_date)} 共 ${countDays(b.start_date, b.end_date)} 個上課日；只想排一部分就自己改結束日`);
        else if (!b.id) fillEnd();
        tSel.onchange = () => {
          const before = num(cSel.value);
          const next = autoCourse(ctx, num(tSel.value), before);
          fillCourses(next);
          if (next !== before && !b.fill) fillEnd();
        };
        cSel.onchange = () => { if (!b.fill) fillEnd(); };
        start.onchange = () => { snapStart(); if (!b.id && !b.fill) fillEnd(); };
        end.onchange = snapEnd;
      },
    });
    if (!r) return;
    try {
      if (r.__danger) await api.deleteBlock(b.id);
      else {
        if (r.end_date < r.start_date) { toast('結束日不能早於開始日', true); return; }
        const row = { teacher_id: Number(r.teacher_id), course_id: r.course_id ? Number(r.course_id) : null, start_date: r.start_date, end_date: r.end_date };
        const moved = b.id && (r.start_date !== b.start_date || r.end_date !== b.end_date);
        if (r.ripple && moved) {
          // 整班重排（一個交易）：前面不動、這段用新日期、後面依序接上
          const res = await api.applyPlan(classId, ripplePlan(k, row), true);
          const over = res.requested_days - res.total_days;
          toast(over > 0 ? `已順延；最後 ${over} 天超過結訓日被截掉，請延後結訓日或縮短課程` : '已調整，後面的課程已跟著移動', over > 0);
          renderDetail(classId);
          return;
        }
        await api.saveBlock({ ...(b.id ? { id: b.id } : {}), class_id: classId, ...row });
      }
      toast('已儲存');
      renderDetail(classId);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- 排課：一次排好整個班（可從範本帶入） ----------
  document.getElementById('plan').onclick = () => openPlan();
  if (setup) {
    if (!blocks.length) openPlan();
  }

  async function openPlan() {
    let curricula = [];
    try { curricula = await api.listCurricula(); } catch (e) { toast(e.message, true); return; }
    // 已經有區段：帶入目前的排法（空檔也保留成「未指定老師」的列），方便整批調整
    const current = segs.map((g) => ({
      teacher_id: g.t?.id ?? null, course_id: g.c?.id ?? null,
      days: sessions.filter((s) => s.day >= g.a && s.day <= g.b).length,
    })).filter((x) => x.days > 0);
    const tplItems = (p) => p.curriculum_items.map((x) => ({ teacher_id: x.teacher_id, course_id: x.course_id, days: x.days }));
    const r = await planEditor({
      title: `排課：${c.name}`,
      ctx, days,
      items: blocks.length ? current : curricula.length === 1 ? tplItems(curricula[0]) : [],
      submitLabel: '排入授課區段',
      head: `
        <label class="field">從課表範本帶入<select name="tpl" id="tplSel">
          <option value="">${blocks.length ? '（目前的排法）' : '（不使用範本，自己加）'}</option>
          ${curricula.map((p) => `<option value="${p.id}" ${!blocks.length && curricula.length === 1 ? 'selected' : ''}>${esc(p.name)}（${p.curriculum_items.reduce((s, x) => s + x.days, 0)} 天）</option>`).join('')}
        </select></label>
        ${blocks.length ? `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="replace" checked> 取代現有的 ${blocks.length} 個授課區段</label>` : ''}
        <div class="sub">從開訓日 ${md(c.start_date)} 起依上課日往後排（週末、停課日自動跳過）。選老師會帶出他會教的課，選課程會帶出預設天數。沒指定老師的列會保留成「未指派」空檔。</div>`,
      onMount(dlg, { setRows }) {
        dlg.querySelector('#tplSel').onchange = (e) => {
          const p = curricula.find((x) => x.id === Number(e.target.value));
          setRows(p ? tplItems(p) : blocks.length ? current : []);
        };
      },
    });
    if (!r) return;
    if (!r.items.length) { toast('沒有任何一列可以排', true); return; }
    const replace = r.fd.has('replace');
    if (blocks.length && !replace) { toast('這個班已經有授課區段，要重排請勾選「取代現有的授課區段」', true); return; }
    try {
      const res = await api.applyPlan(classId, r.items, replace);
      const extra = [
        res.skipped ? `${res.skipped} 列沒指定老師，保留成未指派` : '',
        res.requested_days > res.total_days ? `超出 ${res.requested_days - res.total_days} 天已略過` : '',
        res.requested_days < res.total_days ? `還有 ${res.total_days - res.requested_days} 天未指派` : '',
      ].filter(Boolean).join('，');
      toast(`已排入 ${res.blocks} 個授課區段${extra ? '；' + extra : ''}`);
      renderDetail(classId);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- 調整上課老師（單日或區間） ----------
  const dayInput = document.getElementById('adjDay'), toInput = document.getElementById('adjTo');
  dayInput.onchange = () => {
    if (!toInput.value || toInput.value < dayInput.value) toInput.value = dayInput.value;
    renderAdjust(dayInput.value, toInput.value);
  };
  toInput.onchange = () => {
    if (toInput.value && dayInput.value > toInput.value) dayInput.value = toInput.value;
    renderAdjust(dayInput.value, toInput.value);
  };
  renderAdjust(pickDay, pickTo);
  // 右邊清單：點日期／整段 → 帶入調整面板
  app.querySelectorAll('[data-range]').forEach((b) => (b.onclick = () => {
    [dayInput.value, toInput.value] = b.dataset.range.split('|');
    renderAdjust(dayInput.value, toInput.value);
    dayInput.focus();
  }));

  // 單日面板下方：當天的助教
  function renderAssistDay(s) {
    const box = document.getElementById('adjAssist');
    if (!s) { box.innerHTML = ''; return; }
    const here = s.assistant_ids ?? [], off = s.absent_assistant_ids ?? [];
    box.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:1px solid var(--line-soft)">
      <div class="sub">這天的助教</div>
      ${here.length || off.length ? `<div class="chips">${here.map((t) => `<span class="chip-btn plain">${avatar(T[t], 'sm')}${esc(T[t]?.name)}</span>`).join('')}${off.map((t) =>
        `<span class="chip-btn plain">${avatar(T[t], 'sm')}${esc(T[t]?.name)}<span class="pill bad">請假</span></span>`).join('')}</div>`
        : '<div class="empty" style="padding:4px 0">沒有</div>'}
      <button class="btn" id="addAssistDay">加派這天的助教</button></div>`;
    box.querySelector('#addAssistDay').onclick = () => editAssistant({ start_date: s.day, end_date: s.day });
  }

  let adjSeq = 0;
  async function renderAdjust(from, to) {
    const my = ++adjSeq;
    const body = document.getElementById('adjBody');
    const list = from && to ? sessions.filter((x) => x.day >= from && x.day <= to) : [];
    const single = list.length === 1 ? list[0] : null;
    renderAssistDay(from === to ? single : null);
    if (!list.length) { body.innerHTML = `<div class="empty">${from ? (from === to ? mdw(from) + ' 不是上課日' : '這段期間沒有上課日') : '請選擇日期'}</div>`; return; }
    const again = () => renderDetail(classId, from, false, to);

    // 目前狀態：單日顯示大卡片，區間逐日列出
    const line = (s) => {
      const plan = T[s.planned_teacher_id], act = T[s.actual_teacher_id];
      return `${STATUS[s.status]}${act && act !== plan ? `，由 ${esc(act.name)} 上課` : ''}`;
    };
    const statusBox = single ? `<div style="display:flex;align-items:center;gap:10px;padding:12px;border-radius:12px;background:${single.status === 'uncovered' ? '#FDF1EF' : 'var(--bg)'}">
      ${avatar(T[single.planned_teacher_id])}<div style="font-size:13px"><strong>原定：${esc(T[single.planned_teacher_id]?.name ?? '未指派')}</strong>・${roc(single.day)}${single.is_makeup ? '（補課）' : ''}<br>
      <span style="color:${single.status === 'uncovered' ? 'var(--danger-text)' : 'var(--text-2)'}">${line(single)}</span></div></div>`
      : `<div style="display:flex;flex-direction:column;gap:4px;padding:12px;border-radius:12px;background:var(--bg);font-size:13px">
        <strong>${list.length} 個上課日</strong>
        ${list.map((s) => `<div style="color:${s.status === 'uncovered' ? 'var(--danger-text)' : 'var(--text-2)'}">${mdw(s.day)} ${esc(T[s.planned_teacher_id]?.name ?? '未指派')}・${line(s)}</div>`).join('')}</div>`;

    const subbed = list.filter((s) => s.substitution_id);
    const undoHtml = subbed.length ? `<button class="btn danger" id="undo">取消${single ? '這天' : `這 ${subbed.length} 天`}的代課</button>
      <div class="sub" style="margin-top:-6px">只取消這個班的代課；如果當初有找人去接手別班，那邊的安排要到那個班另外取消。</div>` : '';
    const work = list.filter((s) => s.status !== 'unassigned');
    const wire = () => body.querySelector('#undo')?.addEventListener('click', async () => {
      try { await api.deleteSubstitutionsInRange(classId, from, to); toast('已取消'); again(); } catch (e) { toast(e.message, true); }
    });
    if (!work.length) {
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${statusBox}${undoHtml}<div class="sub">這段期間還沒有主授老師，請先在左邊「授課區段」指派。</div></div>`;
      wire();
      return;
    }

    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${statusBox}<div class="loading" style="padding:12px">查詢老師狀態…</div></div>`;
    let presence, leaves;
    try { [presence, leaves] = await Promise.all([api.listPresence(from, to), api.listLeaves(from, to)]); }
    catch (e) { toast(e.message, true); return; }
    if (my !== adjSeq) return;
    const onLeave = (t, d) => leaves.some((l) => l.teacher_id === t && d >= l.start_date && d <= l.end_date);
    const where = (p) => `${p.location_name} ${p.class_name}`;
    const dates = (ds) => ds.map(md).join('、');

    // 每位老師在這段期間能不能來：請假、在別班當助教 → 不行；在別班主授 → 可以，但要找人接手那班
    const info = (t) => {
      const leaveDays = work.filter((s) => onLeave(t, s.day)).map((s) => s.day);
      const away = presence.filter((p) => p.teacher_id === t && p.class_id !== classId && work.some((s) => s.day === p.day));
      return { leaveDays, assist: away.filter((p) => p.role === 'assistant'), lead: away.filter((p) => p.role === 'lead'),
        here: work.filter((s) => s.actual_teacher_id === t).length };
    };
    const cands = teachers.filter((t) => t.active && t.can_substitute && !work.every((s) => s.planned_teacher_id === t.id && !s.leave_id))
      .map((t) => ({ t, ...info(t.id) }));
    let picked = null, backfill = null;

    const draw = () => {
      const p = cands.find((x) => x.t.id === picked);
      const need = p?.lead ?? [];
      // 接手的人：那幾天沒請假、除了要接手的那班以外沒在別處
      const backs = need.length ? teachers.filter((u) => u.active && u.id !== picked).map((u) => {
        const bad = need.flatMap((x) => {
          if (onLeave(u.id, x.day)) return [`${md(x.day)} 請假`];
          // 他如果是這個班當天的代課人，會被換下來，可以去對調
          const busy = presence.find((q) => q.teacher_id === u.id && q.day === x.day && q.class_id !== x.class_id
            && !(q.class_id === classId && q.role === 'lead'));
          return busy ? [`${md(x.day)} 在${where(busy)}${busy.role === 'assistant' ? '（助教）' : ''}`] : [];
        });
        return { u, bad };
      }) : [];
      const leadClasses = [...new Set(need.map(where))].join('、');
      body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">${statusBox}${undoHtml}
        <div class="sub">改由誰上課？已比對這段期間其他班與請假</div>
        <div class="cands" role="group" aria-label="代課老師">${cands.map((x) => {
          const bad = x.leaveDays.length || x.assist.length;
          const note = x.leaveDays.length ? `${dates(x.leaveDays)} 請假`
            : x.assist.length ? `在${where(x.assist[0])} 當助教`
            : x.lead.length ? `要離開${[...new Set(x.lead.map(where))].join('、')} ${x.lead.length} 天`
            : x.here === work.length ? '目前就是他' : '有空';
          return `<button type="button" class="cand" data-t="${x.t.id}" aria-pressed="${picked === x.t.id}" ${bad ? 'disabled' : ''}>
            ${avatar(x.t)}<span class="name">${esc(x.t.name)}</span><span class="note">${esc(note)}</span></button>`;
        }).join('')}</div>
        ${need.length ? `<div style="display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:#FFF8E6">
          <div style="font-size:13px"><strong>${esc(p.t.name)}</strong> 原本 ${dates(need.map((x) => x.day))} 在 ${esc(leadClasses)} 上課，那幾天由誰接手？</div>
          <div class="cands" role="group" aria-label="接手老師">${backs.map(({ u, bad }) =>
            `<button type="button" class="cand" data-b="${u.id}" aria-pressed="${backfill === u.id}" ${bad.length ? 'disabled' : ''}>
              ${avatar(u)}<span class="name">${esc(u.name)}</span><span class="note">${esc(bad[0] ?? '有空')}</span></button>`).join('')}</div></div>` : ''}
        <button class="btn primary" id="save" ${picked && (!need.length || backfill) ? '' : 'disabled'}>確認${picked
          ? `（${esc(p.t.name)} 上 ${work.length} 天${need.length && backfill ? `，${esc(T[backfill].name)} 接手${esc(leadClasses)}` : ''}）` : ''}</button></div>`;
      wire();
      body.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => { picked = Number(b.dataset.t); backfill = null; draw(); }));
      body.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { backfill = Number(b.dataset.b); draw(); }));
      body.querySelector('#save').onclick = async () => {
        try {
          const res = await api.assignRange({ classId, from, to, teacherId: picked, backfillId: need.length ? backfill : null });
          toast(`已安排 ${T[picked].name} 上 ${res.days} 天${res.backfilled ? `，${T[backfill].name} 接手 ${res.backfilled} 天` : ''}${res.skipped ? `；${res.skipped} 天還沒有主授老師，略過` : ''}`);
          again();
        } catch (e) { toast(e.message, true); }
      };
    };
    draw();
  }
}

function nextDay(k) { return addDays(k, 1); }
function names(ids) { return ids.map((t) => T[t]?.name ?? '？').join('、'); }
function prevDay(k) { return addDays(k, -1); }
