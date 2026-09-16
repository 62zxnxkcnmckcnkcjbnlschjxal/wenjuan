/* ============================================================
   问卷工作台 · 本地开发/测试服务器
   - 用 Node 内置 SQLite 实现 D1 适配层，加载 functions/ 下真实的
     Pages Functions 路由代码（同一套代码，双重验证）
   - DeepSeek 走本地模拟（开发环境无需真实密钥）
   - 用法：npm run dev  →  http://localhost:8787
   - 可选：ADMIN_PASSWORD=test npm run dev 测试后台锁屏
   ============================================================ */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const FUNC_DIR = path.join(__dirname, 'functions');
const PORT = process.env.PORT || 8787;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/* ---------- D1 适配层（node:sqlite 内存库） ---------- */
class D1Adapter {
  constructor() {
    this.db = new DatabaseSync(':memory:');
  }
  prepare(sql) {
    const getStmt = () => {
      try { return this.db.prepare(sql); }
      catch (e) { throw new Error('SQL 错误 [' + sql.slice(0, 80) + ']：' + e.message); }
    };
    return {
      bind: (...args) => ({
        run: () => { const r = getStmt().run(...args); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
        all: () => ({ results: getStmt().all(...args) }),
        first: () => getStmt().get(...args) || null
      }),
      run: () => { const r = getStmt().run(); return { meta: { changes: r.changes } }; },
      all: () => ({ results: getStmt().all() }),
      first: () => getStmt().get() || null
    };
  }
  async batch(statements) {
    return statements.map(s => (s.run ? s.run() : s));
  }
}

/* ---------- DeepSeek 本地模拟（拦截 fetch 到 api.deepseek.com） ---------- */const mockSurvey = {
  title: '《光遇》游戏玩法体验调查问卷',
  description: '感谢你参与本次问卷！本问卷旨在了解《光遇》玩家的游戏习惯、玩法偏好与付费意愿，预计用时 3 分钟。',
  questions: [
    { type: 'radio', title: '你的游戏龄有多久？', required: true, options: ['1 个月以内', '1-6 个月', '6 个月 - 1 年', '1 年以上'], allowOther: false },
    { type: 'radio', title: '你平均每周玩《光遇》多长时间？', required: true, options: ['不足 3 小时', '3-7 小时', '7-14 小时', '14 小时以上'] },
    { type: 'checkbox', title: '你主要参与哪些玩法？', required: true, options: ['跑图收集烛火', '每日任务', '季节活动', '社交互动（好友/留言）', '装扮搭配', '演奏乐器'], allowOther: true },
    { type: 'rating', title: '你对当前玩法的整体满意度', required: true, maxRating: 5 },
    { type: 'dropdown', title: '你最喜欢哪个季节玩法？', required: false, options: ['表演季', '潜海季', '欧若拉季', '追忆季', '筑巢季', '没特别喜欢的'], allowOther: true },
    { type: 'radio', title: '你在游戏内的付费情况', required: true, options: ['纯零氪', '偶尔小额付费', '经常购买季卡', '礼包/蜡烛全都要'] },
    { type: 'checkbox', title: '哪些因素会影响你的付费意愿？', required: false, options: ['价格合理', '外观好看', '玩法相关', '限时限量', '朋友都在买'], allowOther: true },
    { type: 'text', title: '你对《光遇》玩法还有什么建议或吐槽？', required: false, placeholder: '欢迎畅所欲言…' }
  ]
};
const mockAnalysis = {
  overview: '样本整体呈现"轻度高频"的特征：多数玩家每周游玩 3-7 小时，以跑图、每日任务和社交互动为主；对玩法满意度中等偏上（平均 3.9/5），付费以零氪和季卡为主，价格与外观是付费决策的关键因素。',
  highlights: ['社交互动与装扮搭配是最受欢迎的两类玩法', '季节玩法中"表演季"提及率最高，玩家看重氛围与情感体验', '满意度平均 3.9/5，核心玩家对内容更新的期待度高'],
  risks: ['约 32% 的玩家为纯零氪，付费转化主要依赖季卡，收入结构单一', '部分玩家反映新玩法对老玩家缺乏长期目标，存在流失风险'],
  suggestions: ['强化社交系统的长期互动设计，如家园/共居玩法', '推出价格梯度更友好的季卡与小额礼包组合', '定期举办玩家共创活动，收集玩法反馈']
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.deepseek.com/user/balance')) {
    return new Response(JSON.stringify({ balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '12.34', topped_up_balance: '0.00' }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  }
  if (u.includes('api.deepseek.com')) {
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    const last = body.messages && body.messages[body.messages.length - 1];
    const isAnalyze = last && (last.content || '').includes('问卷统计') || (last && (last.content || '').includes('overview'));
    const payload = isAnalyze
      ? { overview: mockAnalysis.overview, highlights: mockAnalysis.highlights, risks: mockAnalysis.risks, suggestions: mockAnalysis.suggestions }
      : { title: mockSurvey.title, description: mockSurvey.description, questions: mockSurvey.questions };
    const content = '```json\n' + JSON.stringify(payload) + '\n```';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return originalFetch(url, opts);
};

/* ---------- 静态资源 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (/^\/s\//.test(pathname)) rel = '/fill.html'; // 模拟 _redirects
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

/* ---------- API 路由（加载真实 Pages Functions 代码） ---------- */
async function loadRoute(relPath) {
  return import(path.join(FUNC_DIR, relPath) + '?t=' + Date.now());
}

async function routeApi(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;
  const body = method === 'POST' || method === 'PUT'
    ? await new Promise((resolve) => {
        let d = '';
        req.on('data', c => d += c);
        req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { resolve({}); } });
      })
    : null;
  const mkRequest = () => new Request('http://localhost' + pathname + url.search, {
    method, headers: { 'content-type': 'application/json', cookie: req.headers.cookie || '' },
    body: body !== null ? JSON.stringify(body) : undefined
  });
  // 共享同一个内存数据库（对应生产环境的同一个 D1 库）
  const env = { DB: sharedDB, DEEPSEEK_API_KEY: 'sk-mock-key-for-local-dev', ADMIN_PASSWORD };
  const next = async () => {
    // 中间件放行后继续执行（实际由路由表处理）
    return null;
  };

  // 中间件
  const middleware = await loadRoute('_middleware.js');
  const mwRes = await middleware.onRequest({ request: mkRequest(), env, next, params: {} });
  if (mwRes && mwRes.status !== 200) {
    res.writeHead(mwRes.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(await mwRes.text());
    return;
  }

  // 路由表：与 functions/api 目录一一对应
  const idMatch = pathname.match(/^\/api\/surveys\/([\w-]+)(?:\/([\w-]+))?$/);
  const aiMatch = pathname.match(/^\/api\/ai\/([\w-]+)$/);
  const authMatch = pathname.match(/^\/api\/auth\/([\w-]+)$/);
  let mod = null, handler = null, params = {};

  try {
    if (pathname === '/api/surveys' && method === 'GET') { mod = await loadRoute('api/surveys/index.js'); handler = mod.onRequestGet; }
    else if (pathname === '/api/surveys' && method === 'POST') { mod = await loadRoute('api/surveys/index.js'); handler = mod.onRequestPost; }
    else if (idMatch && !idMatch[2] && method === 'GET') { mod = await loadRoute('api/surveys/[id].js'); handler = mod.onRequestGet; params = { id: idMatch[1] }; }
    else if (idMatch && !idMatch[2] && method === 'PUT') { mod = await loadRoute('api/surveys/[id].js'); handler = mod.onRequestPut; params = { id: idMatch[1] }; }
    else if (idMatch && !idMatch[2] && method === 'DELETE') { mod = await loadRoute('api/surveys/[id].js'); handler = mod.onRequestDelete; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'actions' && method === 'POST') { mod = await loadRoute('api/surveys/[id]/actions.js'); handler = mod.onRequestPost; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'public' && method === 'GET') { mod = await loadRoute('api/surveys/[id]/public.js'); handler = mod.onRequestGet; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'submit' && method === 'POST') { mod = await loadRoute('api/surveys/[id]/submit.js'); handler = mod.onRequestPost; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'responses' && method === 'GET') { mod = await loadRoute('api/surveys/[id]/responses.js'); handler = mod.onRequestGet; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'responses' && method === 'DELETE') { mod = await loadRoute('api/surveys/[id]/responses.js'); handler = mod.onRequestDelete; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'export' && method === 'GET') { mod = await loadRoute('api/surveys/[id]/export.js'); handler = mod.onRequestGet; params = { id: idMatch[1] }; }
    else if (idMatch && idMatch[2] === 'stats' && method === 'GET') { mod = await loadRoute('api/surveys/[id]/stats.js'); handler = mod.onRequestGet; params = { id: idMatch[1] }; }
    else if (aiMatch && aiMatch[1] === 'status' && method === 'GET') { mod = await loadRoute('api/ai/status.js'); handler = mod.onRequestGet; }
    else if (aiMatch && aiMatch[1] === 'generate' && method === 'POST') { mod = await loadRoute('api/ai/generate.js'); handler = mod.onRequestPost; }
    else if (aiMatch && aiMatch[1] === 'analyze' && method === 'POST') { mod = await loadRoute('api/ai/analyze.js'); handler = mod.onRequestPost; }
    else if (authMatch && authMatch[1] === 'login' && method === 'POST') { mod = await loadRoute('api/auth/login.js'); handler = mod.onRequestPost; }
    else if (authMatch && authMatch[1] === 'logout' && method === 'POST') { mod = await loadRoute('api/auth/logout.js'); handler = mod.onRequestPost; }
    else if (authMatch && authMatch[1] === 'status' && method === 'GET') { mod = await loadRoute('api/auth/status.js'); handler = mod.onRequestGet; }

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '接口不存在' }));
      return;
    }
    const r = await handler({ request: mkRequest(), env, params, next });
    const cookies = r.headers.get('set-cookie');
    res.writeHead(r.status, {
      'Content-Type': r.headers.get('Content-Type') || 'application/json; charset=utf-8',
      ...(cookies ? { 'Set-Cookie': cookies } : {}),
      'Content-Disposition': r.headers.get('Content-Disposition') || ''
    });
    res.end(await r.text());
  } catch (e) {
    console.error('API 错误：', e);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '服务器错误：' + e.message }));
  }
}

/* ---------- 服务器 ---------- */
const sharedDB = new D1Adapter();
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  try {
    if (pathname.startsWith('/api/')) {
      await routeApi(req, res, pathname);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end('server error'); }
  }
});

server.listen(PORT, () => {
  console.log('问卷工作台本地服务已启动：http://localhost:' + PORT);
  console.log('管理后台：http://localhost:' + PORT + '/  （填答页示例：/s/<问卷ID>）');
  console.log(ADMIN_PASSWORD ? '（已启用管理密码模式）' : '（开放模式，未设管理密码）');
});
