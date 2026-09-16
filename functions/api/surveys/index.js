// GET  /api/surveys        —— 问卷列表（含答卷数）
// POST /api/surveys        —— 新建问卷
import { json, error, readBody } from '../../_lib/util.js';
import { listSurveys, createSurvey } from '../../_lib/db.js';

export async function onRequestGet(ctx) {
  try {
    const list = await listSurveys(ctx.env);
    return json({ ok: true, surveys: list });
  } catch (e) {
    return error('读取问卷列表失败：' + e.message, 500);
  }
}

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    if (!body || !body.title || !String(body.title).trim()) {
      return error('问卷标题不能为空');
    }
    const survey = await createSurvey(ctx.env, body);
    return json({ ok: true, survey }, 201);
  } catch (e) {
    return error('创建问卷失败：' + e.message, 500);
  }
}
