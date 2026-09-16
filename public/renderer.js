/* ============================================================
   问卷工作台 · 共享问卷渲染器
   把题目结构渲染成填答 DOM，供以下两处复用：
    - 公开填答页（fill.js）
    - 编辑器右侧实时预览（app.js）
   用法：
    SurveyRenderer.render(questions, opts)     → 渲染容器 DOM
    SurveyRenderer.bindInteractions(container) → 绑定评分星/其他选项交互
    SurveyRenderer.collect(container)          → 收集填答值 {qid: answer}
    SurveyRenderer.validate(container, questions) → 校验必答
    SurveyRenderer.fillPreview(container, answers) → 回填答案（预览用）
   ============================================================ */
(function (global) {
  'use strict';

  const TYPE_NAMES = {
    radio: '单选题', checkbox: '多选题', text: '填空题',
    rating: '评分题', dropdown: '下拉选择题', date: '日期题'
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // 渲染一组题目
  function render(questions, opts) {
    opts = opts || {};
    const frag = document.createDocumentFragment();
    const namePrefix = opts.prefix || 'a';

    (questions || []).forEach((q, idx) => {
      const box = el('div', 'fq');
      box.dataset.qid = q.id;
      if (opts.answers && opts.answers[q.id]) {
        box.dataset.initial = JSON.stringify(opts.answers[q.id]);
      }

      const title = el('div', 'fq-title');
      title.appendChild(el('span', null, (idx + 1) + '. ' + (q.title || '未命名题目')));
      if (q.required) title.appendChild(el('span', 'star', '*'));
      box.appendChild(title);

      const name = namePrefix + '_' + q.id;
      const isChecked = opts.answers && opts.answers[q.id];

      if (q.type === 'radio' || q.type === 'checkbox') {
        const list = el('div', 'fq-opts');
        const type = q.type === 'radio' ? 'radio' : 'checkbox';
        (q.options || []).forEach(opt => {
          const label = el('label', 'fq-opt');
          const input = document.createElement('input');
          input.type = type; input.name = name; input.value = opt;
          if (type === 'checkbox') {
            if (Array.isArray(isChecked) && isChecked.includes(opt)) input.checked = true;
          } else if (isChecked === opt) input.checked = true;
          label.appendChild(input);
          label.appendChild(el('span', null, opt));
          list.appendChild(label);
        });
        if (q.allowOther) {
          const line = el('div', 'fq-opt other-line');
          const input = document.createElement('input');
          input.type = type; input.name = name; input.value = '__other__';
          input.className = 'other-radio';
          line.appendChild(input);
          line.appendChild(el('span', null, '其他：'));
          const text = document.createElement('input');
          text.type = 'text'; text.className = 'other-input';
          text.placeholder = '请输入';
          text.disabled = true;
          line.appendChild(text);
          list.appendChild(line);
        }
        box.appendChild(list);
      } else if (q.type === 'dropdown') {
        const select = document.createElement('select');
        select.className = 'select fq-select';
        select.name = name;
        const ph = document.createElement('option');
        ph.value = ''; ph.textContent = '请选择';
        select.appendChild(ph);
        (q.options || []).forEach(opt => {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          select.appendChild(o);
        });
        if (q.allowOther) {
          const o = document.createElement('option');
          o.value = '__other__'; o.textContent = '其他（请在下方填写）';
          select.appendChild(o);
        }
        box.appendChild(select);
        if (q.allowOther) {
          const text = document.createElement('input');
          text.type = 'text'; text.className = 'input other-dropdown';
          text.placeholder = '若选择「其他」，请在此填写';
          text.disabled = true;
          text.style.marginTop = '10px';
          box.appendChild(text);
        }
      } else if (q.type === 'text') {
        const input = document.createElement('textarea');
        input.className = 'textarea fq-text';
        input.name = name;
        input.rows = 3;
        input.placeholder = q.placeholder || '请输入';
        if (opts.answers && opts.answers[q.id]) input.value = opts.answers[q.id];
        box.appendChild(input);
      } else if (q.type === 'rating') {
        const max = Math.min(Math.max(q.maxRating || 5, 3), 10);
        const wrap = el('div', 'fq-rating');
        wrap.dataset.max = max;
        for (let i = 1; i <= max; i++) {
          const b = el('button', 'star-btn', String(i));
          b.type = 'button'; b.dataset.val = i;
          b.title = i + ' 分';
          wrap.appendChild(b);
        }
        box.appendChild(wrap);
      } else if (q.type === 'date') {
        const d = el('div', 'fq-date');
        const input = document.createElement('input');
        input.type = 'date'; input.name = name; input.className = 'fq-date-input';
        if (opts.answers && opts.answers[q.id]) input.value = opts.answers[q.id];
        d.appendChild(input);
        box.appendChild(d);
      }

      box.appendChild(el('div', 'err-text', '此题必答，请完成后再提交'));
      frag.appendChild(box);
    });

    return frag;
  }

  // 绑定交互：评分星点击、其他选项联动
  function bindInteractions(container) {
    container.addEventListener('click', (e) => {
      const star = e.target.closest('.star-btn');
      if (star) {
        const wrap = star.closest('.fq-rating');
        const val = Number(star.dataset.val);
        wrap.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.val) <= val));
        return;
      }
      const otherRadio = e.target.closest('input.other-radio');
      if (otherRadio) {
        const inp = otherRadio.closest('.other-line').querySelector('.other-input');
        if (inp) inp.disabled = !otherRadio.checked;
        if (otherRadio.checked && inp) inp.focus();
        return;
      }
      const sel = e.target.closest('select.fq-select');
      if (sel) {
        const inp = sel.closest('.fq').querySelector('.other-dropdown');
        if (inp) inp.disabled = sel.value !== '__other__';
      }
    });
    // 点击“其他：”文字时联动勾选
    container.addEventListener('click', (e) => {
      const span = e.target.closest('.other-line > span');
      if (!span) return;
      const line = span.closest('.other-line');
      const radio = line.querySelector('input.other-radio');
      if (radio && !radio.checked) {
        radio.checked = true;
        const inp = line.querySelector('.other-input');
        if (inp) { inp.disabled = false; inp.focus(); }
      }
    });
  }

  // 从 DOM 收集填答值
  function collect(container) {
    const result = {};
    container.querySelectorAll('.fq').forEach(box => {
      const qid = box.dataset.qid;
      const radio = box.querySelector('input[type=radio]:checked');
      const checkbox = box.querySelectorAll('input[type=checkbox]:checked');
      const select = box.querySelector('select.fq-select');
      const text = box.querySelector('textarea.fq-text');
      const rating = box.querySelector('.fq-rating');
      const date = box.querySelector('input.fq-date-input');

      if (radio) {
        if (radio.classList.contains('other-radio')) {
          const v = box.querySelector('.other-input').value.trim();
          result[qid] = v ? '__other__:' + v : '__other__';
        } else {
          result[qid] = radio.value;
        }
      } else if (checkbox.length) {
        const vals = [];
        checkbox.forEach(cb => {
          if (cb.classList.contains('other-radio')) {
            const v = box.querySelector('.other-input').value.trim();
            vals.push(v ? '__other__:' + v : '__other__');
          } else {
            vals.push(cb.value);
          }
        });
        result[qid] = vals;
      } else if (select) {
        if (select.value === '__other__') {
          const v = box.querySelector('.other-dropdown').value.trim();
          result[qid] = v ? '__other__:' + v : '__other__';
        } else if (select.value !== '') {
          result[qid] = select.value;
        }
      } else if (text) {
        if (text.value.trim() !== '') result[qid] = text.value.trim();
      } else if (rating) {
        const on = rating.querySelector('.star-btn.on');
        if (on) result[qid] = Number(on.dataset.val);
      } else if (date) {
        if (date.value) result[qid] = date.value;
      }
    });
    return result;
  }

  // 校验必答题
  function validate(container, questions) {
    let ok = true;
    (questions || []).forEach(q => {
      const box = container.querySelector('.fq[data-qid="' + q.id + '"]');
      if (!box || !q.required) return;
      const radio = box.querySelector('input[type=radio]:checked');
      const checkbox = box.querySelectorAll('input[type=checkbox]:checked');
      const select = box.querySelector('select.fq-select');
      const text = box.querySelector('textarea.fq-text');
      const rating = box.querySelector('.fq-rating .star-btn.on');
      const date = box.querySelector('input.fq-date-input');
      const otherOk = (box.querySelector('.other-input') || { value: '' }).value.trim() !== '';
      const has =
        (radio && (!radio.classList.contains('other-radio') || otherOk)) ||
        (checkbox.length > 0 && [...checkbox].every(cb => !cb.classList.contains('other-radio') || otherOk)) ||
        (select && select.value !== '') ||
        (text && text.value.trim() !== '') ||
        !!rating ||
        (date && date.value);
      if (!has) {
        box.classList.add('invalid');
        ok = false;
      } else {
        box.classList.remove('invalid');
      }
    });
    return ok;
  }

  // 预览回填
  function fillPreview(container, answers) {
    if (!answers) return;
    container.querySelectorAll('.fq').forEach(box => {
      const qid = box.dataset.qid;
      const v = answers[qid];
      if (v === undefined || v === null) return;
      const raw = String(v);
      if (Array.isArray(v)) {
        box.querySelectorAll('input[type=checkbox]').forEach(cb => {
          cb.checked = v.includes(cb.value);
        });
      } else if (box.querySelector('input[type=radio]')) {
        let found = false;
        box.querySelectorAll('input[type=radio]').forEach(r => {
          if (r.value === raw) { r.checked = true; found = true; }
        });
        if (!found && raw.startsWith('__other__:')) {
          const other = box.querySelector('input.other-radio');
          if (other) {
            other.checked = true;
            const inp = box.querySelector('.other-input');
            inp.disabled = false; inp.value = raw.slice('__other__:'.length);
          }
        }
      } else if (box.querySelector('select.fq-select')) {
        const sel = box.querySelector('select.fq-select');
        sel.value = raw.startsWith('__other__:') ? '__other__' : raw;
        const inp = box.querySelector('.other-dropdown');
        if (inp) {
          inp.disabled = sel.value !== '__other__';
          if (sel.value === '__other__') inp.value = raw.slice('__other__:'.length);
        }
      } else if (box.querySelector('textarea.fq-text')) {
        box.querySelector('textarea.fq-text').value = raw;
      } else if (box.querySelector('.fq-rating')) {
        box.querySelectorAll('.star-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.val) <= Number(v)));
      } else if (box.querySelector('input.fq-date-input')) {
        box.querySelector('input.fq-date-input').value = raw;
      }
    });
  }

  global.SurveyRenderer = { render, bindInteractions, collect, validate, fillPreview, TYPE_NAMES };
})(window);
