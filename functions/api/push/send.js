// POST /api/push/send — 通过 Bark 发送推送通知（遍历所有已存密钥）
import { json, error, readBody } from '../../_lib/util.js';

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    const title = (body && body.title) || '问卷新提交';
    const msgBody = (body && body.body) || '有人填写了你的问卷！';

    // 读所有 Bark 密钥
    await ctx.env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bark_key TEXT NOT NULL,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    const { results } = await ctx.env.DB.prepare('SELECT bark_key FROM push_devices').all();
    const keys = (results || []).map(r => r.bark_key).filter(Boolean);

    if (!keys.length) return json({ ok: false, error: '未配置 Bark Key' });

    let okCount = 0, failCount = 0;
    for (const key of keys) {
      try {
        const res = await fetch('https://api.day.app/' + key, {
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
        if (res.ok) okCount++; else failCount++;
      } catch (e) { failCount++; }
    }

    return json({ ok: true, sent: okCount, failed: failCount });
  } catch (e) {
    return error('发送失败：' + e.message, 500);
  }
}
