// DeepSeek 一键生成问卷
// POST /api/ai/generate  { topic, count?, search?, extra? }
//  - 可选先联网检索主题资料（尽力而为），再让 DeepSeek 基于资料生成完整问卷
//  - 返回 { title, description, questions[] }，由前端预览后创建
import { json, error, readBody, genId } from '../../_lib/util.js';
import { chatJson, hasKey } from '../../_lib/deepseek.js';
import { searchWeb } from '../../_lib/search.js';

const QUESTION_TYPES = ['radio', 'checkbox', 'text', 'rating', 'dropdown', 'date'];
const TYPE_NAMES = {
  radio: '单选题', checkbox: '多选题', text: '填空题',
  rating: '评分题', dropdown: '下拉选择题', date: '日期题'
};

function normalizeQuestions(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.questions) ? raw.questions : []);
  const out = [];
  for (const q of list) {
    if (!q || !q.title) continue;
    const type = QUESTION_TYPES.includes(q.type) ? q.type : 'text';
    const item = {
      id: 'q' + genId(),
      type,
      title: String(q.title).trim().slice(0, 200),
      required: !!q.required
    };
    if (type === 'radio' || type === 'checkbox' || type === 'dropdown') {
      const opts = (Array.isArray(q.options) ? q.options : []).map(o => String(o).trim()).filter(Boolean);
      if (opts.length < 2) continue; // 选项不足的单选题丢弃
      item.options = opts.slice(0, 12);
      if (q.allowOther) item.allowOther = true;
    } else if (type === 'rating') {
      item.maxRating = Math.min(Math.max(Number(q.maxRating) || 5, 3), 10);
    } else if (type === 'text') {
      item.placeholder = String(q.placeholder || '').slice(0, 100);
    }
    out.push(item);
  }
  return out;
}

export async function onRequestPost(ctx) {
  try {
    if (!hasKey(ctx.env)) {
      return error('服务器未配置 DEEPSEEK_API_KEY，请先在 Cloudflare 设置加密密文后重试', 400);
    }
    const body = await readBody(ctx.request);
    const topic = body && body.topic && String(body.topic).trim();
    if (!topic) return error('请先描述你想收集什么内容（例如：光遇游戏玩法体验）');
    if (topic.length > 500) return error('主题描述过长，请精简到 500 字以内');

    const count = Math.min(Math.max(Number(body.count) || 8, 3), 20);
    const wantSearch = body.search !== false;

    // 1) 可选联网检索
    let webContext = '';
    if (wantSearch) {
      try {
        const results = await searchWeb(topic + ' 问卷 调查 用户反馈', 8);
        if (results.length) {
          webContext = '以下是联网检索到的相关公开资料，请优先参考这些信息来设计题目：\n' +
            results.map((r, i) =>
              `${i + 1}. ${r.title}\n   来源：${r.url}\n   ${(r.snippet || '').slice(0, 300)}`
            ).join('\n') + '\n';
        }
      } catch (e) { /* 检索失败则降级为纯知识生成 */ }
    }

    // 2) DeepSeek 生成
    const system = [
      '你是一名资深的问卷设计专家，擅长为游戏、产品、市场调研等领域设计专业问卷。',
      '请根据用户描述的主题，设计一份结构合理、问题专业的问卷。',
      '要求：',
      '1. 题目覆盖从浅到深：基本信息/使用习惯 → 具体体验 → 偏好态度 → 改进建议；',
      '2. 单选题选项互相独立、覆盖主要情况，并包含合理的否定/中性选项；',
      '3. 混合使用多种题型：单选、多选、填空、评分、下拉、日期；',
      '4. 不要问与主题无关的问题；',
      '5. 必须只输出一个 JSON 对象，不要输出任何其他文字。'
    ].join('\n');

    const user = [
      '需要设计问卷的主题：' + topic,
      webContext ? webContext : '（未启用联网检索或检索失败，请基于你的知识设计）',
      '请输出 JSON，结构如下：',
      '{',
      '  "title": "问卷标题（简洁、点题）",',
      '  "description": "问卷简介（面向填答者的说明，2-3 句话）",',
      '  "questions": [',
      '    { "type": "radio|checkbox|text|rating|dropdown|date", "title": "题目内容", "required": true, "options": ["选项1","选项2",...], "allowOther": false, "placeholder": "输入提示", "maxRating": 5 }',
      '  ]',
      '}',
      '其中：radio/checkbox/dropdown 必须提供 3-8 个 options；text 可提供 placeholder；rating 用 maxRating（3-10）。',
      '共生成 ' + count + ' 道题左右。'
    ].join('\n');

    const result = await chatJson(ctx.env, [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], { temperature: 0.7, maxTokens: 4096 });

    const title = String(result.title || topic + '调查问卷').trim().slice(0, 200);
    const description = String(result.description || '').trim().slice(0, 2000);
    const questions = normalizeQuestions(result.questions);

    if (questions.length === 0) {
      return error('AI 生成的题目为空，请换一个主题描述或稍后重试', 502);
    }
    return json({
      ok: true,
      usedSearch: !!webContext,
      survey: { title, description, structure: questions }
    });
  } catch (e) {
    return error('AI 生成失败：' + e.message, 500);
  }
}
