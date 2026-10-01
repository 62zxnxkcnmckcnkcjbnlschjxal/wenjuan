// POST /api/push/send — 通过 Bark 发送推送通知
import { json, error, readBody } from '../../_lib/util.js';

const BARK_KEY = 'BjuWCVgpVz24iCEm36LCTC';
const BARK_URL = 'https://api.day.app/' + BARK_KEY;

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    const title = (body && body.title) || '问卷新提交';
    const msgBody = (body && body.body) || '有人填写了你的问卷！';

    const res = await fetch(BARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        body: msgBody,
        group: '问卷工作台',
        url: 'https://wj.skyzyf335.top',
        icon: 'https://wj.skyzyf335.top/icons/icon-192.png'
      })
    });
    const data = await res.json().catch(() => ({}));
    return json({ ok: true, sent: res.ok ? 1 : 0, failed: res.ok ? 0 : 1, details: [res.status + ': ' + (data.message || '')] });
  } catch (e) {
    return error('发送失败：' + e.message, 500);
  }
}
