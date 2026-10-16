// 登入閘門：沒登入就顯示登入表單；登入了但不在 staff 白名單就顯示沒有權限
import { sb } from './api.js';
import { esc, header, toast } from './ui.js';
import { initTour } from './tour.js';

// opts.public：沒登入也可以看（唯讀），回傳 null；按「管理員登入」才顯示登入表單
export async function boot(activePage, opts = {}) {
  const app = document.getElementById('app');
  let { data: { session } } = await sb.auth.getSession();
  const wantLogin = new URLSearchParams(location.search).has('login');
  if (!session && opts.public && !wantLogin) {
    publicHeader();
    return null;
  }
  if (!session) {
    session = await loginForm(app);
    if (wantLogin) history.replaceState(null, '', location.pathname);
  }

  const { data: me } = await sb.from('staff').select('email').maybeSingle();
  if (!me) {
    app.innerHTML = `<div class="login-wrap"><div class="card login">
      <h2>沒有使用權限</h2>
      <p class="sub">${esc(session.user.email)} 不在管理員名單內，請管理員把這個 email 加進 staff 資料表。</p>
      <button class="btn" id="out">換個帳號登入</button></div></div>`;
    document.getElementById('out').onclick = async () => { await sb.auth.signOut(); location.reload(); };
    throw new Error('not staff');
  }

  header(activePage, session.user.email);
  document.getElementById('signout').onclick = async () => { await sb.auth.signOut(); location.href = 'index.html'; };
  initTour(activePage, session.user.email);
  return session;
}

function publicHeader() {
  const el = header('index.html', null, { publicView: true });
  el.querySelector('#signin').onclick = () => { location.href = 'index.html?login'; };
}

function loginForm(app) {
  return new Promise((resolve) => {
    app.innerHTML = `
      <div class="login-wrap">
        <form class="card login" id="login" style="display:flex;flex-direction:column;gap:14px">
          <div><h2 style="font-size:20px;margin-bottom:4px">課務排程</h2><div class="sub">請用管理員帳號登入</div></div>
          <label class="field">Email<input name="email" type="email" autocomplete="username" required></label>
          <label class="field">密碼<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn primary" type="submit">登入</button>
        </form>
      </div>`;
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email: fd.get('email'), password: fd.get('password') });
      btn.disabled = false;
      if (error) { toast('登入失敗：帳號或密碼錯誤', true); return; }
      app.innerHTML = '<div class="loading">載入中…</div>';
      resolve(data.session);
    });
  });
}
