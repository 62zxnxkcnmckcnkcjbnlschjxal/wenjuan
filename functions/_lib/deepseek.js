// DeepSeek API 客户端（服务端调用，密钥只存在于 CF 加密密文 DEEPSEEK_API_KEY）
import { extractJson } from './util.js';

const BASE = 'https://api.deepseek.com';
const MODEL = 'deepseek-chat';

export function hasKey(env) {
  const k = env && env.DEEPSEEK_API_KEY;
  return !!(k && typeof k === 'string' && k.startsWith('sk-'));
}

export async function chat(env, messages, opts = {}) {
  const key = env.DEEPSEEK_API_KEY;
  if (!hasKey(env)) {
    throw new Error('服务器未配置 DEEPSEEK_API_KEY，请先在 Cloudflare 设置加密密文');
  }
  const body = {
    model: MODEL,
    messages,
    temperature: opts.temperature != null ? opts.temperature : 0.7,
    max_tokens: opts.maxTokens || 4096,
    stream: false
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && (data.error && (data.error.message || JSON.stringify(data.error)))) || ('HTTP ' + res.status);
    throw new Error('DeepSeek 调用失败：' + msg);
  }
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return content || '';
}

// 调用并解析为 JSON 对象（自动剥离 ```json 围栏等）
export async function chatJson(env, messages, opts = {}) {
  const text = await chat(env, messages, { ...opts, json: true });
  const obj = extractJson(text);
  if (obj === null) throw new Error('AI 返回内容无法解析为 JSON');
  return obj;
}

// 验证密钥有效性（balance 接口轻量快速）
export async function verifyKey(env) {
  const key = env.DEEPSEEK_API_KEY;
  if (!hasKey(env)) return { ok: false, error: '未配置 DEEPSEEK_API_KEY' };
  try {
    const res = await fetch(BASE + '/user/balance', {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data.error && data.error.message) || ('HTTP ' + res.status) };
    const info = data && data.balance_infos && data.balance_infos[0];
    return {
      ok: true,
      currency: info ? info.currency : 'CNY',
      total: info ? info.total_balance : '未知',
      granted: info ? info.granted_balance : '未知',
      topped: info ? info.topped_up_balance : '未知'
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
