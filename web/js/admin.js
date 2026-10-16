// 基本資料：老師、課程、課表範本（停課日、補班日在「假日設定」頁）
import * as api from './api.js';
import { boot } from './auth.js';
import { esc, avatar, toast, formDialog, confirmDialog } from './ui.js';
import { planEditor } from './plan.js';

await boot('admin.html');
const app = document.getElementById('app');
render();

async function render() {
  const [teachers, courses, teacherCourses, curricula] = await Promise.all([
    api.listTeachers(), api.listCourses(), api.listTeacherCourses(), api.listCurricula(),
  ]);
  const T = Object.fromEntries(teachers.map((t) => [t.id, t]));
  const C = Object.fromEntries(courses.map((c) => [c.id, c]));
  const ctx = { teachers, courses, teacherCourses };
  const coursesOfT = (tid) => teacherCourses.filter((x) => x.teacher_id === tid).map((x) => C[x.course_id]).filter(Boolean);
  const teachersOfC = (cid) => teacherCourses.filter((x) => x.course_id === cid).map((x) => T[x.teacher_id]).filter(Boolean);
  const pills = (list) => list.length ? `<span class="mini">${list.map((x) => `<span class="pill mute">${esc(x.name)}</span>`).join('')}</span>` : '<span class="sub">—</span>';

  app.innerHTML = `
  <main class="page">
    <h1 class="page-title">基本資料</h1>
    <div class="split">
      <div class="main" style="display:flex;flex-direction:column;gap:16px">
        <section class="card">
          <div class="card-head"><h2>老師</h2><button class="btn small primary" id="addT">新增老師</button></div>
          <div class="scroll-x"><table class="tbl" style="min-width:620px">
            <thead><tr><th>老師</th><th>會教的課</th><th>顏色</th><th>可代課</th><th>狀態</th><th><span hidden>操作</span></th></tr></thead>
            <tbody>${teachers.map((t) => `<tr>
              <td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(t)}<strong>${esc(t.name)}</strong></span></td>
              <td class="wrap">${pills(coursesOfT(t.id))}</td>
              <td><span style="display:inline-block;width:18px;height:18px;border-radius:5px;background:${esc(t.color)};vertical-align:-4px"></span> <span class="sub">${esc(t.color)}</span></td>
              <td>${t.can_substitute ? '可以' : '—'}</td>
              <td>${t.active ? '<span class="pill ok">在職</span>' : '<span class="pill mute">停用</span>'}</td>
              <td class="actions"><button class="btn small" data-t="${t.id}">編輯</button> <button class="btn small danger" data-del-t="${t.id}">刪除</button></td></tr>`).join('')}</tbody>
          </table></div>
        </section>

        <section class="card">
          <div class="card-head"><h2>課程</h2><button class="btn small primary" id="addC">新增課程</button></div>
          ${courses.length ? `<div class="scroll-x"><table class="tbl" style="min-width:560px">
            <thead><tr><th>課程</th><th>預設天數</th><th>授課老師</th><th>狀態</th><th><span hidden>操作</span></th></tr></thead>
            <tbody>${courses.map((c) => `<tr>
              <td><strong>${esc(c.name)}</strong>${c.note ? `<div class="sub">${esc(c.note)}</div>` : ''}</td>
              <td>${c.default_days} 天</td>
              <td class="wrap">${pills(teachersOfC(c.id))}</td>
              <td>${c.active ? '<span class="pill ok">使用中</span>' : '<span class="pill mute">停用</span>'}</td>
              <td class="actions"><button class="btn small" data-c="${c.id}">編輯</button> <button class="btn small danger" data-del-c="${c.id}">刪除</button></td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty">還沒有課程。先新增課程，再到老師那邊勾選他會教哪些課。</div>'}
        </section>

        <section class="card">
          <div class="card-head"><h2>課表範本</h2><button class="btn small primary" id="addP">新增範本</button></div>
          <div class="sub" style="margin-bottom:10px">一個班依序上哪些課、各幾天、預設誰教。新增班級後套用範本，就會依上課日自動排出授課區段。</div>
          ${curricula.map((p) => {
            const total = p.curriculum_items.reduce((s, x) => s + x.days, 0);
            return `<div class="row" style="padding:10px 0;border-top:1px solid var(--line-soft);align-items:flex-start;flex-wrap:nowrap">
              <div class="grow"><strong>${esc(p.name)}</strong> <span class="sub">共 ${total} 天</span>
                <div class="sub" style="margin-top:4px">${p.curriculum_items.map((x) => `${esc(C[x.course_id]?.name ?? '（未指定課程）')} ${x.days}天${x.teacher_id ? `・${esc(T[x.teacher_id]?.name ?? '')}` : ''}`).join(' → ') || '（空的）'}</div></div>
              <button class="btn small" data-p="${p.id}">編輯</button>
              <button class="btn small danger" data-del-p="${p.id}">刪除</button></div>`;
          }).join('') || '<div class="empty">還沒有範本</div>'}
        </section>
      </div>

    </div>
  </main>`;

  // ---------- 老師 ----------
  const editT = async (t = { color: '#2B8CC4', can_substitute: true, active: true }) => {
    const r = await formDialog({ title: t.id ? '編輯老師' : '新增老師', fields: [
      { name: 'name', label: '稱呼（例：董哥）', value: t.name, required: true },
      { name: 'short_name', label: '頭像字（一個字，例：董）', value: t.short_name, required: true },
      { name: 'course_ids', label: '會教的課（排課時選這位老師會自動帶出）', type: 'checkboxes',
        value: t.id ? coursesOfT(t.id).map((c) => c.id) : [], options: courses.filter((c) => c.active).map((c) => [c.id, c.name]),
        empty: '還沒有課程，直接在下面輸入新增', addable: '輸入新課程名稱，按 Enter 新增' },
      { name: 'color', label: '顏色', type: 'color', value: t.color },
      { name: 'can_substitute', label: '可以代課', type: 'checkbox', value: t.can_substitute },
      { name: 'active', label: '在職（停用後不會出現在選單）', type: 'checkbox', value: t.active },
    ] });
    if (!r) return;
    const { course_ids, ...row } = r;
    try {
      const saved = await api.saveTeacher({ ...(t.id ? { id: t.id } : {}), ...row });
      // 對話框裡新加的課程（值是 "new:名稱"）先建立；同名的停用課程就直接沿用
      const ids = [];
      for (const v of course_ids) {
        if (!v.startsWith('new:')) { ids.push(Number(v)); continue; }
        const name = v.slice(4);
        const same = courses.find((c) => c.name === name);
        if (same && !same.active) await api.saveCourse({ id: same.id, active: true });
        ids.push(same ? same.id : (await api.saveCourse({ name, default_days: 5 })).id);
      }
      // 停用中的課不在勾選清單裡，保留原本的設定
      const hidden = t.id ? coursesOfT(t.id).filter((c) => !c.active).map((c) => c.id) : [];
      await api.setTeacherCourses(saved.id, [...new Set([...ids, ...hidden])]);
      toast('已儲存'); render();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('addT').onclick = () => editT();
  app.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => editT(T[b.dataset.t])));
  app.querySelectorAll('[data-del-t]').forEach((b) => (b.onclick = async () => {
    const t = T[b.dataset.delT];
    if (!(await confirmDialog(`確定刪除老師 ${t.name}？`, '刪除'))) return;
    try { await api.deleteTeacher(t.id); toast(`已刪除 ${t.name}`); render(); }
    catch (e) {
      toast(e.message.includes('不能刪除') ? `${t.name} 還有授課、請假或代課紀錄，不能刪除；不再上課的話請編輯改成「停用」` : e.message, true);
    }
  }));

  // ---------- 課程 ----------
  const editC = async (c = { default_days: 5, active: true }) => {
    const r = await formDialog({ title: c.id ? '編輯課程' : '新增課程', fields: [
      { name: 'name', label: '課程名稱（例：Java 基礎）', value: c.name, required: true },
      { name: 'default_days', label: '預設天數（排課時自動帶入，可再改）', type: 'number', min: 1, value: c.default_days, required: true },
      { name: 'teacher_ids', label: '授課老師', type: 'checkboxes',
        value: c.id ? teachersOfC(c.id).map((t) => t.id) : [], options: teachers.filter((t) => t.active).map((t) => [t.id, t.name]) },
      { name: 'note', label: '備註', type: 'textarea', value: c.note },
      { name: 'active', label: '使用中（停用後不會出現在選單）', type: 'checkbox', value: c.active },
    ] });
    if (!r) return;
    const { teacher_ids, ...row } = r;
    const days = Number(row.default_days);
    if (!Number.isInteger(days) || days < 1) { toast('預設天數要是大於 0 的整數', true); return; }
    try {
      const saved = await api.saveCourse({ ...(c.id ? { id: c.id } : {}), ...row, default_days: days });
      const hidden = c.id ? teachersOfC(c.id).filter((t) => !t.active).map((t) => t.id) : [];
      await api.setCourseTeachers(saved.id, [...teacher_ids.map(Number), ...hidden]);
      toast('已儲存'); render();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('addC').onclick = () => editC();
  app.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => editC(C[b.dataset.c])));
  app.querySelectorAll('[data-del-c]').forEach((b) => (b.onclick = async () => {
    const c = C[b.dataset.delC];
    if (!(await confirmDialog(`確定刪除課程 ${c.name}？課表範本裡的這門課會一起移除，已排好的授課區段會變成「未指定課程」`, '刪除'))) return;
    try { await api.deleteCourse(c.id); toast(`已刪除 ${c.name}`); render(); } catch (e) { toast(e.message, true); }
  }));

  // ---------- 課表範本 ----------
  const editP = async (p = { curriculum_items: [] }) => {
    const r = await planEditor({
      title: p.id ? '編輯課表範本' : '新增課表範本',
      ctx,
      items: p.curriculum_items,
      head: `<div class="grid2">
        <label class="field">範本名稱（例：Java 全端班）<input name="name" value="${esc(p.name ?? '')}" required></label>
        <label class="field">備註<input name="note" value="${esc(p.note ?? '')}"></label></div>
        <div class="sub">依上課順序排列。選老師會自動帶出他會教的課，選課程會帶出預設天數。</div>`,
    });
    if (!r) return;
    try {
      await api.saveCurriculum({ id: p.id, name: r.fd.get('name').trim(), note: r.fd.get('note').trim(), items: r.items });
      toast('已儲存'); render();
    } catch (e) { toast(e.message, true); }
  };
  document.getElementById('addP').onclick = () => editP();
  app.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => editP(curricula.find((p) => p.id === Number(b.dataset.p)))));
  app.querySelectorAll('[data-del-p]').forEach((b) => (b.onclick = async () => {
    const p = curricula.find((x) => x.id === Number(b.dataset.delP));
    if (!(await confirmDialog(`確定刪除範本 ${p.name}？已經排好的班級不受影響`, '刪除'))) return;
    try { await api.deleteCurriculum(p.id); toast('已刪除'); render(); } catch (e) { toast(e.message, true); }
  }));

}
