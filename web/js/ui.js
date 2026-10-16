// 共用小工具：跳脫、日期、顏色、頁首、提示訊息

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- 日期（一律用本地時區的 YYYY-MM-DD 字串） ----------
export const WK = '日一二三四五六';
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
export const today = () => ymd(new Date());
export const md = (s) => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
export const mdw = (s) => `${md(s)}（${WK[parse(s).getDay()]}）`;
export const roc = (s) => { const d = parse(s); return `${d.getFullYear() - 1911}/${d.getMonth() + 1}/${d.getDate()}（${WK[d.getDay()]}）`; };
export const isWeekend = (s) => { const w = parse(s).getDay(); return w === 0 || w === 6; };
export const range = (a, b) => (a === b ? mdw(a) : `${mdw(a)} – ${mdw(b)}`);
export function* eachDay(a, b) { for (let k = a; k <= b; k = addDays(k, 1)) yield k; }

// ---------- 老師顏色：從一個主色算出淺底、框線、文字色 ----------
const hexToRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (rgb, to, t) => rgb.map((c, i) => Math.round(c + (to[i] - c) * t));
const css = (rgb) => `rgb(${rgb.join(',')})`;
export function tone(hex) {
  const rgb = hexToRgb(hex || '#7A8984');
  return {
    solid: css(rgb),
    bg: css(mix(rgb, [255, 255, 255], 0.86)),
    border: css(mix(rgb, [255, 255, 255], 0.6)),
    fg: css(mix(rgb, [0, 0, 0], 0.45)),
  };
}
export function avatar(t, size = '') {
  if (!t) return `<span class="avatar ${size}" style="background:#EEF2F0;color:#56645F;border-color:#D3DCD8">？</span>`;
  const c = tone(t.color);
  return `<span class="avatar ${size}" style="background:${c.bg};color:${c.fg};border-color:${c.border}" aria-hidden="true">${esc(t.short_name)}</span>`;
}
export const teacherStyle = (t) => { const c = tone(t.color); return `background:${c.bg};color:${c.fg};border-color:${c.border};border-left-color:${c.solid}`; };
export const locBadge = (cls) => `<span class="loc loc-${cls.location_id}">${esc(cls.location_name ?? cls.locations?.name ?? '')}</span>`;

