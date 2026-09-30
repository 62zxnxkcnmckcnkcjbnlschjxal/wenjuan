/* ============================================================
   问卷工作台 · 公开填答页
   通过 /s/<问卷ID> 访问（_redirects 重写到本页）
   ============================================================ */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* 问卷 ID 解析：兼容多种链接形态
     1) 标准填答链接 /s/<id>
     2) 带查询参数 ?id=<id>（防重定向丢 ID 时的兜底）
     3) hash 形式 #/s/<id>
   */
  function resolveSurveyId() {
    const p = location.pathname || '';
    let m = p.match(/^\/s\/([\w-]+)/);
    if (m) return m[1];
    m = (location.search || '').match(/[?&]id=([\w-]+)/);
    if (m) return m[1];
    m = (location.hash || '').match(/\/s\/([\w-]+)/);
    if (m) return m[1];
    return null;
  }

  const surveyId = resolveSurveyId();
  let survey = null;
  let submitting = false;

  function stateView(ico, title, sub, extra) {
    return '<div class="card card-pad" style="text-align:center;padding:60px 24px">' +
      '<div style="font-size:48px;margin-bottom:14px">' + ico + '</div>' +
      '<h2 style="font-size:18px;margin-bottom:8px">' + esc(title) + '</h2>' +
      '<p style="color:var(--muted);font-size:14px;margin-bottom:18px">' + esc(sub) + '</p>' +
      (extra || '') + '</div>';
  }

  async function load() {
    if (!surveyId) {
      $('#fillRoot').innerHTML = stateView('🔍', '链接无效', '当前地址不是 /s/问卷ID 格式，无法定位问卷。请回到问卷列表，点「🔗 链接」按钮复制完整填答链接。') +
        '<div class="card card-pad" style="text-align:left;padding:16px 20px;margin-top:12px">' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:6px">当前打开地址：</div>' +
        '<code style="font-size:12.5px;word-break:break-all;color:var(--fg)">' + esc(location.href) + '</code>' +
        '</div>';
      return;
    }
    $('#fillRoot').innerHTML = '<div class="ai-loading" style="padding:80px 0"><div class="spinner"></div>加载问卷中…</div>';
    try {
      const res = await fetch('/api/surveys/' + surveyId + '/public');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = res.status;
        if (code === 404) $('#fillRoot').innerHTML = stateView('🗑️', '问卷不存在', '该问卷可能已被删除');
        else if (code === 403) $('#fillRoot').innerHTML = stateView('⏰', data.error || '问卷不可填写', '请联系问卷发布者');
        else $('#fillRoot').innerHTML = stateView('⚠️', '加载失败', data.error || '网络异常，请稍后重试');
        return;
      }
      survey = data.survey;
      render();
    } catch (e) {
      $('#fillRoot').innerHTML = stateView('⚠️', '加载失败', '无法连接服务器，请检查网络后重试');
    }
  }

  function render() {
    const root = $('#fillRoot');
    root.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'fill-wrap';

    const head = document.createElement('div');
    head.className = 'fill-head';
    head.innerHTML = '<h2>' + esc(survey.title) + '</h2>' +
      (survey.description ? '<div class="fill-desc">' + esc(survey.description) + '</div>' : '') +
      (survey.endAt ? '<div style="font-size:12.5px;color:var(--muted);margin-top:8px">截止时间：' + esc(new Date(survey.endAt).toLocaleString('zh-CN', { hour12: false })) + '</div>' : '');
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.className = 'fill-body';
    if (!survey.structure || !survey.structure.length) {
      body.innerHTML = '<div class="empty" style="padding:40px"><p>该问卷暂无题目</p></div>';
    } else {
      body.appendChild(SurveyRenderer.render(survey.structure, { prefix: 'f' }));
      SurveyRenderer.bindInteractions(body);
      const submitRow = document.createElement('div');
      submitRow.style.cssText = 'display:flex;justify-content:center;padding:22px 0 8px';
      submitRow.innerHTML =
        '<button class="btn btn-primary btn-lg" id="submitBtn" style="min-width:220px">提交问卷</button>';
      body.appendChild(submitRow);
    }
    wrap.appendChild(body);
    root.appendChild(wrap);

    const btn = $('#submitBtn');
    if (btn) {
      btn.addEventListener('click', submit);
      body.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter 快捷提交
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') submit();
      });
    }
  }

  async function submit() {
    if (submitting) return;
    const body = $('.fill-body');
    if (!SurveyRenderer.validate(body, survey.structure)) {
      const first = body.querySelector('.fq.invalid');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const answers = SurveyRenderer.collect(body);
    submitting = true;
    const btn = $('#submitBtn');
    if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
    try {
      const res = await fetch('/api/surveys/' + surveyId + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '提交失败');

      // ===== 测试型问卷：前端算分并展示人格结果 =====
      const settings = survey.settings || {};
      if (settings.kind === 'test' && Array.isArray(settings.results) && settings.results.length) {
        const scores = {};
        settings.results.forEach(r => { scores[r.key] = 0; });
        survey.structure.forEach(q => {
          if (!Array.isArray(q.optionTypes)) return;
          const ans = answers[q.id];
          if (ans === undefined || ans === null) return;
          // 单选题：ans 是字符串；多选题：ans 是数组
          const chosen = Array.isArray(ans) ? ans : [ans];
          chosen.forEach(opt => {
            if (opt === '' || opt === undefined || opt === null) return;
            const idx = (q.options || []).indexOf(opt);
            if (idx < 0) return;
            const key = q.optionTypes[idx];
            if (key && scores[key] !== undefined) scores[key] += 1;
          });
        });
        let bestKey = settings.results[0].key, bestScore = -1;
        settings.results.forEach(r => {
          if (scores[r.key] > bestScore) { bestScore = scores[r.key]; bestKey = r.key; }
        });
        const result = settings.results.find(r => r.key === bestKey) || settings.results[0];
        showTestResult(result, bestScore, survey.structure.length);
        return;
      }

      $('#fillRoot').innerHTML = stateView('🎉', '提交成功', data.message || '感谢参与！',
        '<button class="btn btn-ghost" onclick="location.reload()">再测一次</button>');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '提交问卷'; }
      submitting = false;
      toast(e.message);
    }
  }

  function showTestResult(result, score, total) {
    const pct = total ? Math.round(score / total * 100) : 0;
    const tagsHtml = (result.tags || []).map(t =>
      '<span style="display:inline-block;background:var(--primary-soft,rgba(255,71,87,.1));color:var(--primary,#ff4757);border-radius:999px;padding:3px 12px;font-size:12.5px;margin:3px 4px 0 0">' + esc(t) + '</span>'
    ).join('');
    $('#fillRoot').innerHTML =
      '<div class="card card-pad" style="text-align:center;padding:44px 24px;max-width:560px;margin:20px auto">' +
      '<div style="font-size:14px;color:var(--muted);letter-spacing:.2em;margin-bottom:14px">—— 你的测试结果 ——</div>' +
      '<div style="font-size:34px;font-weight:700;margin-bottom:6px">' + esc(result.name) + '</div>' +
      '<div style="font-size:13px;color:var(--muted);margin-bottom:20px">契合度 ' + pct + '%</div>' +
      '<div style="width:100%;height:8px;background:var(--border,#eee);border-radius:99px;overflow:hidden;margin-bottom:22px">' +
      '<div style="height:100%;width:' + pct + '%;background:var(--primary,#ff4757);border-radius:99px;transition:width .8s ease"></div></div>' +
      '<p style="font-size:15px;line-height:1.8;text-align:left;color:var(--fg,#333)">' + esc(result.desc || '') + '</p>' +
      (tagsHtml ? '<div style="margin-top:18px;text-align:center">' + tagsHtml + '</div>' : '') +
      '<div style="margin-top:28px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn btn-primary" onclick="location.reload()">再测一次</button>' +
      '<button class="btn btn-ghost" onclick="navigator.clipboard && navigator.clipboard.writeText(\'我测出来是「' + esc(result.name) + '」，你也来测测：\' + location.href).then(()=>alert(\'结果已复制\')).catch(()=>alert(\'复制失败\'))">复制分享</button>' +
      '</div></div>';
    window.scrollTo(0, 0);
  }

  function toast(msg) {
    const wrap = $('#toast-wrap') || (() => { const d = document.createElement('div'); d.id = 'toast-wrap'; document.body.appendChild(d); return d; })();
    const t = document.createElement('div');
    t.className = 'toast err';
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  document.addEventListener('DOMContentLoaded', load);
})();
