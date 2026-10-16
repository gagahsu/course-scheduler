// 排課列編輯器（課表範本、班級排課共用）
// 每一列：老師 → 自動帶出他會教的課程 → 課程帶出預設天數
// ctx = { teachers, courses, teacherCourses: [{teacher_id, course_id}] }
import { esc, md } from './ui.js';

const num = (v) => (v === '' || v == null ? null : Number(v));

// 某位老師會教的課（只算啟用中的課）
export function coursesOf(ctx, teacherId) {
  const ids = new Set(ctx.teacherCourses.filter((x) => x.teacher_id === teacherId).map((x) => x.course_id));
  return ctx.courses.filter((c) => ids.has(c.id) && c.active);
}

export function teacherOptions(ctx, selected, { blank = '（未指定老師）' } = {}) {
  const list = ctx.teachers.filter((t) => t.active || t.id === selected);
  return (blank ? `<option value="">${esc(blank)}</option>` : '')
    + list.map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}

// 老師有設定專長時，他會教的課排在最前面，其他課放在「其他課程」
export function courseOptions(ctx, teacherId, selected) {
  const opt = (c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}（${c.default_days} 天）</option>`;
  const all = ctx.courses.filter((c) => c.active || c.id === selected);
  const mine = teacherId ? coursesOf(ctx, teacherId) : [];
  const head = '<option value="">（不指定課程）</option>';
  if (!mine.length) return head + all.map(opt).join('');
  const mineIds = new Set(mine.map((c) => c.id));
  const others = all.filter((c) => !mineIds.has(c.id));
  return head + `<optgroup label="會教的課">${mine.map(opt).join('')}</optgroup>`
    + (others.length ? `<optgroup label="其他課程">${others.map(opt).join('')}</optgroup>` : '');
}

// 換老師時：目前的課不是他會教的，就自動換成他會教的第一門課
export function autoCourse(ctx, teacherId, courseId) {
  const mine = teacherId ? coursesOf(ctx, teacherId) : [];
  if (!mine.length || mine.some((c) => c.id === courseId)) return courseId;
  return mine[0].id;
}

// 打開排課編輯器；days 給了（班級的上課日陣列）就即時顯示每一列的日期
// 回傳 { items, fd } 或 null（取消）
export function planEditor({ title, head = '', items = [], ctx, days = null, submitLabel = '儲存', onMount }) {
  return new Promise((resolve) => {
    let rows = items.map((x) => ({ teacher_id: x.teacher_id ?? null, course_id: x.course_id ?? null, days: x.days ?? 5 }));
    const C = Object.fromEntries(ctx.courses.map((c) => [c.id, c]));
    const dlg = document.createElement('dialog');
    dlg.className = 'wide';
    dlg.innerHTML = `
      <form class="dlg">
        <h2>${esc(title)}</h2>
        ${head}
        <div class="plan" id="planRows"></div>
        <button type="button" class="btn small" id="planAdd" style="align-self:flex-start">＋ 新增一列</button>
        <div class="sub" id="planSum" aria-live="polite"></div>
        <div class="dlg-actions">
          <button type="button" class="btn" data-act="cancel">取消</button>
          <button type="submit" class="btn primary">${esc(submitLabel)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    const box = dlg.querySelector('#planRows');
    const sum = dlg.querySelector('#planSum');

    const draw = () => {
      let pos = 0;
      box.innerHTML = rows.map((r, i) => {
        let span = '';
        if (days) {
          span = pos >= days.length ? '<span class="pill bad">超出上課日</span>'
            : `${md(days[pos])} – ${md(days[Math.min(pos + r.days, days.length) - 1])}`;
        }
        pos += r.days;
        return `<div class="plan-row" data-i="${i}">
          <span class="plan-no" data-grip title="按住拖曳調整順序" aria-hidden="true"><i class="grip"></i>${i + 1}</span>
          <label class="field">老師<select data-k="teacher_id">${teacherOptions(ctx, r.teacher_id)}</select></label>
          <label class="field">課程<select data-k="course_id">${courseOptions(ctx, r.teacher_id, r.course_id)}</select></label>
          <label class="field">天數<input type="number" min="1" step="1" data-k="days" value="${r.days}" required></label>
          <span class="plan-span">${span}</span>
          <span class="plan-tools">
            <button type="button" class="btn small icon" data-mv="-1" aria-label="上移第 ${i + 1} 列" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn small icon" data-mv="1" aria-label="下移第 ${i + 1} 列" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button>
            <button type="button" class="btn small icon danger" data-rm aria-label="刪除第 ${i + 1} 列">✕</button>
          </span>
        </div>`;
      }).join('') || '<div class="empty">還沒有任何一列，按「新增一列」開始排</div>';
      const total = rows.reduce((s, r) => s + r.days, 0);
      if (!days) sum.textContent = `合計 ${total} 天`;
      else {
        const left = days.length - total;
        sum.textContent = `合計 ${total} 天／這個班共 ${days.length} 個上課日（已扣停課日）`
          + (left > 0 ? `，剩 ${left} 天未指派` : left < 0 ? `，超出 ${-left} 天，多的會被略過` : '，剛好排滿');
      }
    };

    box.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const r = rows[Number(e.target.closest('.plan-row').dataset.i)];
      if (k === 'days') r.days = Math.max(1, Math.round(Number(e.target.value) || 1));
      else r[k] = num(e.target.value);
      if (k === 'teacher_id') {
        const c = autoCourse(ctx, r.teacher_id, r.course_id);
        if (c !== r.course_id) { r.course_id = c; r.days = C[c].default_days; }
      }
      if (k === 'course_id' && r.course_id) r.days = C[r.course_id].default_days;
      draw();
    });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const i = Number(b.closest('.plan-row').dataset.i);
      if (b.dataset.mv) {
        const j = i + Number(b.dataset.mv);
        [rows[i], rows[j]] = [rows[j], rows[i]];
      } else if (b.hasAttribute('data-rm')) rows.splice(i, 1);
      draw();
    });
    // 拖曳排序：按住左邊的把手上下拖（pointer events，滑鼠和觸控都能用）
    box.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('[data-grip]');
      if (!grip || e.button !== 0) return;
      e.preventDefault();
      const row = grip.closest('.plan-row');
      const from = Number(row.dataset.i);
      let to = from, timer = null, lastY = e.clientY;
      row.classList.add('dragging');
      grip.setPointerCapture(e.pointerId);
      const els = () => [...box.querySelectorAll('.plan-row')];
      const mark = () => {
        els().forEach((el) => el.classList.remove('drop-before', 'drop-after'));
        // 找出游標在哪一列的上半／下半
        let target = rows.length;
        for (const el of els()) {
          const r = el.getBoundingClientRect();
          if (lastY < r.top + r.height / 2) { target = Number(el.dataset.i); break; }
        }
        to = target > from ? target - 1 : target;
        if (to === from) return;
        const list = els();
        if (target < list.length) list[target].classList.add('drop-before');
        else list[list.length - 1].classList.add('drop-after');
      };
      // 拖到清單上下邊緣時自動捲動
      const autoScroll = () => {
        const r = box.getBoundingClientRect();
        const edge = 40;
        if (lastY < r.top + edge) box.scrollTop -= 12;
        else if (lastY > r.bottom - edge) box.scrollTop += 12;
        else return;
        mark();
      };
      const move = (ev) => { lastY = ev.clientY; mark(); };
      const up = () => {
        clearInterval(timer);
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
        if (to !== from) { const [x] = rows.splice(from, 1); rows.splice(to, 0, x); }
        draw();
      };
      timer = setInterval(autoScroll, 30);
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });

    dlg.querySelector('#planAdd').onclick =() => { rows.push({ teacher_id: null, course_id: null, days: 5 }); draw(); };

    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-act=cancel]').onclick = () => done(null);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      done({ items: rows.map((r) => ({ ...r })), fd: new FormData(e.target) });
    });

    draw();
    dlg.showModal();
    onMount?.(dlg, { setRows: (next) => { rows = next.map((x) => ({ ...x })); draw(); } });
  });
}
