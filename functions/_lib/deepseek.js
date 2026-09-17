// DeepSeek API 客户端（服务端调用，密钥只存在于 CF 加密密文）
// 支持双供应商：官方 api.deepseek.com（DEEPSEEK_API_KEY）+ 腾讯云 TokenHub（TENCENT_API_KEY）
// 自动回退：官方 key 未配置时使用腾讯云 deepseek-v4-flash
import { extractJson } from './util.js';

const OFFICIAL = { base: 'https://api.deepseek.com', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-chat' };
const TENCENT = { base: 'https://tokenhub.tencentmaas.com', envKey: 'TENCENT_API_KEY', model: 'deepseek-v4-flash' };

// TokenHub API 模型名规范化（控制台服务ID deepseek/deepseek-flash → API deepseek-v4-flash，否则 400）
const TENCENT_MODEL_ALIAS = {
  'deepseek/deepseek-flash': 'deepseek-v4-flash',
  'deepseek-flash': 'deepseek-v4-flash'
};
function normalizeModel(provider, model) {
  if (provider !== 'tencent') return model;
  return TENCENT_MODEL_ALIAS[model] || model;
}

function getKey(env, p) {
  const v = env && env[p.envKey];
  return (v && typeof v === 'string' && v.trim()) ? v.trim() : '';
}

export function hasKey(env) {
  return !!(getKey(env, OFFICIAL) || getKey(env, TENCENT));
}

// 选择供应商：显式 provider，或官方优先（自动）
function pickProvider(env, provider) {
  if (provider === 'tencent') return getKey(env, TENCENT) ? TENCENT : null;
  if (provider === 'deepseek') return getKey(env, OFFICIAL) ? OFFICIAL : null;
  return getKey(env, OFFICIAL) ? OFFICIAL : (getKey(env, TENCENT) ? TENCENT : null);
}

export async function chat(env, messages, opts = {}) {
  const p = pickProvider(env, opts.provider);
  if (!p) {
    throw new Error('服务器未配置 API 密钥，请先在 Cloudflare 设置加密密文（DEEPSEEK_API_KEY 或 TENCENT_API_KEY）');
  }
  const body = {
    model: normalizeModel(p === TENCENT ? 'tencent' : 'deepseek', opts.model || p.model),
    messages,
    temperature: opts.temperature != null ? opts.temperature : 0.7,
    max_tokens: opts.maxTokens || 4096,
    stream: false
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  const res = await fetch(p.base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getKey(env, p)
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

// 验证密钥有效性（官方走 balance，腾讯走 /v1/models）
export async function verifyKey(env) {
  const p = pickProvider(env, 'deepseek') || pickProvider(env, 'tencent');
  if (!p) return { ok: false, error: '未配置任何 API 密钥' };
  const path = p === OFFICIAL ? '/user/balance' : '/v1/models';
  try {
    const res = await fetch(p.base + path, {
      headers: { 'Authorization': 'Bearer ' + getKey(env, p), 'Accept': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data.error && data.error.message) || ('HTTP ' + res.status) };
    if (p === TENCENT) return { ok: true, models: (data.data || []).length };
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
