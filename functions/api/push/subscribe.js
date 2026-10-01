// POST /api/push/subscribe —— 保存浏览器推送订阅信息到 D1
// Body: { subscription: PushSubscription对象 }
import { json, error, readBody } from '../../_lib/util.js';

async function ensurePushTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    sub TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`).run();
}

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    if (!body || !body.subscription) return error('缺少 subscription');
    const sub = body.subscription;
    await ensurePushTable(ctx.env);
    await ctx.env.DB.prepare(
      'INSERT OR REPLACE INTO push_subs (endpoint, sub, created_at) VALUES (?, ?, ?)'
    ).bind(sub.endpoint, JSON.stringify(sub), Date.now()).run();
    return json({ ok: true });
  } catch (e) {
    return error('订阅失败：' + e.message, 500);
  }
}
