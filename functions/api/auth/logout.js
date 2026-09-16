// POST /api/auth/logout —— 清除会话 Cookie
import { json } from '../../_lib/util.js';
import { clearCookieHeader } from '../../_lib/auth.js';

export async function onRequestPost() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader() });
}
