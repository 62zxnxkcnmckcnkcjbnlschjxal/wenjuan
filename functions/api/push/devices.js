// GET /api/push/devices — 列出所有已订阅设备
import { json, error } from '../../_lib/util.js';

export async function onRequestGet(ctx) {
  try {
    await ctx.env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, created_at INTEGER NOT NULL
    )`).run();
    const { results } = await ctx.env.DB.prepare('SELECT endpoint, sub, created_at FROM push_subs ORDER BY created_at DESC').all();
    const devices = (results || []).map(r => {
      try {
        const sub = JSON.parse(r.sub);
        return {
          endpoint: r.endpoint,
          created_at: r.created_at,
          endpoint_domain: (sub.endpoint || '').replace('https://', '').split('/')[0]
        };
      } catch (e) {
        return { endpoint: r.endpoint, created_at: r.created_at, endpoint_domain: 'unknown' };
      }
    });
    return json({ ok: true, devices: devices });
  } catch (e) {
    return error('查询失败：' + e.message, 500);
  }
}

// DELETE /api/push/devices — 删除设备 (body: { endpoint })
export async function onRequestDelete(ctx) {
  try {
    const body = await ctx.request.json().catch(() => ({}));
    if (!body.endpoint) return error('缺少 endpoint');
    await ctx.env.DB.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(body.endpoint).run();
    return json({ ok: true });
  } catch (e) {
    return error('删除失败：' + e.message, 500);
  }
}
