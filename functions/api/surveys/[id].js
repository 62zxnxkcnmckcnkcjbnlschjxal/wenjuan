// GET    /api/surveys/:id     —— 问卷详情
// PUT    /api/surveys/:id     —— 保存问卷（标题/描述/题目/设置/状态）
// DELETE /api/surveys/:id     —— 删除问卷（连同答卷）
import { json, error, readBody } from '../../_lib/util.js';
import { getSurvey, updateSurvey, deleteSurvey, countResponses } from '../../_lib/db.js';

function parseId(ctx) {
  return ctx.params && ctx.params.id;
}

export async function onRequestGet(ctx) {
  try {
    const survey = await getSurvey(ctx.env, parseId(ctx));
    if (!survey) return error('问卷不存在', 404);
    survey.responseCount = await countResponses(ctx.env, survey.id);
    return json({ ok: true, survey });
  } catch (e) {
    return error('读取问卷失败：' + e.message, 500);
  }
}

export async function onRequestPut(ctx) {
  try {
    const body = await readBody(ctx.request);
    if (!body) return error('请求体为空');
    const survey = await updateSurvey(ctx.env, parseId(ctx), body);
    if (!survey) return error('问卷不存在', 404);
    return json({ ok: true, survey });
  } catch (e) {
    return error('保存问卷失败：' + e.message, 500);
  }
}

export async function onRequestDelete(ctx) {
  try {
    await deleteSurvey(ctx.env, parseId(ctx));
    return json({ ok: true });
  } catch (e) {
    return error('删除问卷失败：' + e.message, 500);
  }
}
