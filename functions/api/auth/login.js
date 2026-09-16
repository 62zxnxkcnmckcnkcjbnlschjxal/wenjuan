// POST /api/auth/login  { password }
import { json, error, readBody } from '../../_lib/util.js';
import { isPasswordSet, signToken, authCookieHeader } from '../../_lib/auth.js';

export async function onRequestPost(ctx) {
  const body = await readBody(ctx.request);
  const pwd = body && body.password;
  if (!isPasswordSet(ctx.env)) {
    return json({ ok: true, open: true, message: '未设置 ADMIN_PASSWORD，当前为开放模式' });
  }
  if (!pwd || pwd !== ctx.env.ADMIN_PASSWORD) {
    return error('密码错误', 401);
  }
  const token = await signToken(ctx.env);
  return json({ ok: true }, 200, { 'Set-Cookie': authCookieHeader(token) });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}
