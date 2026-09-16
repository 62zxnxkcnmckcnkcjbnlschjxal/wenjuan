// Cloudflare Pages 全站中间件：管理接口鉴权 + 公开填答接口放行
//  - 静态资源：始终放行
//  - /api/auth/*：始终放行（登录本身必须可访问）
//  - /api/surveys/:id/public 与 /api/surveys/:id/submit：公开（填答页无需登录）
//  - 其余 /api/surveys* 与 /api/ai*：需要管理后台会话（ADMIN_PASSWORD 密文 + HMAC Cookie）
//  - 未设置 ADMIN_PASSWORD 时视为开发模式，管理接口直接放行
import { isAuthed } from './_lib/auth.js';

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const path = url.pathname;

  if (ctx.request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const isApi = path.startsWith('/api/');
  if (!isApi) return ctx.next();

  // 登录/登出/状态接口放行
  if (path === '/api/auth' || path.startsWith('/api/auth/')) return ctx.next();

  // 公开填答接口放行
  if (/^\/api\/surveys\/[^/]+\/(public|submit)$/.test(path)) return ctx.next();

  // 其余 API 需要鉴权
  if (await isAuthed(ctx.env, ctx.request)) return ctx.next();

  return new Response(JSON.stringify({ error: '未登录或会话已过期，请先访问管理后台登录' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
