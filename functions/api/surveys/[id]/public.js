// GET /api/surveys/:id/public —— 公开填答页数据（无需登录）
// 仅返回：标题、描述、截止时间、题目结构、可公开的设置；不含任何答卷数据。
import { json, error } from '../../../_lib/util.js';
import { getSurvey, countResponses } from '../../../_lib/db.js';

export async function onRequestGet(ctx) {
  try {
    const survey = await getSurvey(ctx.env, ctx.params && ctx.params.id);
    if (!survey) return error('问卷不存在或已删除', 404);
    if (survey.status !== 'published') {
      return error('该问卷未发布或已结束，暂时无法填写', 403);
    }
    if (survey.endAt && Date.now() > survey.endAt) {
      return error('该问卷已截止，感谢参与', 403);
    }
    const count = await countResponses(ctx.env, survey.id);
    return json({
      ok: true,
      survey: {
        id: survey.id,
        title: survey.title,
        description: survey.description,
        endAt: survey.endAt,
        structure: survey.structure,
        settings: {
          submitTip: (survey.settings && survey.settings.submitTip) || '提交成功，感谢参与！'
        }
      },
      responseCount: count
    });
  } catch (e) {
    return error('读取问卷失败：' + e.message, 500);
  }
}
