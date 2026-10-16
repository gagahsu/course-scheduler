// 老師請假：誰在什麼時候請假（月總覽）＋登記請假與代課
import * as api from './api.js';
import { boot } from './auth.js';
import { esc, ymd, parse, addDays, today, mdw, range, isWeekend, eachDay, WK, avatar, tone, toast, confirmDialog } from './ui.js';

await boot('leave.html');
const app = document.getElementById('app');

const teachers = (await api.listTeachers()).filter((t) => t.active);
const allTeachers = await api.listTeachers();
const T = Object.fromEntries(allTeachers.map((t) => [t.id, t]));
const now = parse(today());
const state = { y: now.getFullYear(), m: now.getMonth() };
const form = { teacherId: null, start: today(), end: today(), type: '事假', note: '', subs: {} };
const TYPES = ['事假', '病假', '特休', '公假', '其他'];

render();

async function render() {
  const { y, m } = state;
  const nDays = new Date(y, m + 1, 0).getDate();
  const mS = ymd(new Date(y, m, 1)), mE = ymd(new Date(y, m, nDays));
  const days = [...eachDay(mS, mE)];
  const td = today();

  let sessions, leaves;
  try { [sessions, leaves] = await Promise.all([api.listSessions(mS, mE), api.listLeaves(mS, mE)]); }
  catch (e) { toast(e.message, true); return; }
  const leaveSessions = await api.listSessionsByLeaves(leaves.map((l) => l.id));

  // ---------- 統計 ----------
  let personDays = 0;
  for (const l of leaves) for (const k of eachDay(l.start_date < mS ? mS : l.start_date, l.end_date > mE ? mE : l.end_date)) if (!isWeekend(k)) personDays++;
  const hit = leaveSessions.filter((s) => s.day >= mS && s.day <= mE).length;
  const pending = leaveSessions.filter((s) => s.status === 'uncovered').length;

  // ---------- 老師 × 日期 ----------
  const cols = `grid-template-columns: 92px repeat(${nDays}, minmax(0, 1fr))`;
  const headRow = `<span></span>${days.map((k) => `<span class="h ${k === td ? 'today' : isWeekend(k) ? 'we' : ''}">${parse(k).getDate()}<br>${WK[parse(k).getDay()]}</span>`).join('')}`;
  const rows = teachers.map((t) => {
    const c = tone(t.color);
    const cells = days.map((k) => {
      const lv = leaves.find((l) => l.teacher_id === t.id && k >= l.start_date && k <= l.end_date);
      const teach = sessions.filter((s) => s.actual_teacher_id === t.id && s.day === k);
      const assist = sessions.filter((s) => s.assistant_ids?.includes(t.id) && s.day === k);
      let cls = 'c', style = '', mark = '', title = mdw(k);
      if (lv && !isWeekend(k)) { cls += ' leave'; mark = '假'; title += ` ${t.name} ${lv.type}`; }
      else if (assist.length && !teach.length) {
        style = `background:${c.bg};border-color:${c.border}`; mark = '助';
        title += ' ' + assist.map((s) => `${s.location_name} ${s.class_name}（助教）`).join('、');
      }
      else if (teach.length) {
        const isSub = teach.some((s) => s.sub_teacher_id === t.id);
        if (isSub) { cls += ' sub'; style = `background:${c.solid};border-color:${c.solid}`; mark = '代'; }
        else style = `background:${c.bg};border-color:${c.border}`;
        title += ' ' + teach.map((s) => `${s.location_name} ${s.class_name}${isSub ? '（代課）' : ''}`).join('、');
      } else if (isWeekend(k)) { cls += ' we'; title += ' 週末'; }
      else title += ' 沒課';
      if (k === td) cls += ' today';
      return `<span class="${cls}" style="${style}" title="${esc(title)}">${mark}</span>`;
    }).join('');
    return `<span class="who">${avatar(t, 'sm')}${esc(t.name)}</span>${cells}`;
  }).join('');

  // ---------- 紀錄 ----------
  const recs = leaves.slice().sort((a, b) => a.start_date.localeCompare(b.start_date)).map((l) => {
    const aff = leaveSessions.filter((s) => s.leave_id === l.id);
    const open = aff.filter((s) => s.status === 'uncovered');
    const subs = aff.filter((s) => s.sub_teacher_id).map((s) => `${parse(s.day).getDate()} 日 ${T[s.sub_teacher_id].name}`);
    const pill = !aff.length ? '<span class="pill mute">無需代課</span>'
      : open.length ? `<a class="pill bad" href="class.html?id=${open[0].class_id}&day=${open[0].day}&to=${open.filter((s) => s.class_id === open[0].class_id).at(-1).day}" style="text-decoration:none">${open.length} 堂待安排 →</a>`
      : '<span class="pill ok">已安排</span>';
    return `<tr>
      <td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(T[l.teacher_id])}<strong>${esc(T[l.teacher_id].name)}</strong></span></td>
      <td>${esc(range(l.start_date, l.end_date))}</td><td>${esc(l.type)}</td>
      <td class="wrap" style="font-size:13px;color:var(--text-2)">${aff.length ? esc([...new Set(aff.map((s) => `${s.location_name} ${s.class_name}`))].join('、')) : esc(l.note || '當天沒有排課')}</td>
      <td class="wrap" style="font-size:13px">${esc(subs.join('、') || '—')}</td>
      <td>${pill}</td>
      <td class="actions"><button class="btn small danger" data-del="${l.id}" aria-label="刪除 ${esc(T[l.teacher_id].name)} 的請假">刪除</button></td></tr>`;
  }).join('');

  app.innerHTML = `
  <main class="page">
    <div class="row">
      <div class="row" style="gap:6px">
        <button class="btn icon" id="prev" aria-label="上個月"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <button class="btn icon" id="next" aria-label="下個月"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      <h1 class="page-title">老師請假<small>${y - 1911} 年 ${m + 1} 月</small></h1>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">本月請假筆數</div><div class="value">${leaves.length} 筆</div></div>
      <div class="tile"><div class="label">請假人天</div><div class="value">${personDays} 天</div></div>
      <div class="tile"><div class="label">受影響課堂</div><div class="value">${hit} 堂</div></div>
      <div class="tile ${pending ? 'alert' : ''}"><div class="label">待安排代課</div><div class="value">${pending} 堂</div></div>
    </div>
    <div class="split">
      <div class="main">
        <section class="card">
          <div class="card-head" style="flex-wrap:wrap"><h2>誰在什麼時候請假</h2>
            <div class="legend" style="font-size:12px">
              <span><span class="sw" style="background:var(--danger);width:14px;height:14px"></span>請假</span>
              <span><span class="sw" style="background:#E3EEF0;border:1px solid #C7D6D2;width:14px;height:14px"></span>有課（老師色）</span>
              <span><span class="sw" style="background:#44534E;width:14px;height:14px"></span>代課（深色＝代別人的課）</span>
              <span><span class="sw" style="background:#E3EEF0;border:1px solid #C7D6D2;width:14px;height:14px;font-size:9px;text-align:center;line-height:12px">助</span>助教</span>
            </div></div>
          <div class="scroll-x"><div class="lgrid" style="${cols};min-width:${92 + nDays * 30}px">${headRow}${rows}</div></div>
        </section>
        <section class="card">
          <div class="card-head"><h2>請假紀錄</h2></div>
          ${recs ? `<div class="scroll-x"><table class="tbl" style="min-width:760px">
            <thead><tr><th>老師</th><th>日期</th><th>假別</th><th>影響班級</th><th>代課</th><th>狀態</th><th><span hidden>操作</span></th></tr></thead>
            <tbody>${recs}</tbody></table></div>` : '<div class="empty">這個月沒有請假紀錄</div>'}
        </section>
      </div>
      <section class="side card accent" id="formCard" aria-labelledby="ftitle"></section>
    </div>
  </main>`;

  document.getElementById('prev').onclick = () => { if (--state.m < 0) { state.m = 11; state.y--; } render(); };
  document.getElementById('next').onclick = () => { if (++state.m > 11) { state.m = 0; state.y++; } render(); };
  app.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('刪除這筆請假？相關的代課安排也會一起刪除', '刪除'))) return;
    try { await api.deleteLeave(Number(b.dataset.del)); toast('已刪除'); render(); } catch (e) { toast(e.message, true); }
  }));
  renderForm();
}

