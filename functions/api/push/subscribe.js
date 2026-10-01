// POST /api/push/subscribe — 保存浏览器推送订阅信息到 D1
import { json, error, readBody } from '../../_lib/util.js';

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    sub TEXT NOT NULL,
    device TEXT DEFAULT '',
    created_at INTEGER NOT NULL
  )`).run();
  try {
    await env.DB.prepare('ALTER TABLE push_subs ADD COLUMN device TEXT DEFAULT ""').run();
  } catch (e) {}
}

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    if (!body || !body.subscription) return error('缺少 subscription');
    const sub = body.subscription;
    const device = String(body.device || '').slice(0, 100);
    await ensureTable(ctx.env);
    await ctx.env.DB.prepare(
      'INSERT OR REPLACE INTO push_subs (endpoint, sub, device, created_at) VALUES (?, ?, ?, ?)'
    ).bind(sub.endpoint, JSON.stringify(sub), device, Date.now()).run();
    return json({ ok: true });
  } catch (e) {
    return error('订阅失败：' + e.message, 500);
  }
}
