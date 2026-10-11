(() => {
  if (location.protocol === 'file:') return;
  const link = document.createElement('a');
  link.href = '/account'; link.target = '_blank'; link.rel = 'noopener';
  link.className = 'quiet-btn'; link.dataset.selfhostAccount = ''; link.textContent = '账号';
  link.title = '在新页面管理账号，保留当前电路';
  document.querySelector('.top-actions')?.append(link);
  fetch('/api/auth/status', {credentials: 'same-origin'}).then(r => r.json()).then(data => { link.textContent = data.user ? '账号 · ' + data.user.username : data.needsSetup ? '初始化实验室' : '登录'; }).catch(() => {});
})();
