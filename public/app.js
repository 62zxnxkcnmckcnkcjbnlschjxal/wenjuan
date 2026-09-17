/* ============================================================
   问卷工作台 · 管理端主逻辑
   视图：仪表盘 / AI 生成 / 编辑器（含实时预览）/ 结果统计与 AI 分析
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const Q_TYPES = ['radio', 'checkbox', 'text', 'rating', 'dropdown', 'date'];
  const TYPE_LABEL = {
    radio: '单选', checkbox: '多选', text: '填空',
    rating: '评分', dropdown: '下拉', date: '日期'
  };
  const STATUS_LABEL = { draft: '草稿', published: '发布中', closed: '已结束' };

  let state = {
    surveys: [],
    editing: null,        // 当前编辑的问卷对象
    saveTimer: null,
    dirty: false,
    results: null,        // 结果页数据
    analysis: null
  };

  /* ---------------- 基础工具 ---------------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function fmtTime(ms) {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* 非 JSON */ }
    if (!res.ok) {
      const msg = (data && data.error) || ('请求失败（HTTP ' + res.status + '）');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(msg, type) {
    const wrap = $('#toast-wrap');
    const t = document.createElement('div');
    t.className = 'toast ' + (type || '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  function confirmModal(title, sub, okText, danger) {
    return new Promise((resolve) => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="modal"><h3>' + esc(title) + '</h3>' +
        '<div class="m-sub">' + esc(sub) + '</div>' +
        '<div class="m-actions">' +
        '<button class="btn btn-ghost" data-act="no">取消</button>' +
        '<button class="btn ' + (danger ? 'btn-danger-soft' : 'btn-primary') + '" data-act="yes">' + esc(okText || '确定') + '</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.closest('[data-act="no"]')) { mask.remove(); resolve(false); }
        else if (e.target.closest('[data-act="yes"]')) { mask.remove(); resolve(true); }
      });
    });
  }

  /* ---------------- 主题 ---------------- */
  function initTheme() {
    $('#themeToggle').addEventListener('click', () => {
      const dark = document.documentElement.classList.toggle('dark');
      try {
        localStorage.setItem('qwDark', dark ? '1' : '0');
        $('#metaTheme').setAttribute('content', dark ? '#0d1412' : '#f1f7f5');
      } catch (e) {}
    });
  }

  /* ---------------- 启动与鉴权 ---------------- */
  async function boot() {
    // 全局错误提示（便于定位问题，生产环境同样有益）
    window.addEventListener('error', (e) => {
      try { toast('页面脚本错误：' + (e.message || '未知'), 'err'); } catch (err) {}
    });
    initTheme();
    window.addEventListener('hashchange', route);
    try {
      const st = await api('/api/auth/status');
      if (st.passwordSet && !st.authed) {
        showLock();
        return;
      }
      if (!st.deepseekConfigured) {
        // 开发/未配置密钥时给出提示条（不阻塞使用）
        setTimeout(() => toast('提示：未配置 DeepSeek 密钥，AI 生成/分析不可用（详见 README）', ''), 600);
      }
      enterApp(st);
    } catch (e) {
      toast('无法连接服务器：' + e.message, 'err');
    }
  }

  function showLock() {
    $('#lockScreen').style.display = 'flex';
    const btn = $('#lockBtn'), pwd = $('#lockPwd'), err = $('#lockErr');
    const submit = async () => {
      const v = pwd.value.trim();
      if (!v) { err.style.display = 'block'; err.textContent = '请输入管理密码'; return; }
      btn.disabled = true; btn.textContent = '验证中…'; err.style.display = 'none';
      try {
        await api('/api/auth/login', { method: 'POST', body: { password: v } });
        btn.disabled = false; btn.textContent = '进入工作台';
        enterApp(null);
      } catch (e) {
        btn.disabled = false; btn.textContent = '进入工作台';
        err.style.display = 'block'; err.textContent = e.message;
        pwd.value = ''; pwd.focus();
      }
    };
    btn.onclick = submit;
    pwd.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => pwd.focus(), 100);
  }

  async function enterApp() {
    $('#lockScreen').style.display = 'none';
    route();
  }

  /* ---------------- 路由 ---------------- */
  function route() {
    const hash = location.hash || '#/';
    const m = hash.match(/^#\/(edit|results)\/([\w-]+)$/);
    hideAll();
    if (m) {
      if (m[1] === 'edit') {
        $('#view-editor').style.display = 'block';
        openEditor(m[2]);
      } else {
        $('#view-results').style.display = 'block';
        openResults(m[2]);
      }
    } else if (hash.startsWith('#/ai')) {
      $('#view-ai').style.display = 'block';
      refreshAiStatus();
    } else if (hash.startsWith('#/links')) {
      $('#view-links').style.display = 'block';
      if (window.__loadLinks) { try { window.__loadLinks(); } catch (e) {} }
    } else {
      $('#view-dashboard').style.display = 'block';
      loadDashboard();
    }
  }

  function hideAll() {
    ['view-dashboard', 'view-ai', 'view-editor', 'view-results', 'view-links'].forEach(id => {
      $('#' + id).style.display = 'none';
    });
  }

  /* ---------------- 仪表盘 ---------------- */
  async function loadDashboard() {
    try {
      const data = await api('/api/surveys');
      state.surveys = data.surveys || [];
      renderDashboard();
    } catch (e) {
      $('#surveyList').innerHTML = '<div class="empty"><div class="e-ico">⚠️</div><h3>加载失败</h3><p>' + esc(e.message) + '</p></div>';
    }
  }

  function renderDashboard() {
    const list = state.surveys;
    const published = list.filter(s => s.status === 'published');
    const totalResponses = list.reduce((a, s) => a + (s.responseCount || 0), 0);
    $('#statGrid').innerHTML =
      statCard('teal', '📋', list.length, '问卷总数') +
      statCard('green', '🚀', published.length, '发布中') +
      statCard('warn', '📥', totalResponses, '已回收答卷') +
      statCard('soft', '✏️', list.filter(s => s.status === 'draft').length, '草稿');

    const box = $('#surveyList');
    if (!list.length) {
      box.innerHTML =
        '<div class="empty"><div class="e-ico">🗒️</div><h3>还没有问卷</h3>' +
        '<p>点右上角「新建问卷」从零开始，或用「AI 一键生成」快速创建</p></div>';
      return;
    }
    box.innerHTML = list.map(s => renderSurveyRow(s)).join('');
    $$('.survey-row', box).forEach(row => {
      const s = list.find(x => x.id === row.dataset.id);
      if (!s) return;
      row.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (act) {
          e.stopPropagation();
          handleRowAction(s, act.dataset.act);
        } else {
          location.hash = '#/edit/' + s.id;
        }
      });
    });
  }

  function statCard(cls, ico, num, label) {
    return '<div class="stat-card"><div class="ico ico-' + cls + '">' + ico + '</div>' +
      '<div class="num">' + num + '</div><div class="label">' + label + '</div></div>';
  }

  function renderSurveyRow(s) {
    const count = s.responseCount || 0;
    const chipCls = { draft: 'chip-draft', published: 'chip-published', closed: 'chip-closed' }[s.status];
    return '<div class="survey-row" data-id="' + esc(s.id) + '">' +
      '<div class="s-body">' +
      '<div class="s-title">' + esc(s.title) + '</div>' +
      '<div class="s-meta"><span class="chip ' + chipCls + '">' + STATUS_LABEL[s.status] + '</span>' +
      '<span>创建于 ' + fmtTime(s.createdAt).slice(0, 10) + '</span>' +
      '<span>' + (s.structure ? s.structure.length : 0) + ' 道题</span></div>' +
      '</div>' +
      '<div class="answer-progress" title="回收进度"><i style="width:' + Math.min(count * 4, 100) + '%"></i></div>' +
      '<div class="s-count"><b>' + count + '</b><span>答卷</span></div>' +
      '<div class="s-actions">' +
      '<button class="btn btn-soft btn-sm" data-act="edit">编辑</button>' +
      '<button class="btn btn-ghost btn-sm" data-act="results">结果</button>' +
      (s.status === 'published'
        ? '<button class="btn btn-ghost btn-sm" data-act="close">结束</button>'
        : '<button class="btn btn-primary btn-sm" data-act="publish">发布</button>') +
      '<button class="btn btn-ghost btn-sm" data-act="duplicate" title="复制为草稿">复制</button>' +
      '<button class="icon-btn danger" data-act="delete" title="删除">✕</button>' +
      '</div></div>';
  }

  async function handleRowAction(s, act) {
    if (act === 'edit') { location.hash = '#/edit/' + s.id; return; }
    if (act === 'results') { location.hash = '#/results/' + s.id; return; }
    try {
      if (act === 'publish') {
        if (!s.structure || !s.structure.length) {
          toast('请先在编辑器中添加题目再发布', 'err');
          location.hash = '#/edit/' + s.id;
          return;
        }
        await api('/api/surveys/' + s.id + '/actions', { method: 'POST', body: { action: 'publish' } });
        toast('问卷已发布，可分享填答链接');
        loadDashboard();
      } else if (act === 'close') {
        await api('/api/surveys/' + s.id + '/actions', { method: 'POST', body: { action: 'close' } });
        toast('问卷已结束');
        loadDashboard();
      } else if (act === 'duplicate') {
        await api('/api/surveys/' + s.id + '/actions', { method: 'POST', body: { action: 'duplicate' } });
        toast('已复制为草稿');
        loadDashboard();
      } else if (act === 'delete') {
        const ok = await confirmModal('删除问卷', '将同时删除「' + s.title + '」的全部 ' + (s.responseCount || 0) + ' 份答卷，且无法恢复。确定删除吗？', '删除', true);
        if (ok) {
          await api('/api/surveys/' + s.id, { method: 'DELETE' });
          toast('已删除', 'ok');
          loadDashboard();
        }
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  /* ---------------- 新建 / 编辑 ---------------- */
  async function createBlank() {
    try {
      const data = await api('/api/surveys', {
        method: 'POST',
        body: {
          title: '未命名问卷',
          description: '',
          structure: [],
          settings: { submitTip: '提交成功，感谢参与！' }
        }
      });
      location.hash = '#/edit/' + data.survey.id;
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function openEditor(id) {
    try {
      const data = await api('/api/surveys/' + id);
      state.editing = data.survey;
      renderEditor();
    } catch (e) {
      toast(e.message, 'err');
      location.hash = '#/';
    }
  }

  function renderEditor() {
    const s = state.editing;
    const statusChip = '<span class="chip ' + ({ draft: 'chip-draft', published: 'chip-published', closed: 'chip-closed' }[s.status]) + '">' + STATUS_LABEL[s.status] + '</span>';
    $('#editorHead').innerHTML =
      '<div><h1>编辑问卷</h1><div class="sub" id="editorStatus">' + statusChip +
      ' <span id="saveHint" style="color:var(--placeholder)">已保存</span></div></div>' +
      '<div class="right">' +
      '<button class="btn btn-ghost btn-sm" onclick="App.copyFillLink()">🔗 填答链接</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="App.openFillPage()">预览</button>' +
      '<button class="btn btn-soft btn-sm" onclick="App.saveEditor(true)">保存</button>' +
      (s.status === 'published'
        ? '<button class="btn btn-danger-soft btn-sm" onclick="App.closeSurvey()">结束问卷</button>'
        : '<button class="btn btn-primary btn-sm" onclick="App.publishSurvey()">发布</button>') +
      '</div>';

    const left = $('#editorLeft');
    left.innerHTML = '';
    (s.structure || []).forEach(q => left.appendChild(questionCard(q)));

    const addBar = document.createElement('div');
    addBar.className = 'add-bar';
    Q_TYPES.forEach(t => {
      const b = document.createElement('button');
      b.textContent = '＋ ' + TYPE_LABEL[t];
      b.dataset.add = t;
      b.addEventListener('click', () => addQuestion(t));
      addBar.appendChild(b);
    });
    left.appendChild(addBar);

    bindEditorEvents(left);
    renderPreview();
    state.dirty = false;
  }

  function questionCard(q) {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.dataset.qid = q.id;
    card.draggable = true;

    const head = document.createElement('div');
    head.className = 'q-head';
    head.innerHTML =
      '<span class="q-drag" title="拖动排序">⠿</span>' +
      '<span class="q-type-badge">' + TYPE_LABEL[q.type] + '</span>' +
      '<input class="q-title-input" value="' + esc(q.title || '') + '" placeholder="请输入题目">' +
      '<label class="q-req"><input type="checkbox" ' + (q.required ? 'checked' : '') + '> 必答</label>' +
      '<div class="q-tools">' +
      '<button class="icon-btn btn-sm" data-act="up" title="上移">↑</button>' +
      '<button class="icon-btn btn-sm" data-act="down" title="下移">↓</button>' +
      '<button class="icon-btn btn-sm danger" data-act="del" title="删除题目">✕</button>' +
      '</div>';
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'q-body';
    if (q.type === 'radio' || q.type === 'checkbox' || q.type === 'dropdown') {
      const list = document.createElement('div');
      list.className = 'q-opts';
      (q.options || ['']).forEach((opt, i) => list.appendChild(optRow(q.id, opt, i)));
      if (!q.options || !q.options.length) {
        // 空选项时补一行
        list.appendChild(optRow(q.id, '', 0));
      }
      body.appendChild(list);
      const other = document.createElement('label');
      other.className = 'q-other-line';
      other.innerHTML = '<input type="checkbox" ' + (q.allowOther ? 'checked' : '') + '> 允许填写“其他”选项';
      body.appendChild(other);
    } else if (q.type === 'text') {
      const wrap = document.createElement('div');
      wrap.className = 'q-opts';
      const row = document.createElement('div');
      row.className = 'q-opt';
      row.innerHTML = '<span class="marker"></span><input class="q-opt-input" data-field="placeholder" value="' + esc(q.placeholder || '') + '" placeholder="占位提示（可选）">';
      wrap.appendChild(row);
      body.appendChild(wrap);
    } else if (q.type === 'rating') {
      const wrap = document.createElement('div');
      wrap.className = 'q-opts';
      const row = document.createElement('div');
      row.className = 'q-opt';
      row.innerHTML = '<span class="marker">★</span><select class="q-opt-input" data-field="maxRating">' +
        [3, 4, 5, 6, 7, 8, 9, 10].map(n => '<option value="' + n + '" ' + ((q.maxRating || 5) === n ? 'selected' : '') + '>' + n + ' 分制</option>').join('') +
        '</select>';
      wrap.appendChild(row);
      body.appendChild(wrap);
    } else if (q.type === 'date') {
      const wrap = document.createElement('div');
      wrap.className = 'q-opts';
      const row = document.createElement('div');
      row.className = 'q-opt';
      row.innerHTML = '<span class="marker">📅</span><span style="font-size:13px;color:var(--muted)">日期选择题（填答者选择日期）</span>';
      wrap.appendChild(row);
      body.appendChild(wrap);
    }
    card.appendChild(body);
    return card;
  }

  function optRow(qid, value, idx) {
    const row = document.createElement('div');
    row.className = 'q-opt';
    row.innerHTML =
      '<span class="marker"></span>' +
      '<input class="q-opt-input" data-opt="' + idx + '" value="' + esc(value) + '" placeholder="选项 ' + (idx + 1) + '">' +
      '<button class="q-opt-del" data-opt-del="' + idx + '" title="删除选项">✕</button>';
    return row;
  }

  function bindEditorEvents(root) {
    // 标题 / 必答 / 选项 / 设置 变更 → 更新 state + 自动保存
    root.addEventListener('input', (e) => {
      const card = e.target.closest('.q-card');
      if (!card) return;
      const q = findQ(card.dataset.qid);
      if (!q) return;
      if (e.target.classList.contains('q-title-input')) {
        q.title = e.target.value;
      } else if (e.target.classList.contains('q-opt-input')) {
        const field = e.target.dataset.field;
        if (field) { q[field] = e.target.value; }
        else {
          const idx = Number(e.target.dataset.opt);
          if (!q.options) q.options = [];
          q.options[idx] = e.target.value;
        }
      }
      markDirty();
    });

    root.addEventListener('change', (e) => {
      const card = e.target.closest('.q-card');
      if (!card) return;
      const q = findQ(card.dataset.qid);
      if (!q) return;
      if (e.target.classList.contains('q-req') && e.target.type === 'checkbox') {
        q.required = e.target.checked;
      } else if (e.target.classList.contains('q-other-line') && e.target.type === 'checkbox') {
        q.allowOther = e.target.checked;
      } else if (e.target.dataset.field === 'maxRating') {
        q.maxRating = Number(e.target.value);
      }
      markDirty();
    });

    root.addEventListener('click', (e) => {
      const card = e.target.closest('.q-card');
      if (!card) return;
      const qid = card.dataset.qid;
      const btn = e.target.closest('[data-act]');
      const delOpt = e.target.closest('[data-opt-del]');
      const addOpt = e.target.closest('.q-opt-add');
      if (btn) {
        if (btn.dataset.act === 'up') moveQuestion(qid, -1);
        else if (btn.dataset.act === 'down') moveQuestion(qid, 1);
        else if (btn.dataset.act === 'del') removeQuestion(qid);
        return;
      }
      if (delOpt) {
        const q = findQ(qid);
        const idx = Number(delOpt.dataset.optDel);
        if (q.options && q.options.length > 1) {
          q.options.splice(idx, 1);
        } else {
          q.options = [''];
        }
        reRenderQuestion(q);
        markDirty();
        return;
      }
      if (addOpt) {
        const q = findQ(qid);
        q.options.push('');
        reRenderQuestion(q);
        markDirty();
      }
    });

    // 拖拽排序
    let dragId = null;
    root.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.q-card');
      if (!card) return;
      dragId = card.dataset.qid;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    root.addEventListener('dragover', (e) => {
      e.preventDefault();
      const card = e.target.closest('.q-card');
      if (!card || !dragId || card.dataset.qid === dragId) return;
      const cards = $$('.q-card', root);
      const from = cards.findIndex(c => c.dataset.qid === dragId);
      const to = cards.findIndex(c => c.dataset.qid === card.dataset.qid);
      if (from === to) return;
      const arr = state.editing.structure;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      renderEditor();
      markDirty();
    });
    root.addEventListener('dragend', () => {
      dragId = null;
      $$('.q-card', root).forEach(c => c.classList.remove('dragging'));
    });
  }

  function reRenderQuestion(q) {
    const old = $('.q-card[data-qid="' + q.id + '"]', $('#editorLeft'));
    if (old) {
      const fresh = questionCard(q);
      old.replaceWith(fresh);
    }
  }

  function findQ(id) {
    return (state.editing.structure || []).find(q => q.id === id);
  }

  function addQuestion(type) {
    const s = state.editing;
    const q = {
      id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      title: '',
      required: false
    };
    if (type === 'radio' || type === 'checkbox' || type === 'dropdown') {
      q.options = ['', ''];
      q.allowOther = false;
    } else if (type === 'text') {
      q.placeholder = '';
    } else if (type === 'rating') {
      q.maxRating = 5;
    }
    s.structure.push(q);
    renderEditor();
    markDirty();
  }

  function moveQuestion(id, dir) {
    const arr = state.editing.structure;
    const i = arr.findIndex(q => q.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderEditor();
    markDirty();
  }

  function removeQuestion(id) {
    const s = state.editing;
    s.structure = s.structure.filter(q => q.id !== id);
    renderEditor();
    markDirty();
  }

  function renderPreview() {
    const s = state.editing;
    const wrap = $('#editorPreview');
    wrap.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'fill-head';
    head.innerHTML = '<h2>' + esc(s.title || '未命名问卷') + '</h2>' +
      '<div class="fill-desc">' + esc(s.description || '实时预览：右侧即填答者看到的效果') + '</div>';
    wrap.appendChild(head);
    const body = document.createElement('div');
    body.className = 'fill-body';
    if (!s.structure || !s.structure.length) {
      body.innerHTML = '<div class="empty" style="padding:40px 10px"><p>还没有题目，点击下方按钮添加</p></div>';
    } else {
      body.appendChild(SurveyRenderer.render(s.structure, { prefix: 'pv' }));
      SurveyRenderer.bindInteractions(body);
    }
    wrap.appendChild(body);
  }

  function markDirty() {
    state.dirty = true;
    const hint = $('#saveHint');
    if (hint) hint.textContent = '有未保存修改…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => saveEditor(false), 800);
  }

  async function saveEditor(showTip) {
    const s = state.editing;
    if (!s) return;
    // 清理空题目、空选项
    s.structure = s.structure.filter(q => (q.title || '').trim() !== '');
    s.structure.forEach(q => {
      if (q.options) {
        q.options = q.options.map(o => (o || '').trim()).filter(Boolean);
        if ((q.type === 'radio' || q.type === 'checkbox' || q.type === 'dropdown') && (!q.options.length || q.options.length < 2)) {
          q.options = q.options.length ? q.options : ['是', '否'];
        }
      }
    });
    try {
      const data = await api('/api/surveys/' + s.id, { method: 'PUT', body: { ...s, settings: s.settings } });
      state.editing = data.survey;
      state.dirty = false;
      const hint = $('#saveHint');
      if (hint) hint.textContent = '已保存 ' + fmtTime(Date.now()).slice(11);
      if (showTip) toast('已保存', 'ok');
    } catch (e) {
      toast('保存失败：' + e.message, 'err');
    }
  }

  async function publishSurvey() {
    const s = state.editing;
    await saveEditor(false);
    if (!s.structure.length) { toast('请先添加题目再发布', 'err'); return; }
    try {
      await api('/api/surveys/' + s.id + '/actions', { method: 'POST', body: { action: 'publish' } });
      toast('发布成功！可复制填答链接分享', 'ok');
      renderEditor();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  async function closeSurvey() {
    const s = state.editing;
    try {
      await api('/api/surveys/' + s.id + '/actions', { method: 'POST', body: { action: 'close' } });
      toast('问卷已结束', 'ok');
      renderEditor();
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function fillLink(id) {
    return location.origin + '/s/' + (id || state.editing.id);
  }

  async function copyFillLink() {
    const s = state.editing;
    if (s.status !== 'published') { toast('请先发布问卷再分享', 'err'); return; }
    const link = fillLink(s.id);
    try {
      await navigator.clipboard.writeText(link);
      toast('填答链接已复制', 'ok');
    } catch (e) {
      prompt('复制填答链接：', link);
    }
  }

  function openFillPage() {
    const s = state.editing;
    window.open(fillLink(s.id), '_blank');
  }

  /* ---------------- 结果页 ---------------- */
  async function openResults(id) {
    try {
      const [detail, stats] = await Promise.all([
        api('/api/surveys/' + id),
        api('/api/surveys/' + id + '/stats')
      ]);
      state.results = { survey: detail.survey, stats: stats.stats };
      renderResults();
    } catch (e) {
      toast(e.message, 'err');
      location.hash = '#/';
    }
  }

  function renderResults() {
    const { survey, stats } = state.results;
    const total = stats.total;
    const box = $('#resultsBody');
    box.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'res-head';
    head.innerHTML =
      '<h2>' + esc(survey.title) + '</h2>' +
      '<span class="chip ' + ({ draft: 'chip-draft', published: 'chip-published', closed: 'chip-closed' }[survey.status]) + '">' + STATUS_LABEL[survey.status] + '</span>' +
      '<span style="font-size:13px;color:var(--muted)">共 ' + total + ' 份答卷</span>' +
      '<div class="res-actions">' +
      '<button class="btn btn-ghost btn-sm" data-act="back">返回</button>' +
      '<button class="btn btn-soft btn-sm" data-act="export">导出 CSV</button>' +
      '<button class="btn btn-primary btn-sm" data-act="analyze">✨ AI 分析数据</button>' +
      '</div>';
    box.appendChild(head);

    if (total === 0) {
      const empty = document.createElement('div');
      empty.className = 'card card-pad';
      empty.innerHTML = '<div class="empty" style="padding:40px"><div class="e-ico">📭</div><h3>还没有答卷</h3><p>发布问卷并分享填答链接后，这里会显示统计</p></div>';
      box.appendChild(empty);
      bindResActions(box);
      return;
    }

    // 每题统计
    stats.perQuestion.forEach((st, i) => {
      box.appendChild(renderStatBlock(st, i));
    });

    // 答卷明细表
    const tableCard = document.createElement('div');
    tableCard.className = 'card';
    tableCard.innerHTML = '<div class="card-pad"><div class="card-title">答卷明细（最多显示 500 份）</div></div>';
    const tWrap = document.createElement('div');
    tWrap.className = 'table-wrap';
    tWrap.innerHTML = '<table class="res-table"><thead><tr><th>#</th><th>提交时间</th>' +
      survey.structure.map((q, i) => '<th>' + esc('Q' + (i + 1)) + '</th>').join('') + '</tr></thead><tbody></tbody></table>';
    tableCard.appendChild(tWrap);
    box.appendChild(tableCard);
    loadResponsesTable(survey, tWrap.querySelector('tbody'));

    bindResActions(box);
  }

  function renderStatBlock(st, idx) {
    const block = document.createElement('div');
    block.className = 'stat-block';
    const head = document.createElement('div');
    head.className = 'qtitle';
    head.innerHTML = '<span class="chip chip-ai">Q' + (idx + 1) + '</span> <span>' + esc(st.title) + '</span>' +
      '<span style="font-size:12px;color:var(--muted);font-weight:400">' + SurveyRenderer.TYPE_NAMES[st.type] + (st.required ? ' · 必答' : '') + ' · 回答 ' + st.answered + ' / 跳过 ' + st.skipped + '</span>';
    block.appendChild(head);

    if (st.type === 'radio' || st.type === 'dropdown' || st.type === 'checkbox') {
      const entries = Object.entries(st.counts || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...entries.map(([, n]) => n));
      entries.forEach(([k, n]) => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML =
          '<div class="b-label" title="' + esc(k) + '">' + esc(k === '__other__' ? '其他' : k) + '</div>' +
          '<div class="b-track"><div class="b-fill" style="width:' + Math.round(n * 100 / max) + '%"></div></div>' +
          '<div class="b-num">' + n + ' 人</div>' +
          '<div class="b-pct">' + Math.round(n * 100 / (st.answered || 1)) + '%</div>';
        block.appendChild(row);
      });
      if (st.otherTexts && st.otherTexts.length) {
        const o = document.createElement('div');
        o.style.cssText = 'margin-top:10px;font-size:12.5px;color:var(--muted)';
        o.innerHTML = '「其他」补充：' + esc(st.otherTexts.slice(0, 8).join(' / '));
        block.appendChild(o);
      }
    } else if (st.type === 'rating') {
      const avg = document.createElement('div');
      avg.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:12px';
      avg.innerHTML = '<div><div class="avg-big">' + st.average + '</div><div style="font-size:12px;color:var(--muted)">平均分 / ' + (st.buckets ? Object.keys(st.buckets).length : 5) + ' 分制</div></div>';
      const entries = Object.entries(st.buckets || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
      entries.forEach(([k, n]) => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML =
          '<div class="b-label"><span class="rating-stars">' + '★'.repeat(Number(k)) + '</span></div>' +
          '<div class="b-track"><div class="b-fill" style="width:' + Math.round(n * 100 / (st.answered || 1)) + '%"></div></div>' +
          '<div class="b-num">' + n + ' 人</div>' +
          '<div class="b-pct">' + Math.round(n * 100 / (st.answered || 1)) + '%</div>';
        block.appendChild(row);
      });
      block.appendChild(avg);
    } else if (st.type === 'date') {
      const entries = Object.entries(st.counts || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      entries.forEach(([k, n]) => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML =
          '<div class="b-label">' + esc(k) + '</div>' +
          '<div class="b-track"><div class="b-fill" style="width:' + Math.round(n * 100 / (st.answered || 1)) + '%"></div></div>' +
          '<div class="b-num">' + n + ' 份</div>' +
          '<div class="b-pct">' + Math.round(n * 100 / (st.answered || 1)) + '%</div>';
        block.appendChild(row);
      });
    } else {
      // 文本
      (st.texts || []).slice(0, 15).forEach(t => {
        const div = document.createElement('div');
        div.className = 'text-answer';
        div.textContent = t;
        block.appendChild(div);
      });
      if (!st.texts || !st.texts.length) {
        block.innerHTML += '<div style="font-size:13px;color:var(--muted)">暂无文字回答</div>';
      }
    }
    return block;
  }

  async function loadResponsesTable(survey, tbody) {
    try {
      const data = await api('/api/surveys/' + survey.id + '/responses?limit=500');
      tbody.innerHTML = data.responses.map((r, i) => {
        const cells = ['<td>' + (i + 1) + '</td>', '<td>' + fmtTime(r.createdAt) + '</td>'];
        survey.structure.forEach(q => {
          const v = r.data[q.id];
          let txt = '';
          if (Array.isArray(v)) txt = v.map(x => String(x).replace(/^__other__:/, '[其他] ')).join('、');
          else if (v !== undefined && v !== null) txt = String(v).replace(/^__other__:/, '[其他] ');
          cells.push('<td title="' + esc(txt) + '">' + esc(txt) + '</td>');
        });
        return '<tr>' + cells.join('') + '</tr>';
      }).join('') || '<tr><td colspan="' + (survey.structure.length + 2) + '" style="text-align:center;color:var(--muted)">加载中…</td></tr>';
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="99" style="text-align:center;color:var(--danger)">加载失败：' + esc(e.message) + '</td></tr>';
    }
  }

  function bindResActions(box) {
    box.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const { survey, stats } = state.results;
      if (act === 'back') { location.hash = '#/'; }
      else if (act === 'export') {
        try {
          const res = await fetch('/api/surveys/' + survey.id + '/export');
          if (!res.ok) throw new Error('导出失败');
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'survey_' + survey.id + '.csv';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('已导出 CSV', 'ok');
        } catch (err) { toast(err.message, 'err'); }
      }
      else if (act === 'analyze') { aiAnalyze(); }
    });
  }

  /* ---------------- AI 分析 ---------------- */
  async function aiAnalyze() {
    const { survey } = state.results;
    const panel = document.createElement('div');
    panel.className = 'ai-panel';
    panel.id = 'aiPanel';
    panel.innerHTML = '<div class="ai-loading"><div class="spinner"></div>AI 正在分析 ' + survey.title + ' 的数据…</div>';
    $('#resultsBody').appendChild(panel);
    try {
      const data = await api('/api/ai/analyze', { method: 'POST', body: { surveyId: survey.id } });
      renderAnalysis(panel, data.analysis, data.sampled);
    } catch (e) {
      panel.innerHTML = '<div class="ai-para" style="color:var(--danger)">⚠️ ' + esc(e.message) + '</div>';
    }
  }

  function renderAnalysis(panel, a, sampled) {
    const li = (arr, cls) => arr && arr.length
      ? '<ul class="ai-list ' + (cls || '') + '">' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>'
      : '<div style="font-size:13px;color:var(--muted)">无</div>';
    panel.innerHTML =
      '<div class="ai-section"><div class="h"><span class="dot"></span>总体概述' +
      '<span class="chip chip-warn" style="margin-left:auto">基于最近 ' + sampled + ' 份样本</span></div>' +
      '<div class="ai-para">' + esc(a.overview || '') + '</div></div>' +
      '<div class="ai-section"><div class="h"><span class="dot"></span>核心发现</div>' + li(a.highlights) + '</div>' +
      '<div class="ai-section"><div class="h"><span class="dot"></span>风险与注意信号</div>' + li(a.risks, 'risk') + '</div>' +
      '<div class="ai-section"><div class="h"><span class="dot"></span>可执行建议</div>' + li(a.suggestions, 'sug') + '</div>';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------------- AI 生成问卷 ---------------- */
  async function refreshAiStatus() {
    const banner = $('#aiBanner');
    try {
      const st = await api('/api/ai/status');
      if (!st.configured) {
        banner.innerHTML = '<div class="chip chip-danger" style="margin-bottom:14px">⚠️ 未配置 DeepSeek 密钥：请在 Cloudflare 设置加密密文 DEEPSEEK_API_KEY（见 README）</div>';
      } else {
        const b = st.balance;
        banner.innerHTML = '<div class="chip chip-ai" style="margin-bottom:14px">✓ DeepSeek 已连接' +
          (b && b.ok ? ' · 余额 ' + (b.currency === 'USD' ? '$' : '¥') + b.total + '</div>' : '</div>');
      }
    } catch (e) { /* 忽略 */ }
  }

  async function aiGenerate() {
    const topic = $('#aiTopic').value.trim();
    if (!topic) { toast('请先描述你想收集什么内容', 'err'); $('#aiTopic').focus(); return; }
    const btn = $('#aiGenBtn');
    btn.disabled = true;
    btn.textContent = 'AI 思考中…（联网检索 + 设计题目）';
    $('#aiResult').innerHTML = '<div class="ai-loading"><div class="spinner"></div>正在生成问卷，通常需要 30-60 秒…</div>';
    try {
      const data = await api('/api/ai/generate', {
        method: 'POST',
        body: {
          topic,
          count: Number($('#aiCount').value),
          search: $('#aiSearch').checked
        }
      });
      renderGenResult(data.survey, data.usedSearch);
    } catch (e) {
      $('#aiResult').innerHTML = '<div class="gen-preview"><div style="color:var(--danger)">⚠️ ' + esc(e.message) + '</div></div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '一键生成问卷';
    }
  }

  function renderGenResult(survey, usedSearch) {
    const box = $('#aiResult');
    let html = '<div class="gen-preview">' +
      (usedSearch
        ? '<div class="chip chip-warn" style="margin-bottom:10px">已联网检索相关资料后生成</div>'
        : '<div class="chip chip-soft" style="margin-bottom:10px">未检索到外部资料（基于 AI 知识生成）</div>') +
      '<div class="gp-title">' + esc(survey.title) + '</div>' +
      '<div class="gp-desc">' + esc(survey.description || '') + '</div>' +
      '<div style="margin-top:12px">';
    survey.structure.forEach((q, i) => {
      const opts = q.options ? '　' + esc(q.options.join(' / ')) : (q.placeholder ? '　' + esc(q.placeholder) : '');
      html += '<div class="gp-q"><div class="n">' + (i + 1) + '</div><div class="t"><b>' + esc(q.title) + '</b>' +
        (opts ? '<div class="o">' + opts + '</div>' : '') + '</div>' +
        '<div class="ty">' + TYPE_LABEL[q.type] + (q.required ? '·必答' : '') + '</div></div>';
    });
    html += '</div><div class="gen-actions">' +
      '<button class="btn btn-primary" id="genSaveBtn">保存为草稿并去编辑</button>' +
      '<button class="btn btn-ghost" id="genPublishBtn">保存并直接发布</button>' +
      '<button class="btn btn-ghost" id="genRegenBtn">重新生成</button>' +
      '</div></div>';
    box.innerHTML = html;
    $('#genSaveBtn').addEventListener('click', () => saveGenerated(false));
    $('#genPublishBtn').addEventListener('click', () => saveGenerated(true));
    $('#genRegenBtn').addEventListener('click', () => aiGenerate());
    window._genSurvey = survey;
  }

  async function saveGenerated(publish) {
    const gen = window._genSurvey;
    if (!gen) return;
    const btn = publish ? $('#genPublishBtn') : $('#genSaveBtn');
    btn.disabled = true;
    try {
      const data = await api('/api/surveys', {
        method: 'POST',
        body: {
          title: gen.title,
          description: gen.description,
          structure: gen.structure,
          status: publish ? 'published' : 'draft',
          settings: { submitTip: '提交成功，感谢参与！' }
        }
      });
      toast(publish ? '已创建并发布' : '已保存为草稿', 'ok');
      location.hash = '#/edit/' + data.survey.id;
    } catch (e) {
      btn.disabled = false;
      toast(e.message, 'err');
    }
  }

  /* ---------------- 对外 ---------------- */
  window.App = {
    createBlank,
    aiGenerate,
    saveEditor,
    publishSurvey,
    closeSurvey,
    copyFillLink,
    openFillPage
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
