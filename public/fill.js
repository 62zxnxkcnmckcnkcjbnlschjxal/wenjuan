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

  const surveyId = (location.pathname.match(/^\/s\/([\w-]+)/) || [])[1];
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
      $('#fillRoot').innerHTML = stateView('🔍', '链接无效', '请在链接中包含问卷 ID，例如 /s/xxxxxx');
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
      $('#fillRoot').innerHTML = stateView('🎉', '提交成功', data.message || '感谢参与！',
        '<button class="btn btn-ghost" onclick="location.reload()">再填一份</button>');
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '提交问卷'; }
      submitting = false;
      toast(e.message);
    }
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
