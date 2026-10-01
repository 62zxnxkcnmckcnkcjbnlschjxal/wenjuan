// POST /api/surveys/:id/submit —— 提交答卷（公开，无需登录）
import { json, error, readBody } from '../../../_lib/util.js';
import { getSurvey, addResponse } from '../../../_lib/db.js';

export async function onRequestPost(ctx) {
  try {
    const survey = await getSurvey(ctx.env, ctx.params && ctx.params.id);
    if (!survey) return error('问卷不存在或已删除', 404);
    if (survey.status !== 'published') return error('该问卷未发布或已结束', 403);
    if (survey.endAt && Date.now() > survey.endAt) return error('该问卷已截止', 403);

    const body = await readBody(ctx.request);
    if (!body || typeof body.answers !== 'object' || body.answers === null) {
      return error('提交数据格式错误');
    }

    // 服务端校验：必填项、选项合法性
    const answers = body.answers;
    const errors = [];
    for (const q of survey.structure) {
      const val = answers[q.id];
      const empty = val === undefined || val === null || val === '' ||
        (Array.isArray(val) && val.length === 0);
      if (q.required && empty) errors.push('请回答必填题：' + q.title);
      if (empty) continue;
      if (q.type === 'radio' || q.type === 'dropdown') {
        if (typeof val !== 'string') errors.push('题目「' + q.title + '」答案格式错误');
      }
      if (q.type === 'checkbox') {
        if (!Array.isArray(val) || val.length === 0) errors.push('请选择「' + q.title + '」');
      }
    }
    if (errors.length) return error(errors[0], 400);

    // ===== 采集访问追踪信息（IP / UA / 地点）=====
    const h = ctx.request.headers;
    const ip = h.get('cf-connecting-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim() || '';
    const ua = h.get('user-agent') || '';
    // Cloudflare 地理位置信息在 request.cf 对象上（不在 headers）
    const cf = ctx.request.cf || {};
    const country = cf.country || h.get('cf-ipcountry') || '';
    const region = cf.region || '';   // 省/州
    const city = cf.city || '';       // 城市
    // 中国显示为"河南省 郑州市"，国外显示城市+国家
    let location;
    if (country === 'CN' || country === 'TWN' || country === 'HKG' || country === 'MAC') {
      location = [region, city].filter(Boolean).join(' ');
    } else {
      location = [city, region, country].filter(Boolean).join(' ');
    }
    if (!location) location = country || '未知';

    await addResponse(ctx.env, survey.id, answers, { ip, ua, location });
    const tip = (survey.settings && survey.settings.submitTip) || '提交成功，感谢参与！';

    // 触发 Web Push 通知（异步，不阻塞响应）
    ctx.waitUntil((async () => {
      try {
        await fetch(new URL('/api/push/send', ctx.request.url).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '新答卷提交',
            body: '问卷「' + survey.title + '」收到一份新提交（' + location + '）',
            url: '/#/results/' + survey.id
          })
        });
      } catch (e) {}
    })());

    return json({ ok: true, message: tip });
  } catch (e) {
    return error('提交失败：' + e.message, 500);
  }
}
