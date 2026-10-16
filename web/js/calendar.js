// 行事曆總覽（月）
import * as api from './api.js';
import { boot } from './auth.js';
import { esc, ymd, parse, addDays, today, md, mdw, range, isWeekend, eachDay, WK, avatar, teacherStyle, tone, toast } from './ui.js';

// 沒登入也能看（唯讀）：不連到班級頁、不顯示待處理與負荷、不顯示假別與備註
const pub = !(await boot('index.html', { public: true }));
const app = document.getElementById('app');
// 公開模式不連到需要登入的頁面
const link = (href, attrs, inner) => pub ? `<span ${attrs}>${inner}</span>` : `<a href="${href}" ${attrs}>${inner}</a>`;

const params = new URLSearchParams(location.search);
const now = parse(today());
const state = {
  y: Number(params.get('m')?.slice(0, 4)) || now.getFullYear(),
  m: params.get('m') ? Number(params.get('m').slice(5, 7)) - 1 : now.getMonth(),
  loc: params.get('loc') || 'all',
};

const [teachers, classes, locations] = await Promise.all([api.listTeachers(), api.listClasses(pub), api.listLocations()]);
const T = Object.fromEntries(teachers.map((t) => [t.id, t]));
const C = Object.fromEntries(classes.map((c) => [c.id, c]));
const L = Object.fromEntries(locations.map((l) => [l.id, l.name]));

render();

