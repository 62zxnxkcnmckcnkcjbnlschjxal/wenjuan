// GET/POST/DELETE /api/push/devices — 管理 Bark 密钥（支持多个，带备注）
import { json, error, readBody } from '../../_lib/util.js';

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bark_key TEXT NOT NULL,
    remark TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
}

export async function onRequestGet(ctx) {
  try {
    await ensureTable(ctx.env);
    const { results } = await ctx.env.DB.prepare('SELECT id, bark_key, remark, created_at FROM push_devices ORDER BY id DESC').all();
    // 密钥打码显示
    const devices = (results || []).map(d => ({
      id: d.id,
      remark: d.remark || '未命名',
      barkKey: d.bark_key.slice(0, 4) + '••••••••' + d.bark_key.slice(-4),
      createdAt: d.created_at
    }));
    return json({ ok: true, devices });
  } catch (e) {
    return error('读取失败：' + e.message, 500);
  }
}

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    await ensureTable(ctx.env);
    await ctx.env.DB.prepare('INSERT INTO push_devices (bark_key, remark) VALUES (?, ?)')
      .bind(String(body.barkKey || '').trim(), String(body.remark || '').trim()).run();
    return json({ ok: true });
  } catch (e) {
    return error('保存失败：' + e.message, 500);
  }
}

export async function onRequestDelete(ctx) {
  try {
    const url = new URL(ctx.request.url);
    const id = url.searchParams.get('id');
    if (!id) return error('缺少 id');
    await ensureTable(ctx.env);
    await ctx.env.DB.prepare('DELETE FROM push_devices WHERE id = ?').bind(Number(id)).run();
    return json({ ok: true });
  } catch (e) {
    return error('删除失败：' + e.message, 500);
  }
}
