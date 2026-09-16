// GET /api/surveys/:id/responses   —— 答卷列表
// DELETE /api/surveys/:id/responses?id=xxx —— 删除单份答卷
import { json, error } from '../../../_lib/util.js';
import { listResponses, deleteResponse, getSurvey } from '../../../_lib/db.js';

export async function onRequestGet(ctx) {
  try {
    const id = ctx.params && ctx.params.id;
    const survey = await getSurvey(ctx.env, id);
    if (!survey) return error('问卷不存在', 404);
    const limit = Math.min(Number(new URL(ctx.request.url).searchParams.get('limit') || 500), 2000);
    const responses = await listResponses(ctx.env, id, limit);
    return json({ ok: true, surveyId: id, questions: survey.structure, responses });
  } catch (e) {
    return error('读取答卷失败：' + e.message, 500);
  }
}

export async function onRequestDelete(ctx) {
  try {
    const rid = new URL(ctx.request.url).searchParams.get('id');
    if (!rid) return error('缺少答卷 id 参数');
    await deleteResponse(ctx.env, rid);
    return json({ ok: true });
  } catch (e) {
    return error('删除答卷失败：' + e.message, 500);
  }
}