// ---------- 登記請假表單 ----------
const statusCache = new Map();
async function dayStatus(day) {
  if (!statusCache.has(day)) statusCache.set(day, await api.teacherDayStatus(day));
  return statusCache.get(day);
}

let formSeq = 0;
async function renderForm() {
  const seq = ++formSeq;                 // 只畫最新一次的結果，避免快速點選時舊結果蓋掉新結果
  let affected = [], assisting = [];
  if (form.teacherId && form.start && form.end && form.end >= form.start) {
    try {
      [affected, assisting] = await Promise.all([
        api.listSessions(form.start, form.end, { plannedTeacherId: form.teacherId }),
        api.listAssistingSessions(form.teacherId, form.start, form.end),
      ]);
      affected = affected.filter((s) => s.status !== 'unassigned');
      await Promise.all([...new Set(affected.map((s) => s.day))].map(dayStatus));
    } catch (e) { toast(e.message, true); }
  }
  if (seq !== formSeq) return;
  const box = document.getElementById('formCard');
  if (!box) return;

  const affHtml = !form.teacherId ? '<div class="empty">先選老師</div>'
    : !affected.length ? `<div class="empty" style="padding:12px;border-radius:12px;background:var(--bg)">${esc(T[form.teacherId].name)} 這段期間沒有排課，不需要安排代課。</div>`
    : affected.map((s) => {
      const key = `${s.class_id}|${s.day}`;
      const st = statusCache.get(s.day) || [];
      return `<div class="affect">
        <div class="row" style="gap:8px"><span class="loc loc-${s.location_id}">${esc(s.location_name)}</span><strong>${esc(s.class_name)}</strong><span class="sub">${esc(mdw(s.day))}</span>
          ${s.status === 'covered' ? `<span class="pill ok">已有 ${esc(T[s.sub_teacher_id].name)} 代課</span>` : ''}</div>
        <div class="cands">${st.filter((x) => x.teacher_id !== form.teacherId && x.can_substitute).map((x) => {
          const bad = x.on_leave || x.busy_class_id;
          const note = x.on_leave ? '當天請假' : x.busy_class_id ? `在${x.busy_location} ${x.busy_class_name} 上課` : '可代課';
          return `<button type="button" class="cand" data-k="${key}" data-t="${x.teacher_id}" aria-pressed="${form.subs[key] === x.teacher_id}" ${bad ? 'disabled' : ''}>
            ${avatar(T[x.teacher_id], 'sm')}<span class="name">${esc(x.name)}</span><span class="note">${esc(note)}</span></button>`;
        }).join('')}</div></div>`;
    }).join('');

  // 「全部套用」：所有受影響的課都有空的老師
  const free = affected.length ? allTeachers.filter((t) => t.id !== form.teacherId && t.active && affected.every((s) => {
    const x = (statusCache.get(s.day) || []).find((r) => r.teacher_id === t.id);
    return x && x.can_substitute && !x.on_leave && !x.busy_class_id;
  })) : [];

  const chosen = Object.keys(form.subs).filter((k) => affected.some((s) => `${s.class_id}|${s.day}` === k)).length;

  box.innerHTML = `
    <div><h2 id="ftitle" style="margin-bottom:4px">登記請假</h2><div class="sub">選好老師和日期，系統會列出受影響的課與可代課的老師</div></div>
    <div><div class="sub" style="margin-bottom:8px">請假老師</div>
      <div class="chips" role="radiogroup" aria-label="請假老師">${teachers.map((t) =>
        `<button type="button" class="chip-btn" role="radio" data-teacher="${t.id}" aria-checked="${form.teacherId === t.id}">${avatar(t, 'sm')}${esc(t.name)}</button>`).join('')}</div></div>
    <div class="grid2">
      <label class="field">開始<input type="date" id="fStart" value="${form.start}"></label>
      <label class="field">結束<input type="date" id="fEnd" value="${form.end}" min="${form.start}"></label>
    </div>
    <div><div class="sub" style="margin-bottom:8px">假別</div>
      <div class="chips" role="radiogroup" aria-label="假別">${TYPES.map((x) =>
        `<button type="button" class="chip-btn plain" role="radio" data-type="${x}" aria-checked="${form.type === x}">${x}</button>`).join('')}</div></div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="row" style="justify-content:space-between"><span class="sub">受影響的課 ${affected.length ? `（${affected.length} 堂）` : ''}</span>
        ${free.length > 0 && affected.length > 1 ? `<label class="sub">全部由
          <select id="fAll" style="height:32px;border-radius:8px;border:1px solid var(--input);padding:0 8px"><option value="">—</option>${free.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select> 代課</label>` : ''}</div>
      ${affHtml}
      ${assisting.length ? `<div class="sub" style="padding:10px 12px;border-radius:12px;background:var(--bg)">另有 ${assisting.length} 天擔任助教（${esc([...new Set(assisting.map((s) => `${s.location_name} ${s.class_name}`))].join('、'))}），請假當天會自動標示缺席，不需要代課。</div>` : ''}
    </div>
    <label class="field">備註<textarea id="fNote" rows="2" placeholder="例如：已交接教材進度">${esc(form.note)}</textarea></label>
    <button class="btn primary" id="fSubmit" ${form.teacherId ? '' : 'disabled'} style="height:46px">
      送出${affected.length ? `（${chosen}/${affected.length} 堂已安排代課）` : ''}</button>`;

  box.querySelectorAll('[data-teacher]').forEach((b) => (b.onclick = () => { form.teacherId = Number(b.dataset.teacher); form.subs = {}; renderForm(); }));
  box.querySelectorAll('[data-type]').forEach((b) => (b.onclick = () => { form.type = b.dataset.type; renderForm(); }));
  box.querySelector('#fStart').onchange = (e) => { form.start = e.target.value; if (form.end < form.start) form.end = form.start; renderForm(); };
  box.querySelector('#fEnd').onchange = (e) => { form.end = e.target.value; renderForm(); };
  box.querySelector('#fNote').oninput = (e) => { form.note = e.target.value; };
  box.querySelectorAll('.cand').forEach((b) => (b.onclick = () => {
    const k = b.dataset.k, t = Number(b.dataset.t);
    form.subs[k] = form.subs[k] === t ? undefined : t;
    renderForm();
  }));
  box.querySelector('#fAll')?.addEventListener('change', (e) => {
    const t = Number(e.target.value);
    if (t) for (const s of affected) form.subs[`${s.class_id}|${s.day}`] = t;
    renderForm();
  });
  box.querySelector('#fSubmit').onclick = async () => {
    const subs = affected.filter((s) => s.status !== 'covered' && form.subs[`${s.class_id}|${s.day}`])
      .map((s) => ({ class_id: s.class_id, day: s.day, sub_teacher_id: form.subs[`${s.class_id}|${s.day}`] }));
    try {
      await api.registerLeave({ teacherId: form.teacherId, start: form.start, end: form.end, type: form.type, note: form.note, subs });
      toast(`已登記 ${T[form.teacherId].name} 請假${subs.length < affected.length ? `，還有 ${affected.length - subs.length} 堂待安排代課` : ''}`);
      Object.assign(form, { teacherId: null, note: '', subs: {} });
      statusCache.clear();
      const d = parse(form.start); state.y = d.getFullYear(); state.m = d.getMonth();
      render();
    } catch (e) { toast(e.message, true); }
  };
}