// ---------- 頁首 ----------
const ICON = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
const PAGES = [['index.html', '行事曆'], ['class.html', '班級'], ['leave.html', '請假紀錄'], ['holidays.html', '假日設定'], ['admin.html', '基本資料']];
// publicView：沒登入的訪客只看得到行事曆
export function header(active, email, { publicView = false } = {}) {
  const el = document.createElement('header');
  el.className = 'topbar';
  const pages = publicView ? PAGES.slice(0, 1) : PAGES;
  el.innerHTML = `
    <a class="brand" href="index.html"><span class="brand-mark">${ICON}</span>課務排程</a>
    <nav class="nav" aria-label="主選單">
      ${pages.map(([href, label]) => `<a href="${href}" ${href === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
    </nav>
    <div class="topbar-right">
      ${publicView ? '<button type="button" class="btn small" id="signin">管理員登入</button>'
        : `<button type="button" class="btn small" id="tourBtn" aria-haspopup="menu">使用導覽</button><span class="who">${esc(email ?? '')}</span><button type="button" class="btn small" id="signout">登出</button>`}
    </div>`;
  document.body.prepend(el);
  return el;
}

// ---------- 提示訊息 ----------
let toastTimer;
export function toast(msg, isError = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.textContent = msg;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 6000 : 3000);
}

// ---------- 對話框 ----------
// fields: [{name, label, type, value, options:[[v,label]], required}]
//   type 'checkboxes'：多選，value 是陣列，回傳選到的值（字串陣列）
// onMount(dlg)：對話框出現後呼叫，用來掛連動選單之類的事件
export function formDialog({ title, fields, submitLabel = '儲存', danger, onMount }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <form method="dialog" class="dlg">
        <h2>${esc(title)}</h2>
        ${fields.map((f) => fieldHtml(f)).join('')}
        <div class="dlg-actions">
          ${danger ? `<button type="button" class="btn danger" data-act="danger" style="margin-right:auto">${esc(danger)}</button>` : ''}
          <button type="button" class="btn" data-act="cancel">取消</button>
          <button type="submit" class="btn primary">${esc(submitLabel)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-act=cancel]').onclick = () => done(null);
    dlg.querySelector('[data-act=danger]')?.addEventListener('click', () => done({ __danger: true }));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    dlg.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const out = {};
      for (const f of fields) {
        if (f.type === 'checkboxes') { out[f.name] = fd.getAll(f.name); continue; }
        let v = f.type === 'checkbox' ? fd.has(f.name) : fd.get(f.name);
        if (typeof v === 'string') v = v.trim();
        out[f.name] = v === '' ? null : v;
      }
      done(out);
    });
    dlg.showModal();
    wireAddable(dlg);
    onMount?.(dlg);
  });
}
const checkHtml = (name, v, l, checked) =>
  `<label class="check"><input type="checkbox" name="${name}" value="${esc(v)}" ${checked ? 'checked' : ''}>${esc(l)}</label>`;

// checkboxes 的 addable：在對話框裡直接加新項目，值是 "new:名稱"，存檔時由呼叫端建立
function wireAddable(dlg) {
  dlg.querySelectorAll('.checks').forEach((fs) => {
    const input = fs.querySelector('[data-add-input]');
    if (!input) return;
    const name = fs.querySelector('input[type=checkbox]')?.name ?? fs.dataset.name;
    const add = () => {
      const label = input.value.trim();
      input.value = '';
      input.focus();
      if (!label) return;
      const existing = [...fs.querySelectorAll('.check')].find((x) => x.textContent.trim() === label);
      if (existing) { existing.querySelector('input').checked = true; return; }
      fs.querySelector('[data-empty]')?.remove();
      fs.querySelector('.chips').insertAdjacentHTML('beforeend', checkHtml(name, 'new:' + label, label, true));
    };
    fs.querySelector('[data-add-btn]').onclick = add;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  });
}

function fieldHtml(f) {
  const id = 'f_' + f.name;
  const req = f.required ? 'required' : '';
  if (f.type === 'select') {
    return `<label class="field" for="${id}">${esc(f.label)}<select id="${id}" name="${f.name}" ${req}>
      ${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select></label>`;
  }
  if (f.type === 'checkboxes') {
    const on = (f.value ?? []).map(String);
    return `<fieldset class="field checks" data-name="${f.name}"><legend>${esc(f.label)}</legend><div class="chips">
      ${f.options.map(([v, l]) => checkHtml(f.name, v, l, on.includes(String(v)))).join('') || `<span class="sub" data-empty>${esc(f.empty ?? '還沒有資料')}</span>`}
    </div>
    ${f.addable ? `<div class="check-add"><input type="text" data-add-input placeholder="${esc(f.addable)}" aria-label="${esc(f.addable)}">
      <button type="button" class="btn small" data-add-btn>新增</button></div>` : ''}
    </fieldset>`;
  }
  if (f.type === 'number') {
    return `<label class="field" for="${id}">${esc(f.label)}<input id="${id}" name="${f.name}" type="number" min="${f.min ?? ''}" value="${esc(f.value ?? '')}" ${req}></label>`;
  }
  if (f.type === 'checkbox') {
    return `<label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
  }
  if (f.type === 'textarea') {
    return `<label class="field" for="${id}">${esc(f.label)}<textarea id="${id}" name="${f.name}" rows="2">${esc(f.value ?? '')}</textarea></label>`;
  }
  return `<label class="field" for="${id}">${esc(f.label)}<input id="${id}" name="${f.name}" type="${f.type ?? 'text'}" value="${esc(f.value ?? '')}" ${req}></label>`;
}

export async function confirmDialog(message, okLabel = '確定') {
  const r = await formDialog({ title: message, fields: [], submitLabel: okLabel });
  return r !== null;
}

export const STATUS = {
  normal: '正常',
  covered: '已安排代課',
  swapped: '當天換人',
  uncovered: '請假・待安排代課',
  unassigned: '未指派老師',
};

// 網址參數
export const qs = (k) => new URLSearchParams(location.search).get(k);
