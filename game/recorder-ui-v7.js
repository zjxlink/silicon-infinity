(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  const api = () => root.LabAPI, core = () => root.RecorderV7;
  const copy = value => JSON.parse(JSON.stringify(value));
  const esc = value => api().escape(String(value ?? ''));
  const $ = selector => document.querySelector(selector);
  const KEY = 'silicon.recorder-progress.v7';
  let attached = false, active = null, saved = null, internal = false, epoch = 0, operation = 0;
  let mode = 'application', busy = null, last = null, stage = 'sample', edited = null, inputValue = '25', inputSequence = '', errorText = '';
  const hints = {
    sample: ['输入不会直接成为记录，程序必须读取设备并写入外部 RAM。', '先启动电路，再提交数值；记录条数是 RAM 中最后提交的结果。', '检查 CPU、地址译码、输入设备与 RAM 的请求和应答线路。'],
    sequence: ['数值相同而序号不同，是两个样本；序号相同不应重复计数。', '尝试提交相同序号两次，再改一个序号。', '比较程序读到的序号与 lastSequence，只有新序号才写入记录。'],
    control: ['暂停记录与暂停仿真不同：暂停记录时程序仍可以运行。', '暂停期间改变样本，恢复后只接收最新样本。', '清空通过控制输入中的新令牌请求；UI 不直接修改 RAM。'],
    capacity: ['容量是实际的八条记录，不是界面只显示八行。', '填满后再提交新样本，查看条数和满状态。', '满后停止写入；清空并重新开始，才能接受下一轮记录。']
  };
  const hintLevels = {};
  function local() { if (root.OnlineLab?.room) throw Error('请先离开共享房间，再操作本地记录器。查看、隔离验证和导出仍可使用。'); }
  function idle() { if (busy) throw Error('请先取消或等待当前操作完成。'); }
  function progress() { try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch { return {}; } }
  function identity(p) { return root.LabTestbench.hash(p); }
  function sameTicket(ticket) { return ticket === epoch && !!active; }
  function remember(id, result, captured) {
    if (!result.ok) return;
    const demo = active?.startMode === 'reference' && identity(captured.project) === active.initialHash;
    const data = progress();
    data[id] = { hash: identity(captured.project), demo, startMode: active?.startMode, at: new Date().toISOString() };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { api().notify('验证已完成，但进度未能写入本机存储。请导出作品保存。', true); }
  }
  function ensure() {
    if ($('#recorder-v7')) return;
    const main = $('.bench-layout'); if (!main) return;
    const panel = document.createElement('section'); panel.id = 'recorder-v7'; panel.hidden = true;
    panel.setAttribute('aria-label', '数据记录器工作流'); main.before(panel);
  }
  function statusHTML() {
    const s = api().state, candidate = identity(s.project).slice(-8), applied = s.applied ? identity(s.applied).slice(-8) : '尚未应用';
    return `<div class="rec-version"><span>候选设计 <code>${esc(candidate)}</code></span><span>运行版本 <code>${esc(applied)}</code></span><strong class="${s.dirty ? 'pending' : ''}">${s.dirty ? '有未应用修改 · 应用视角仍显示旧版本' : '当前设计已应用'}</strong></div>`;
  }
  function render() {
    ensure(); const panel = $('#recorder-v7'); if (!panel) return;
    const oldContent = panel.querySelector('.rec-content'), scroll = oldContent?.dataset.mode === mode ? oldContent.scrollTop : 0;
    panel.hidden = !active; document.body.classList.toggle('recorder-v7-active', !!active);
    document.body.dataset.recorderView = active ? mode : '';
    if (!active) return;
    const ro = root.OnlineLab?.room ? 'disabled' : '', disabled = busy ? 'disabled' : '';
    panel.innerHTML = `<div class="rec-dock"><div><small>从输入到真正保存的数据</small><h2>我的本地数据记录器</h2></div><div class="rec-tabs" role="tablist" aria-label="记录器视角">${[['application', '应用'], ['build', '制作'], ['verify', '验证']].map(([id, name]) => `<button role="tab" aria-selected="${mode === id}" data-rec-view="${id}">${name}</button>`).join('')}</div><div class="rec-dock-actions"><button data-rec="starts" ${disabled}>选择起点</button><button data-rec="restore" ${!saved || busy ? 'disabled' : ''} ${ro}>返回原作品</button></div></div>${statusHTML()}<p class="rec-error" id="recorder-error" role="alert">${esc(errorText)}</p><div class="rec-content">${mode === 'application' ? applicationHTML(ro, disabled) : mode === 'verify' ? verificationHTML(ro, disabled) : buildHTML(ro, disabled)}</div>`;
    const content = panel.querySelector('.rec-content'); if (content) content.dataset.mode = mode;
    updateLive(); if (content) content.scrollTop = scroll;
  }
  function applicationHTML(ro, disabled) {
    return `<div class="rec-application"><section class="rec-device"><div class="rec-device-head"><span>LOCAL RECORDER / 8 RECORDS</span><span id="recorder-time">0 μs</span></div><div id="recorder-live" aria-live="polite"></div><div class="rec-inputs"><label>样本数值 0—255<input id="recorder-value" type="number" min="0" max="255" value="${esc(inputValue)}" ${disabled} ${ro}></label><label>指定序号（留空自动递增）<input id="recorder-sequence" type="number" min="0" max="255" value="${esc(inputSequence)}" placeholder="自动" ${disabled} ${ro}></label><button class="rec-primary" data-rec="submit" ${disabled} ${ro}>提交并推进 400 μs</button></div><div class="rec-actions"><button data-rec="advance" ${disabled} ${ro}>启动 / 推进 400 μs</button><button data-rec="record" ${disabled} ${ro}>开始记录</button><button data-rec="pause-record" ${disabled} ${ro}>暂停记录</button><button data-rec="clear" ${disabled} ${ro}>清空记录</button><button data-rec="cancel" ${busy ? '' : 'disabled'}>取消操作</button></div><p class="rec-note">操作向真实输入排队，再推进电路。开始、暂停记录和清空各推进 400 μs；清空后处于暂停记录状态。此版本是本地 RAM 记录器，不把它表示成串口或 I²C 终端。</p></section><aside class="rec-guide"><h3>先观察，再自己造</h3><ol><li>运行程序，把样本提交到输入设备。</li><li>CPU 通过实际总线写入外部 RAM。</li><li>这里显示已提交记录，数值不会直接从输入框复制。</li></ol><button data-rec-view="build">打开电路与程序 →</button><button data-rec-view="verify">检查任务目标 →</button><p>${active.startMode === 'reference' ? '你打开了完整参考。原样验证标为示范通过；修改后可以保存自己的方案。' : active.startMode === 'skeleton' ? '骨架已经接线并初始化，需要补上实际采集程序。先验证，观察缺少的行为。' : active.startMode === 'existing' ? '正在观察当前作品，没有替换电路；运行与验证仍使用它的真实设计。' : '你从公开接口开始。可以使用不同内部结构，只要满足记录合同。'}</p></aside></div>`;
  }
  function buildHTML(ro, disabled) {
    return `<div class="rec-build-tools"><p>在下方制作当前候选设计。修改电路或程序后，先应用，再到“应用”视角观察；验证直接读取候选副本。</p><button data-rec="program" ${ro}>编辑记录程序</button><button data-rec="apply" ${disabled} ${ro}>应用并重新启动</button><button data-rec-view="verify">验证候选设计</button><button data-rec="contract">查看公开接口与记录格式</button></div>`;
  }
  function verificationHTML(ro, disabled) {
    const data = progress(), selected = core().stages.find(s => s.id === stage) || core().stages[0], level = hintLevels[stage] || 0;
    return `<div class="rec-verification"><section><div class="rec-stage-list">${core().stages.map(s => `<button data-rec-stage="${s.id}" class="${stage === s.id ? 'active' : ''}"><strong>${esc(s.title)}</strong><span>${esc(s.description)}</span><small>${data[s.id] ? data[s.id].demo ? '参考示范曾通过' : '曾通过 · 当前设计需重新验证' : '尚无通过记录'}</small></button>`).join('')}</div><div class="rec-goal"><h3>${esc(selected.title)}</h3><p>${esc(selected.description)}</p><div class="rec-actions"><button class="rec-primary" data-rec="verify" ${disabled}>验证此阶段</button><button data-rec="verify-all" ${disabled}>验证全部目标</button><button data-rec="cancel" ${busy ? '' : 'disabled'}>取消</button><button data-rec="hint">提示 ${level} / 3</button></div>${(hints[stage] || []).slice(0, level).map((h, i) => `<p class="rec-hint">${i + 1}. ${esc(h)}</p>`).join('')}<p id="recorder-progress" role="status">${busy?.kind === 'verify' ? '正在验证独立副本…' : ''}</p><div id="recorder-result">${resultHTML()}</div></div></section><aside class="rec-guide"><h3>把你的方案继续做好</h3><p>验证不会应用草稿，也不会推进当前电路。先功能正确，再比较同一目标下的成本与结果。</p><button data-rec="timeline" ${disabled} ${ro}>编辑本阶段测试时间线</button><button data-rec="verify-edited" ${!edited || busy ? 'disabled' : ''}>运行我的检查</button><p class="rec-note">自定义检查不替代任务标准，也不会记为任务完成。</p><button data-rec="compare" ${disabled}>保存 / 比较个人方案</button><button data-rec="export" ${disabled}>导出此阶段挑战</button><button data-rec="contract">查看公开接口与记录格式</button></aside></div>`;
  }
  function resultHTML() {
    if (!last) return '<p class="rec-note">先运行检查，结果会列出实际差异。</p>';
    const r = last.result, current = last.hash === identity(api().state.project);
    const label = r.cancelled ? '已取消，未完成验证' : r.ok ? last.experimental ? '自定义检查通过' : last.demo ? '参考示范通过' : '行为目标通过' : '还有目标未完成';
    return `<div class="rec-result ${r.ok && current ? 'pass' : ''}"><strong>${label}</strong>${current ? '' : '<span>此前设计的结果，当前修改需重新验证</span>'}<p>${esc(r.firstFailure?.detail || r.error?.message || '')}</p><ul>${(r.checks || []).slice(0, 16).map(c => `<li>${c.ok ? '✓' : '○'} ${esc(c.label || c.id)}${c.detail ? '：' + esc(c.detail) : ''}</li>`).join('')}</ul>${r.checks?.length > 16 ? `<p>共检查 ${r.checks.length} 项；此处显示前 16 项。</p>` : ''}${r.firstFailure ? '<button data-rec="locate-failure">定位首个差异的观察端</button><p class="rec-note">定位的是失败的观察位置，不把它当成已确定的故障原因。</p>' : ''}</div>`;
  }
  function updateLive() {
    if (!active || !api()?.getRuntime()) return;
    const target = $('#recorder-live'); if (!target) return;
    try {
      const s = core().inspect(api().getRuntime());
      const time = $('#recorder-time'); if (time) time.textContent = s.time + ' μs';
      if (!s.available) { target.innerHTML = '<div class="rec-empty"><strong>等待记录电路</strong><p>当前生效版本还没有可观察的记录存储器。到“制作”连接电路，应用后再运行。</p></div>'; return; }
      const status = !s.initialized ? '程序尚未初始化记录区' : ({ 1: '正在记录', 2: '记录已暂停', 3: '容量已满，停止写入' }[s.status] || '等待程序状态');
      const records = s.records || [], points = records.map((r, i) => `${35 + i * 70},${125 - Number(r.value) * 100 / 255}`).join(' ');
      target.innerHTML = `<div class="rec-readout"><strong>${esc(s.count ?? 0)}<small> / ${esc(s.capacity ?? 8)} 条</small></strong><span>${esc(status)}</span></div>${s.faults?.length ? `<div class="rec-fault">${s.faults.map(f => `${esc(f.path)}：${esc(f.code)}`).join('<br>')}</div>` : ''}<svg class="rec-chart" viewBox="0 0 570 150" role="img" aria-label="已提交记录数值曲线"><path d="M25 20V130H555" class="rec-axis"/><text x="0" y="25">255</text><text x="9" y="132">0</text>${records.length ? `<polyline points="${points}"/>${records.map((r, i) => `<circle cx="${35 + i * 70}" cy="${125 - Number(r.value) * 100 / 255}" r="4"><title>序号 ${esc(r.sequence)}：${esc(r.value)}</title></circle>`).join('')}` : '<text x="130" y="80">尚无已提交记录</text>'}</svg><div class="rec-table"><table><thead><tr><th>记录</th><th>输入序号</th><th>数值</th><th>实际字</th></tr></thead><tbody>${records.map(r => `<tr data-rec-record="${esc(r.index)}"><td>${esc(r.index + 1)}</td><td>${esc(r.sequence)}</td><td>${esc(r.value)}</td><td><code>${esc('0x' + Number(r.raw).toString(16).padStart(4, '0'))}</code></td></tr>`).join('') || '<tr><td colspan="4">提交样本后，由程序写入。</td></tr>'}</tbody></table></div><p class="rec-note">以上来自当前已应用电路的实际 RAM。清空确认令牌 ${esc(s.clearToken ?? '—')} · 最近序号 ${esc(s.lastSequence ?? '—')}。</p>`;
    } catch (e) { target.innerHTML = `<p class="rec-error">无法读取此电路：${esc(e.message)}</p>`; }
  }
  function open() {
    if (!active) {
      const p = api().state.project;
      if (p.circuit.instances.some(n => n.id === 'ram') && [['sample', 16], ['control', 16], ['reset', 1]].every(([id, width]) => p.circuit.inputs.some(n => n.id === id && n.width === width))) {
        active = { startMode: 'existing', program: 'custom', initialHash: null }; mode = 'application'; last = null; edited = null;
      }
    }
    if (active) { render(); $('#recorder-v7')?.scrollIntoView({ block: 'start' }); } else starts();
  }
  function starts() {
    idle(); api().modal('数据记录器 · 选择你的起点', `<div class="rec-starts"><p>从一个输入到八条真实记录。选择起点会保留当前完整工作现场，可随时返回。所有目标和工具始终开放。</p><div class="rec-start-grid">${core().startModes.map(m => `<article><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><button data-rec-load="${m.id}" ${root.OnlineLab?.room ? 'disabled' : ''}>从这里开始</button></article>`).join('')}</div><label>参考程序<select id="recorder-program">${core().programs.map(p => `<option value="${esc(p.id)}">${esc(p.name || p.title || p.id)}</option>`).join('')}</select></label><p class="rec-note">完整参考原样通过只显示“示范通过”。不同程序可以满足同一外部合同。</p></div>`);
  }
  async function load(startMode = 'reference', program = 'polling') {
    local(); idle(); const token = ++operation, ticket = epoch;
    busy = { kind: 'load', token }; errorText = '';
    try {
      const built = await core().build(startMode, { program });
      local(); if (ticket !== epoch || token !== operation) throw Error('作品已切换，未载入迟到的参考设计。');
      const previous = saved || copy(api().captureSession());
      internal = true; try { await api().loadWorkspace(built); } finally { internal = false; }
      if (identity(api().state.project) !== identity(built.project)) throw Error('工作台已切换，参考设计未成为当前作品。');
      saved = previous; active = { startMode, program, initialHash: identity(built.project) }; mode = 'application'; stage = 'sample'; edited = null; last = null;
      api().closeModal(); return built;
    } finally { if (busy?.token === token) busy = null; render(); }
  }
  function view(next) { if (!['application', 'build', 'verify'].includes(next)) throw Error('未知视角'); if (!active) return starts(); mode = next; errorText = ''; render(); }
  async function restore() {
    local(); idle(); if (!saved) return;
    const token = ++operation, original = copy(saved); busy = { kind: 'restore', token }; internal = true;
    try { await api().restoreSession(original); saved = null; active = null; last = null; edited = null; }
    finally { internal = false; if (busy?.token === token) busy = null; render(); }
  }
  async function advanceAction(fn) {
    local(); idle(); if (!active) throw Error('请先打开记录器。'); if (api().state.dirty) throw Error('请先应用候选设计，再操作当前记录电路。');
    const token = ++operation, ticket = epoch, initialTime = api().getRuntime().time; busy = { kind: 'advance', token }; errorText = ''; api().stop(); render();
    try {
      if (fn && !core().inspect(api().getRuntime()).initialized) {
        const initialization = await api().advanceResponsive(400n, { force: true });
        local(); if (!sameTicket(ticket) || operation !== token) return;
        if (initialization?.stopped) { api().updateSignals(); return; }
        if (!core().inspect(api().getRuntime()).initialized) throw Error('记录区尚未初始化。请检查程序与总线，未提交新输入。');
      }
      if (fn) { local(); if (!sameTicket(ticket)) return; api().runtimeControl(() => fn(api().getRuntime())); }
      await api().advanceResponsive(400n, { force: true });
      if (sameTicket(ticket)) { api().updateSignals(); api().notify('当前电路已推进 ' + String(api().getRuntime().time - initialTime) + ' μs，记录结果已刷新。'); }
    } finally { if (busy?.token === token) busy = null; render(); }
  }
  async function submit(value, sequence) {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw Error('样本需要 0—255 的整数。');
    if (sequence !== undefined && (!Number.isInteger(sequence) || sequence < 0 || sequence > 255)) throw Error('序号需要 0—255 的整数。');
    return advanceAction(rt => core().submit(rt, value, sequence === undefined ? {} : { sequence }));
  }
  async function verify(stageId = stage, experimental = false) {
    idle(); if (!active) throw Error('请先打开记录器。');
    const ticket = epoch, token = ++operation, captured = copy(api().getWorkspace()), selected = experimental ? copy(edited) : null;
    if (experimental && !selected) throw Error('尚无自定义检查。');
    const controller = new AbortController(); busy = { kind: 'verify', token, controller }; mode = 'verify'; errorText = ''; render();
    try {
      const options = { stageId, signal: controller.signal, onProgress: p => { if (sameTicket(ticket) && busy?.token === token) { const el = $('#recorder-progress'); if (el) el.textContent = `已推进 ${p.time ?? '—'} μs；已检查 ${p.checks ?? '—'} 项`; } } };
      const result = experimental ? await root.LabTestbench.run(captured, selected, options) : await core().verify(captured, options);
      if (sameTicket(ticket) && busy?.token === token) {
        const demo = !experimental && active.startMode === 'reference' && identity(captured.project) === active.initialHash;
        last = { result, stageId, experimental, hash: identity(captured.project), demo };
        if (!experimental) remember(stageId, result, captured);
      }
      return result;
    } finally { if (busy?.token === token) busy = null; render(); }
  }
  function cancel() { if (busy?.kind === 'verify') busy.controller.abort(); else if (busy?.kind === 'advance') { ++operation; api().stop(); } }
  function timeline() {
    local(); idle(); const ticket = epoch; if (!root.TimelineUIV7) throw Error('时间线编辑器尚未加载。');
    root.TimelineUIV7.open({ title: '记录器 · 我的实验检查', testbench: edited || core().contract(stage), onChange: spec => {
      local(); if (!sameTicket(ticket)) throw Error('工作台已切换，请重新打开时间线。'); edited = root.LabTestbench.validate(spec); render();
    } });
  }
  function compare() {
    idle(); if (!root.MilestonesUIV7) throw Error('方案比较尚未加载。');
    return root.MilestonesUIV7.openComparison({ session: copy(api().captureSession()), contract: core().contract('all'), report: last?.result || null });
  }
  function locateFailure() {
    const failure = last?.result?.firstFailure; if (!failure) throw Error('尚无失败记录。');
    const target = failure.target || (core().contract(last.stageId || stage).checks || []).find(c => c.id === failure.id)?.target || 'ram';
    const node = target.startsWith('$.') ? 'boundary:' + target.slice(2) : target.split('.')[0];
    mode = 'build'; render();
    if (root.EngineeringUIV6) root.EngineeringUIV6.locate(node);
    else { api().selectItems([{ type: 'node', id: node }]); api().renderInspector(); api().fit(); }
    api().notify('已定位失败的观察位置。请结合输入与程序检查上游原因。');
  }
  function contract() {
    api().modal('记录器的公开合同', '<div class="rec-contract"><p>输入通过 sample 与 control 进入真实电路。样本字高 8 位为序号、低 8 位为数值；序号变化才表示新样本。</p><p>容量 8 条，满后停止。暂停期间不补录所有中间输入，恢复只考虑最新样本。清空请求通过新的令牌确认，不直接修改内存。</p><p>公开 RAM 记录区：0=标识0x5243，1=已提交条数，2=状态，3=清空确认令牌，4=最近序号，5=容量，16—23=样本字。先写记录，再提交条数。冷启动与暖复位均由固件开启空会话；快照恢复保留现场。</p><p>验证从冷启动副本开始，内部程序可以改变，外部目标保持一致。此版本没有隐藏的传感器或串口传输。</p></div>');
  }
  function fail(e) { errorText = e.message || String(e); const box = $('#recorder-error'); if (box && active) box.textContent = errorText; else api()?.notify(errorText, true); }
  async function action(name) {
    if (name === 'open') return open(); if (name === 'starts') return starts(); if (name === 'restore') return restore();
    if (name === 'submit') { if (!inputValue.trim()) throw Error('请先填写样本数值。'); return submit(Number(inputValue), inputSequence === '' ? undefined : Number(inputSequence)); }
    if (name === 'advance') return advanceAction();
    if (name === 'record') return advanceAction(rt => core().setRunning(rt, true));
    if (name === 'pause-record') return advanceAction(rt => core().setRunning(rt, false));
    if (name === 'clear') return advanceAction(rt => core().clear(rt));
    if (name === 'cancel') return cancel(); if (name === 'verify') return verify(); if (name === 'verify-all') return verify('all');
    if (name === 'verify-edited') return verify(stage, true); if (name === 'timeline') return timeline(); if (name === 'compare') return compare();
    if (name === 'locate-failure') return locateFailure(); if (name === 'contract') return contract();
    if (name === 'hint') { hintLevels[stage] = Math.min(3, (hintLevels[stage] || 0) + 1); return render(); }
    if (name === 'program') { local(); if (!api().state.project.circuit.instances.some(n => n.id === 'cpu')) throw Error('先在公开接口内加入 CPU，再编辑程序。'); return root.ArchitectureUIV5.openEditor('cpu'); }
    if (name === 'apply') { local(); idle(); return api().applyProject(); }
    if (name === 'export') {
      const ticket = epoch, id = stage, captured = copy(api().getWorkspace());
      const pkg = await root.LabTestbench.createPackage({ title: '本地数据记录器 · ' + id, description: core().stages.find(s => s.id === id).description, hints: hints[id], workspace: captured, testbench: core().contract(id) });
      if (!sameTicket(ticket)) throw Error('作品已切换，未导出迟到的挑战。'); api().download(pkg.title + '.challenge.json', pkg);
    }
  }
  function attach() {
    if (attached || !api()?.state.project || !core()) return; attached = true; ensure();
    const button = document.createElement('button'); button.dataset.rec = 'open'; button.className = 'outline-btn'; button.textContent = '数据记录器'; $('.project-actions')?.appendChild(button);
    document.addEventListener('input', e => { if (e.target.id === 'recorder-value') inputValue = e.target.value; if (e.target.id === 'recorder-sequence') inputSequence = e.target.value; });
    document.addEventListener('click', async e => {
      const el = e.target.closest('[data-rec],[data-rec-view],[data-rec-load],[data-rec-stage]'); if (!el) return;
      try {
        if (el.hasAttribute('data-rec-load')) return await load(el.dataset.recLoad, $('#recorder-program')?.value || 'polling');
        if (el.dataset.recView) return view(el.dataset.recView);
        if (el.dataset.recStage) { stage = el.dataset.recStage; edited = null; mode = 'verify'; return render(); }
        await action(el.dataset.rec);
      } catch (error) { fail(error); }
    });
    document.addEventListener('lab:workspace', e => {
      ++epoch; busy?.controller?.abort();
      if (!internal && e.detail?.reason === 'load') { ++operation; saved = null; active = null; edited = null; last = null; }
      render();
    });
    document.addEventListener('lab:render', e => { if (active && e.detail?.part === 'all') render(); });
    document.addEventListener('lab:tick', updateLive);
  }
  root.RecorderUIV7 = { open, load, view, submit, verify, cancel, restore, locateFailure, compare, timeline, attach, get active() { return active && copy(active); }, get busy() { return !!busy; }, get lastResult() { return last && copy(last); }, get progress() { return copy(progress()); } };
  document.addEventListener('lab:ready', attach); attach();
})(typeof globalThis === 'undefined' ? window : globalThis);