async function render() {
  const { y, m } = state;
  history.replaceState(null, '', `?m=${y}-${String(m + 1).padStart(2, '0')}&loc=${state.loc}`);

  // 月曆格：週一開始
  const first = new Date(y, m, 1);
  const off = (first.getDay() + 6) % 7;
  const gS = ymd(new Date(y, m, 1 - off));
  const nDays = new Date(y, m + 1, 0).getDate();
  const nW = Math.ceil((off + nDays) / 7);
  const gE = addDays(gS, nW * 7 - 1);
  const mS = ymd(first), mE = ymd(new Date(y, m, nDays));
  const td = today();

  let sessions, events, leaves, conflicts, todaySessions, uncovered;
  try {
    [sessions, events, leaves, conflicts, todaySessions, uncovered] = await Promise.all([
      api.listSessions(gS, gE), api.listEvents(gS, gE), api.listLeaves(mS, mE, pub),
      pub ? [] : api.listConflicts(mS, mE), api.listSessions(td, td), pub ? [] : api.listUncovered(td, 20),
    ]);
  } catch (e) { toast(e.message, true); return; }
  const leaveSessions = await api.listSessionsByLeaves(leaves.map((l) => l.id));

  const inLoc = (c) => state.loc === 'all' || String(c.location_id) === state.loc;
  const active = classes.filter((c) => c.start_date <= gE && c.end_date >= gS);
  const vis = active.filter(inLoc);
  const S = new Map(sessions.map((s) => [`${s.class_id}|${s.day}`, s]));
  const showLoc = state.loc === 'all';

  // ---------- 週列 ----------
  const weeksHtml = [];
  for (let w = 0; w < nW; w++) {
    const days = [...Array(7)].map((_, i) => addDays(gS, w * 7 + i));
    const bg = days.map((k) => `<div class="${k === td ? 'today' : isWeekend(k) ? 'we' : ''}"></div>`).join('');
    const heads = days.map((k, i) => {
      const d = parse(k);
      const evs = events.filter((e) => e.day === k && (!e.class_id || vis.some((c) => c.id === e.class_id)));
      const cls = ['cal-day', d.getMonth() !== m && 'out', k === td && 'today', isWeekend(k) && 'we'].filter(Boolean).join(' ');
      const tag = evs[0] ? `<span class="cal-tag ${evs[0].kind === 'holiday' ? 'holiday' : ''}" title="${esc(evs.map((e) => e.title).join('、'))}">${esc(evs[0].title)}${evs.length > 1 ? ` +${evs.length - 1}` : ''}</span>` : '';
      return `<div class="${cls}" style="grid-column:${i + 1}"><span class="cal-num">${d.getDate()}</span>${tag}</div>`;
    }).join('');

    const bars = [];
    vis.forEach((c, row) => {
      let run = null;
      const flush = () => {
        if (!run) return;
        const s = run.s;
        const plan = T[s.planned_teacher_id], act = T[s.actual_teacher_id];
        const pre = (showLoc ? L[c.location_id] + ' ' : '') + c.name;
        const short = run.span === 1;            // 只有一天的色塊比較窄，用短標籤
        const name = short ? c.name : pre;
        let label, cls = s.status, style = '';
        if (s.status === 'normal') { label = `${name}・${plan.name}`; style = teacherStyle(plan); }
        else if (s.status === 'unassigned') label = `${name}・未指派`;
        else if (s.status === 'covered') label = short ? `${plan.name}假→${act.name}` : `${plan.name} 請假 → ${act.name} 代課`;
        else if (s.status === 'uncovered') label = short ? `${plan.name}假・待安排` : `${plan.name} 請假・待安排代課`;
        else if (s.status === 'swapped') { label = `${name}・${act.name} 代課`; style = teacherStyle(act); }
        const helpers = (s.assistant_ids ?? []).map((t) => T[t].short_name);
        if (helpers.length) label += short ? `＋${helpers.join('')}` : `＋${helpers.join('、')}`;
        bars.push(link(`class.html?id=${c.id}&day=${s.day}`, `class="bar ${cls}" title="${esc(`${L[c.location_id]} ${c.name} ${c.room ?? ''}｜${range(run.from, run.to)}`)}"
          style="grid-row:${row + 2};grid-column:${run.col + 1} / span ${run.span};${style}"`, esc(label)));
        run = null;
      };
      days.forEach((k, i) => {
        const s = S.get(`${c.id}|${k}`);
        if (!s) { flush(); return; }
        const key = `${s.status}|${s.planned_teacher_id}|${s.actual_teacher_id}|${s.assistant_ids}`;
        if (run && run.key === key) { run.span++; run.to = k; }
        else { flush(); run = { key, s, col: i, span: 1, from: k, to: k }; }
      });
      flush();
    });
    const minH = 46 + Math.max(vis.length, 1) * 34 + 12;
    weeksHtml.push(`<div class="cal-week" style="min-height:${minH}px"><div class="cal-bg" aria-hidden="true">${bg}</div><div class="cal-fg">${heads}${bars.join('')}</div></div>`);
  }

  // ---------- 側欄 ----------
  const todayHtml = todaySessions.filter((s) => inLoc(C[s.class_id])).map((s) => {
    const plan = T[s.planned_teacher_id], act = T[s.actual_teacher_id];
    let line, color = 'var(--text-2)';
    if (s.status === 'unassigned') { line = '尚未指派老師'; color = '#8A4A06'; }
    else if (s.status === 'covered') { line = `${plan.name} 請假，${act.name} 代課`; color = 'var(--danger-text)'; }
    else if (s.status === 'uncovered') { line = `${plan.name} 請假，待安排代課`; color = 'var(--danger-text)'; }
    else line = `${act.name} 授課`;
    if (s.assistant_ids?.length) line += `，助教 ${s.assistant_ids.map((t) => T[t].name).join('、')}`;
    if (s.absent_assistant_ids?.length) line += `（${s.absent_assistant_ids.map((t) => T[t].name).join('、')} 請假）`;
    return link(`class.html?id=${s.class_id}`, 'class="item" style="text-decoration:none;color:inherit"', `${avatar(act ?? plan, 'lg')}
      <div><div><strong>${esc(s.class_name)}</strong> <span class="sub">${esc(s.location_name)}・${esc(s.room ?? '')}</span></div>
      <div style="font-size:13px;color:${color}">${esc(line)}${s.is_makeup ? '（補課）' : ''}</div></div>`);
  }).join('') || '<div class="empty">今天沒有課</div>';

  const leavesHtml = leaves.slice().sort((a, b) => a.start_date.localeCompare(b.start_date)).map((l) => {
    const t = T[l.teacher_id];
    const aff = leaveSessions.filter((s) => s.leave_id === l.id);
    const open = aff.filter((s) => s.status === 'uncovered').length;
    const pill = !aff.length ? '<span class="pill mute">無課務影響</span>'
      : open ? `<span class="pill bad">${open} 堂待安排</span>` : '<span class="pill ok">已安排代課</span>';
    const subs = [...new Set(aff.filter((s) => s.sub_teacher_id).map((s) => T[s.sub_teacher_id].name))];
    const classesTxt = [...new Set(aff.map((s) => `${s.location_name} ${s.class_name}`))].join('、');
    return `<div class="item">${avatar(t)}<div style="flex:1;min-width:0">
      <div class="row" style="justify-content:space-between;gap:8px"><strong>${esc(t.name)}・${esc(l.type ?? '請假')}</strong>${pill}</div>
      <div style="font-size:13px;color:var(--text-2)">${esc(range(l.start_date, l.end_date))}</div>
      <div class="sub" style="font-size:12px">${aff.length ? `${esc(classesTxt)}${subs.length ? `｜代課：${esc(subs.join('、'))}` : ''}` : esc(l.note || '當天沒有排課')}</div>
    </div></div>`;
  }).join('') || '<div class="empty">本月沒有請假紀錄</div>';

  const alerts = [];
  for (const s of uncovered.filter((s) => inLoc(C[s.class_id]))) {
    alerts.push(`<li><a href="class.html?id=${s.class_id}&day=${s.day}">${esc(mdw(s.day))} ${esc(s.location_name)} ${esc(s.class_name)}</a>：${esc(T[s.planned_teacher_id].name)} 請假，還沒安排代課</li>`);
  }
  for (const c of vis) {
    const n = sessions.filter((s) => s.class_id === c.id && s.status === 'unassigned' && s.day >= mS && s.day <= mE).length;
    if (n) alerts.push(`<li><a href="class.html?id=${c.id}">${esc(L[c.location_id])} ${esc(c.name)}</a>：本月有 ${n} 堂課還沒指派老師</li>`);
  }
  for (const k of conflicts) {
    alerts.push(`<li>${esc(mdw(k.day))} ${esc(T[k.teacher_id].name)} 同時排在 ${esc(k.class_names.join('、'))}</li>`);
  }
  // 請假但當天沒課、又寫了備註的（例如班級待確認）
  for (const l of leaves) {
    if (l.note && !leaveSessions.some((s) => s.leave_id === l.id)) {
      alerts.push(`<li><a href="leave.html">${esc(T[l.teacher_id].name)} ${esc(range(l.start_date, l.end_date))}</a>：${esc(l.note)}</li>`);
    }
  }

  const load = teachers.filter((t) => t.active).map((t) => {
    const inMonth = sessions.filter((s) => s.day >= mS && s.day <= mE);
    const teach = inMonth.filter((s) => s.actual_teacher_id === t.id).length;
    const assist = inMonth.filter((s) => s.assistant_ids?.includes(t.id)).length;
    let leave = 0;
    for (const l of leaves.filter((l) => l.teacher_id === t.id)) {
      for (const k of eachDay(l.start_date > mS ? l.start_date : mS, l.end_date < mE ? l.end_date : mE)) if (!isWeekend(k)) leave++;
    }
    return { t, teach, assist, leave };
  });
  const maxT = Math.max(1, ...load.map((x) => x.teach + x.assist));

  const counts = { all: active.length };
  for (const c of active) counts[c.location_id] = (counts[c.location_id] || 0) + 1;

  app.innerHTML = `
  <main class="page">
    <div class="split">
      <section class="main">
        <div class="row">
          <div class="row" style="gap:6px">
            <button class="btn icon" id="prev" aria-label="上個月"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
            <button class="btn icon" id="next" aria-label="下個月"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
          </div>
          <h1 class="page-title">${y - 1911} 年 ${m + 1} 月<small>${y}</small></h1>
          <button class="btn small" id="today">今天</button>
          <div class="seg" role="group" aria-label="地點" style="margin-left:auto">
            ${[['all', '全部'], ...locations.map((l) => [String(l.id), l.name])].map(([id, label]) =>
              `<button type="button" data-loc="${id}" aria-pressed="${state.loc === id}">${esc(label)} <span style="font-size:12px;opacity:.75">${counts[id] || 0} 班</span></button>`).join('')}
          </div>
        </div>
        <div class="chips">
          ${vis.map((c) => link(`class.html?id=${c.id}`, 'class="chip-btn plain" style="text-decoration:none;color:inherit;font-size:13px"', `
            <span class="loc loc-${c.location_id}">${esc(L[c.location_id])}</span><strong>${esc(c.name)}</strong>
            <span class="sub">${esc(c.room ?? '')}・${md(c.start_date)}–${md(c.end_date)}</span>`)).join('') || '<span class="empty">這個月沒有班級</span>'}
        </div>
        <div class="cal"><div class="cal-inner">
          <div class="cal-dow">${'一二三四五六日'.split('').map((d, i) => `<div class="${i >= 5 ? 'we' : ''}">週${d}</div>`).join('')}</div>
          ${weeksHtml.join('')}
        </div></div>
        <div class="legend">
          <strong style="color:var(--text)">圖例</strong>
          ${teachers.filter((t) => t.active).map((t) => { const c = tone(t.color); return `<span><span class="sw" style="background:${c.bg};border:1px solid ${c.border};border-left:4px solid ${c.solid}"></span>${esc(t.name)}</span>`; }).join('')}
          <span><span class="sw" style="background:#F2F4F3;border:1px dashed #AEBAB5"></span>未指派</span>
          <span><span class="sw" style="background:repeating-linear-gradient(135deg,#FDECEA 0 3px,#FADAD6 3px 6px);border:1px solid #F0A9A2"></span>請假・已安排代課</span>
          <span><span class="sw" style="background:var(--danger)"></span>請假・待安排</span>
        </div>
      </section>

      <aside class="side">
        <div class="card">
          <div class="card-head"><h2>今日上課</h2><span class="sub">${now.getMonth() + 1} 月 ${now.getDate()} 日・週${WK[now.getDay()]}</span></div>
          <div class="list">${todayHtml}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>本月請假</h2>${pub ? '' : '<a href="leave.html" style="font-size:13px">登記請假</a>'}</div>
          <div class="list">${leavesHtml}</div>
        </div>
        ${alerts.length && !pub ? `<div class="card warn"><h2>待處理</h2><ul style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:1.5">${alerts.join('')}</ul></div>` : ''}
        <div class="card" ${pub ? 'hidden' : ''}>
          <h2>老師本月負荷</h2>
          <div style="display:flex;flex-direction:column;gap:10px">
            ${load.map(({ t, teach, assist, leave }) => `<div class="row" style="gap:10px;flex-wrap:nowrap">${avatar(t, 'sm')}
              <div class="grow" style="height:8px;border-radius:99px;background:var(--line-soft);overflow:hidden;display:flex"><div style="height:100%;width:${Math.round(teach / maxT * 100)}%;background:${t.color}"></div><div style="height:100%;width:${Math.round(assist / maxT * 100)}%;background:${t.color};opacity:.4"></div></div>
              <span style="font-size:12px;color:var(--text-2);min-width:118px;text-align:right">授課 ${teach} 天${assist ? `・助教 ${assist} 天` : ''}・請假 ${leave} 天</span></div>`).join('')}
          </div>
        </div>
      </aside>
    </div>
  </main>`;

  document.getElementById('prev').onclick = () => { if (--state.m < 0) { state.m = 11; state.y--; } render(); };
  document.getElementById('next').onclick = () => { if (++state.m > 11) { state.m = 0; state.y++; } render(); };
  document.getElementById('today').onclick = () => { state.y = now.getFullYear(); state.m = now.getMonth(); render(); };
  app.querySelectorAll('[data-loc]').forEach((b) => (b.onclick = () => { state.loc = b.dataset.loc; render(); }));
}
