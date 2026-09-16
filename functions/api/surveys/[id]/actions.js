// POST /api/surveys/:id/actions  { action: 'publish' | 'close' | 'duplicate' }
import { json, error, readBody } from '../../../_lib/util.js';
import { getSurvey, updateSurvey, duplicateSurvey } from '../../../_lib/db.js';

export async function onRequestPost(ctx) {
  try {
    const id = ctx.params && ctx.params.id;
    const body = await readBody(ctx.request);
    const action = body && body.action;
    const survey = await getSurvey(ctx.env, id);
    if (!survey) return error('问卷不存在', 404);

    if (action === 'publish') {
      if (survey.structure.length === 0) return error('问卷还没有题目，请先添加题目再发布');
      const updated = await updateSurvey(ctx.env, id, { ...survey, status: 'published' });
      return json({ ok: true, survey: updated });
    }
    if (action === 'close') {
      const updated = await updateSurvey(ctx.env, id, { ...survey, status: 'closed' });
      return json({ ok: true, survey: updated });
    }
    if (action === 'duplicate') {
      const copy = await duplicateSurvey(ctx.env, id);
      return json({ ok: true, survey: copy }, 201);
    }
    return error('不支持的 action：' + action);
  } catch (e) {
    return error('操作失败：' + e.message, 500);
  }
}
