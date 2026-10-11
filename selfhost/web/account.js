(() => {
  'use strict';
  const content = document.querySelector('#content'), title = document.querySelector('#panel-title'), status = document.querySelector('#status');
  let state, busy = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const field = (name, label, type = 'text', autocomplete = '') => `<label>${label}<input name="${name}" type="${type}" required ${autocomplete ? `autocomplete="${autocomplete}"` : ''} ${name.toLowerCase().includes('password') ? 'minlength="10" maxlength="128"' : name === 'username' ? 'minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._\\x2d]{2,31}" autocapitalize="none" spellcheck="false"' : 'maxlength="512"'}></label>`;
  function message(text, error = false) { status.textContent = text; status.className = error ? 'error' : ''; }
  async function api(path, method = 'GET', body) {
    const response = await fetch('/api/auth/' + path, {method, credentials: 'same-origin', headers: {'content-type': 'application/json'}, ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '操作失败，请重试。');
    return data;
  }
  function render(mode) {
    if (state.needsSetup) {
      title.textContent = '创建你的实验室';
      content.innerHTML = '<p class="hint">首次启动，请用初始化令牌创建管理员。此操作只能完成一次。</p><div class="setup-help">在服务器的项目目录读取令牌：<code>docker compose exec app node selfhost/auth-cli.mjs setup-token</code></div><form data-form="setup">' + field('setupToken', '初始化令牌', 'password', 'off') + field('username', '管理员用户名', 'text', 'username') + '<p class="hint">3–32 位英文字母、数字、点、下划线或短横线。</p>' + field('password', '密码 · 至少 10 个字符', 'password', 'new-password') + '<button class="primary">创建管理员</button></form>';
    } else if (!state.user) {
      title.textContent = mode === 'register' ? '接受实验室邀请' : '登录实验室';
      content.innerHTML = '<form data-form="' + (mode === 'register' ? 'register' : 'login') + '">' + (mode === 'register' ? field('inviteToken', '账号邀请码', 'text', 'off') : '') + field('username', '用户名', 'text', 'username') + field('password', '密码', 'password', mode === 'register' ? 'new-password' : 'current-password') + '<button class="primary">' + (mode === 'register' ? '创建账号' : '登录') + '</button></form><p class="switch"><button class="link" data-action="' + (mode === 'register' ? 'login' : 'register') + '">' + (mode === 'register' ? '已有账号，去登录' : '有账号邀请码？创建账号') + '</button></p><p class="hint">需要管理员邀请才能注册。账号邀请码与游戏内的作品、房间邀请码分别使用。</p>';
    } else {
      title.textContent = '你好，' + state.user.username;
      content.innerHTML = `<p class="hint">${state.user.role === 'admin' ? '实验室管理员' : '实验室成员'} · 本站账号</p><p><a class="primary" id="return-game" href="/game/">进入工作台 →</a></p><details><summary>修改密码</summary><form data-form="password">${field('currentPassword', '当前密码', 'password', 'current-password')}${field('newPassword', '新密码', 'password', 'new-password')}<p class="hint">修改后，所有设备都需要重新登录。</p><button class="ghost">更新密码</button></form></details>${state.user.role === 'admin' ? '<hr><h3>邀请伙伴</h3><p class="hint">每个账号邀请码限用一次，有效期 24 小时。只发给你希望加入实验室的人。</p><button class="ghost" data-action="invite">生成账号邀请码</button><div id="invite-result"></div><details><summary>管理成员</summary><div id="users"></div><button class="link" data-action="users">刷新成员列表</button></details>' : ''}<hr><button class="link" data-action="logout">退出账号</button>`;
      const requested = new URLSearchParams(location.search).get('return_to');
      if (requested && !/[\u0000-\u0020\u007f\\]/.test(requested)) {
        try {
          const destination = new URL(requested, location.origin);
          if (destination.origin === location.origin && destination.pathname.startsWith('/game/')) document.querySelector('#return-game').href = destination.pathname + destination.search + destination.hash;
        } catch { /* Keep the known local game destination. */ }
      }
    }
  }
  async function refresh(note = '') { state = await api('status'); render(); message(note); }
  async function action(work) {
    if (busy) return;
    busy = true; content.querySelectorAll('button').forEach(b => b.disabled = true); message('正在处理…');
    try { await work(); } catch (error) { message(error.message || '网络连接失败，请重试。', true); }
    finally { busy = false; content.querySelectorAll('button').forEach(b => b.disabled = false); }
  }
  content.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form]'); if (!form) return; event.preventDefault();
    void action(async () => { const endpoint = form.dataset.form; await api(endpoint, 'POST', Object.fromEntries(new FormData(form))); form.reset(); await refresh(endpoint === 'password' ? '密码已更新，请重新登录。' : endpoint === 'setup' ? '管理员已创建。可以进入工作台，也可以先邀请伙伴。' : '登录成功。可以继续你的设计了。'); });
  });
  content.addEventListener('click', event => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const name = button.dataset.action;
    if (name === 'login' || name === 'register') { if (!busy) { render(name); message(''); } return; }
    void action(async () => {
      if (name === 'logout') { await api('logout', 'POST', {}); await refresh('已退出账号。'); }
      if (name === 'invite') { const data = await api('invites', 'POST', {expiresHours: 24}); document.querySelector('#invite-result').innerHTML = '<label>邀请码 · 点击后可全选复制<textarea readonly aria-label="账号邀请码">' + esc(data.inviteToken) + '</textarea></label><p>请让伙伴打开本站的登录页面，选择“有账号邀请码？创建账号”。</p>'; message('邀请码已生成，请妥善交给伙伴。'); }
      if (name === 'users' || name === 'disable') {
        if (name === 'disable') await api('users/' + encodeURIComponent(button.dataset.id), 'PATCH', {disabled: button.dataset.disabled === 'true'});
        const data = await api('users'); document.querySelector('#users').innerHTML = data.users.map(user => `<div class="user-row"><span>${esc(user.username)}<small>${user.role === 'admin' ? '管理员' : '成员'} · ${user.disabled ? '已停用' : '正常'}</small></span>${user.id !== state.user.id ? `<button class="ghost" data-action="disable" data-id="${esc(user.id)}" data-disabled="${!user.disabled}">${user.disabled ? '启用' : '停用'}</button>` : '<small>当前账号</small>'}</div>`).join(''); message('成员列表已更新。');
      }
    });
  });
  content.addEventListener('click', event => { if (event.target.matches('#invite-result textarea')) event.target.select(); });
  refresh().catch(error => { title.textContent = '暂时无法连接'; message(error.message, true); content.innerHTML = '<a class="secondary" href="/account">重新连接 →</a>'; });
})();
