// DeepSeek 问卷数据分析
// POST /api/ai/analyze  { surveyId }
// 服务端基于最近 200 份答卷做统计压缩，再交由 DeepSeek 输出洞察结论
import { json, error, readBody } from '../../_lib/util.js';
import { chatJson, hasKey } from '../../_lib/deepseek.js';
import { getSurvey, listResponses } from '../../_lib/db.js';
import { computeStats } from '../../_lib/stats.js';

const SAMPLE_LIMIT = 200;

function buildDataText(structure, responses, stats) {
  const lines = [];
  lines.push('问卷共 ' + structure.length + ' 道题，样本 ' + responses.length + ' 份。');
  for (let i = 0; i < structure.length; i++) {
    const q = structure[i];
    const s = stats.perQuestion[i];
    lines.push(`\n【Q${i + 1}】${q.title}（${q.type === 'radio' ? '单选' : q.type === 'checkbox' ? '多选' : q.type === 'text' ? '填空' : q.type === 'rating' ? '评分' : q.type === 'dropdown' ? '下拉' : '日期'}${q.required ? '·必答' : ''}）`);
    if (q.type === 'radio' || q.type === 'dropdown' || q.type === 'checkbox') {
      const entries = Object.entries(s.counts).filter(([, n]) => n > 0);
      const top = entries.sort((a, b) => b[1] - a[1]).slice(0, 8);
      lines.push('  选择分布：' + top.map(([k, n]) => `${k === '__other__' ? '其他' : k} ${n}人(${Math.round(n * 100 / (s.answered || 1))}%)`).join('；'));
      if (s.otherTexts && s.otherTexts.length) lines.push('  其他补充：' + s.otherTexts.slice(0, 5).join(' / '));
    } else if (q.type === 'rating') {
      lines.push(`  平均分：${s.average} / ${q.maxRating || 5}（回答 ${s.answered} 人）`);
    } else if (q.type === 'date') {
      lines.push('  日期分布：' + Object.entries(s.counts).sort((a, b) => a[0] < b[0] ? -1 : 1).slice(0, 8).map(([k, n]) => `${k}:${n}人`).join(' '));
    } else {
      const samples = s.texts.slice(0, 12).map(t => t.length > 120 ? t.slice(0, 120) + '…' : t);
      lines.push('  典型回答：' + (samples.length ? samples.map(t => `“${t}”`).join('；') : '（无）'));
    }
  }
  return lines.join('\n');
}

export async function onRequestPost(ctx) {
  try {
    if (!hasKey(ctx.env)) {
      return error('服务器未配置 DEEPSEEK_API_KEY，无法使用 AI 分析', 400);
    }
    const body = await readBody(ctx.request);
    const surveyId = body && body.surveyId;
    if (!surveyId) return error('缺少 surveyId');

    const survey = await getSurvey(ctx.env, surveyId);
    if (!survey) return error('问卷不存在', 404);

    const responses = await listResponses(ctx.env, surveyId, SAMPLE_LIMIT);
    if (responses.length === 0) return error('还没有答卷，暂时无法分析');

    const stats = computeStats(survey.structure, responses);
    const dataText = buildDataText(survey.structure, responses, stats);

    const system = [
      '你是一名资深的数据分析与用户研究专家。请基于提供的问卷统计数据进行专业、客观、有洞察的分析。',
      '分析维度：核心发现、值得注意的信号/风险、可执行的改进建议。',
      '语言简洁专业，避免空洞套话；结论必须基于数据，不要编造数据中没有的信息。',
      '必须只输出一个 JSON 对象，不要输出任何其他文字。'
    ].join('\n');

    const user = [
      '问卷标题：' + survey.title,
      dataText,
      '请输出 JSON，结构如下：',
      '{',
      '  "overview": "总体概述（3-5 句话，概括整体情况与最重要的结论）",',
      '  "highlights": ["亮点/关键发现1", "亮点/关键发现2", ...（3-5 条）],',
      '  "risks": ["风险/需注意的信号1", ...（2-4 条，无则给空数组）],',
      '  "suggestions": ["可执行建议1", ...（3-5 条，具体可落地）]',
      '}'
    ].join('\n');

    const result = await chatJson(ctx.env, [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], { temperature: 0.4, maxTokens: 4096 });

    return json({
      ok: true,
      surveyId,
      sampled: responses.length,
      total: stats.total,
      analysis: {
        overview: String(result.overview || '').trim(),
        highlights: Array.isArray(result.highlights) ? result.highlights.map(String) : [],
        risks: Array.isArray(result.risks) ? result.risks.map(String) : [],
        suggestions: Array.isArray(result.suggestions) ? result.suggestions.map(String) : []
      }
    });
  } catch (e) {
    return error('AI 分析失败：' + e.message, 500);
  }
}
