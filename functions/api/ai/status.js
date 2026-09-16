// GET /api/ai/status —— DeepSeek 密钥配置状态（绝不回传密钥本身）
import { json } from '../../_lib/util.js';
import { hasKey, verifyKey } from '../../_lib/deepseek.js';

export async function onRequestGet(ctx) {
  const configured = hasKey(ctx.env);
  let balance = null;
  if (configured) {
    balance = await verifyKey(ctx.env).catch(() => null);
  }
  return json({ ok: true, configured, balance });
}
