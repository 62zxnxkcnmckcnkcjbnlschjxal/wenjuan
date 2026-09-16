// 通用工具：JSON 响应 / ID 生成 / 安全解析 / CORS
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
      ...extraHeaders
    }
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

export function options() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// 生成短 ID（约 8 位，url-safe，含时间戳避免碰撞）
export function genId(prefix = '') {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < rand.length; i++) s += rand[i].toString(36).padStart(2, '0');
  const ts = Date.now().toString(36);
  return prefix + ts.slice(-4) + s.slice(0, 6);
}

export function safeJsonParse(str, fallback) {
  if (str === null || str === undefined) return fallback;
  try {
    const v = JSON.parse(str);
    return v === null || v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

export async function readBody(req) {
  try {
    return await req.json();
  } catch (e) {
    return null;
  }
}

// 从 JSON 结构里稳健提取对象/数组（兼容 AI 输出 ```json 包裹等情况）
export function extractJson(text) {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const arrStart = t.indexOf('[');
  let begin = -1;
  if (start === -1) begin = arrStart;
  else if (arrStart === -1) begin = start;
  else begin = Math.min(start, arrStart);
  if (begin === -1) return null;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = begin; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) return null;
  try {
    return JSON.parse(t.slice(begin, end));
  } catch (e) {
    return null;
  }
}
