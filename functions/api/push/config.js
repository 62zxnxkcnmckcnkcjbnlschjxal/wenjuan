// GET/POST /api/push/config — 读取/设置 Bark Key
import { json, error, readBody } from '../../_lib/util.js';

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_config (key TEXT PRIMARY KEY, value TEXT)`).run();
}

export async function onRequestGet(ctx) {
  try {
    await ensureTable(ctx.env);
    const row = await ctx.env.DB.prepare("SELECT value FROM push_config WHERE key='bark_key'").first();
    return json({ ok: true, barkKey: row ? row.value : '' });
  } catch (e) {
    return error('读取失败：' + e.message, 500);
  }
}

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    await ensureTable(ctx.env);
    await ctx.env.DB.prepare("INSERT OR REPLACE INTO push_config (key, value) VALUES ('bark_key', ?)")
      .bind(String(body.barkKey || '').trim()).run();
    return json({ ok: true });
  } catch (e) {
    return error('保存失败：' + e.message, 500);
  }
}
