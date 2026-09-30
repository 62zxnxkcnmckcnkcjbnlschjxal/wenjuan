// DeepSeek 一键生成「性格/人格测试型问卷」
// POST /api/ai/generate-test  { topic, count? }
// 输入主题（如：恋爱人格、职场性格、渴望恋爱指数）
// 一次性输出：标题 + 简介 + 10~20 道单选题 + 每选项对应哪个结果 + 每种结果的详细描述
import { json, error, readBody, genId } from '../../_lib/util.js';
import { chatJson, hasKey } from '../../_lib/deepseek.js';

export async function onRequestPost(ctx) {
  try {
    if (!hasKey(ctx.env)) {
      return error('服务器未配置 DEEPSEEK_API_KEY，请先在 Cloudflare 设置加密密文后重试', 400);
    }
    const body = await readBody(ctx.request);
    const topic = body && body.topic && String(body.topic).trim();
    if (!topic) return error('请先描述测试主题（例如：你的恋爱人格是什么）');
    if (topic.length > 300) return error('主题描述过长，请精简到 300 字以内');

    const count = Math.min(Math.max(Number(body.count) || 12, 8), 20);

    const system = [
      '你是一名资深心理测评师，擅长设计趣味性格测试、人格测试、恋爱态度测试。',
      '根据用户给的主题，一次性生成一整套完整的测试问卷。',
      '要求：',
      '1. 设计 4~6 种互斥且典型的结果类型（人格/态度/风格），每种结果有专属 key（英文短标识）、名称（2~6字）、一段 100~200 字的详细描述（这种人在关系/生活中是什么样）、3~5 个标签；',
      '2. 设计 ' + count + ' 道题，大部分是单选题（type: "radio"），其中 2~3 道可以是多选题（type: "checkbox"，比如"以下哪些最符合你"）；每题 3~5 个选项；',
      '3. 每个选项都要对应一种结果类型（用 key 表示）；多选题选中的每个选项都对应加分；',
      '4. 题目覆盖不同情境/行为反应，不能全是同一角度；选项要具体、有画面感，不要空泛；',
      '5. 所有题都是必答题；',
      '6. 必须只输出一个 JSON 对象，不要输出任何其他文字、不要用 markdown 包裹。'
    ].join('\n');

    const user = [
      '测试主题：' + topic,
      '请输出 JSON，结构如下：',
      '{',
      '  "title": "测试标题（吸引人、有点题感）",',
      '  "description": "测试说明（2-3句话，告诉用户怎么玩）",',
      '  "results": [',
      '    { "key": "secure", "name": "安全型恋人", "desc": "这种人的详细描述，100~200字，说清楚TA在恋爱/生活中的典型表现、优缺点", "tags": ["信任","稳定"] }',
      '  ],',
      '  "questions": [',
      '    { "type": "radio", "title": "题目内容", "options": ["选项A描述","选项B描述","选项C描述","选项D描述"], "optionTypes": ["secure","anxious","avoidant","fearful"] }',
      '  ]',
      '}',
      '其中：type 用 "radio"（单选）或 "checkbox"（多选）；optionTypes 数组和 options 数组一一对应（第1个选项对应第1个 key）；key 必须在 results 里都出现。',
      '共 ' + count + ' 道题左右，4~6 种结果，其中 2~3 道多选题。'
    ].join('\n');

    const result = await chatJson(ctx.env, [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], { temperature: 0.8, maxTokens: 8192 });

    // ===== 校验 & 规范化 =====
    const title = String(result.title || topic + '测试').trim().slice(0, 200);
    const description = String(result.description || '').trim().slice(0, 2000);

    const resultsRaw = Array.isArray(result.results) ? result.results : [];
    if (resultsRaw.length < 2) return error('AI 生成失败：结果类型不足 2 种，请重试', 502);

    const results = resultsRaw.slice(0, 8).map((r, i) => ({
      key: String(r.key || 'r' + i).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      name: String(r.name || '结果' + (i + 1)).trim().slice(0, 20),
      desc: String(r.desc || '').trim().slice(0, 800),
      tags: Array.isArray(r.tags) ? r.tags.map(t => String(t).trim().slice(0, 10)).filter(Boolean).slice(0, 6) : []
    })).filter(r => r.key && r.name);

    const validKeys = results.map(r => r.key);
    if (results.length < 2) return error('AI 生成失败：结果类型异常，请重试', 502);

    const qsRaw = Array.isArray(result.questions) ? result.questions : [];
    const structure = [];
    for (const q of qsRaw) {
      if (!q || !q.title) continue;
      const opts = Array.isArray(q.options) ? q.options.map(o => String(o).trim()).filter(Boolean) : [];
      const types = Array.isArray(q.optionTypes) ? q.optionTypes.map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')) : [];
      if (opts.length < 3) continue;
      // 选项和类型一一对应，缺类型的补第一个有效 key
      const paired = opts.slice(0, 6).map((opt, i) => {
        const t = types[i] && validKeys.includes(types[i]) ? types[i] : validKeys[0];
        return { text: opt, type: t };
      });
      structure.push({
        id: 'q' + genId(),
        type: q.type === 'checkbox' ? 'checkbox' : 'radio',
        title: String(q.title).trim().slice(0, 200),
        required: true,
        options: paired.map(p => p.text),
        optionTypes: paired.map(p => p.type)
      });
    }

    if (structure.length < 5) {
      return error('AI 生成的题目太少（' + structure.length + ' 道），请重试', 502);
    }

    return json({
      ok: true,
      survey: {
        title, description,
        kind: 'test',
        results,
        structure
      }
    });
  } catch (e) {
    return error('AI 生成失败：' + e.message, 500);
  }
}
