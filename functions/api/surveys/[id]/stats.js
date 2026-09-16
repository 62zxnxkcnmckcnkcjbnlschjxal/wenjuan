// GET /api/surveys/:id/stats —— 问卷统计（每题分布 + 文本答案）
import { json, error } from '../../../_lib/util.js';
import { getSurvey, listResponses } from '../../../_lib/db.js';
import { computeStats } from '../../../_lib/stats.js';

export async function onRequestGet(ctx) {
  try {
    const id = ctx.params && ctx.params.id;
    const survey = await getSurvey(ctx.env, id);
    if (!survey) return error('问卷不存在', 404);

    const responses = await listResponses(ctx.env, id, 5000);
    const stats = computeStats(survey.structure, responses);
    return json({
      ok: true,
      survey: { id: survey.id, title: survey.title, status: survey.status },
      stats
    });
  } catch (e) {
    return error('统计失败：' + e.message, 500);
  }
}
