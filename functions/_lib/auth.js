// 管理后台鉴权：HMAC 签名 Cookie（无状态，无需额外存储）
// 密码来自 CF 加密密文 ADMIN_PASSWORD；未设置时视为“开发模式”，后台完全开放。
import { json } from './util.js';

const COOKIE_NAME = 'qw_auth';
const COOKIE_TTL = 30 * 24 * 3600 * 1000; // 30 天

function getSecret(env) {
  const p = env && env.ADMIN_PASSWORD;
  return (p && typeof p === 'string' && p.trim()) ? p.trim() : '';
}

export function isPasswordSet(env) {
  return !!getSecret(env);
}

export async function hmac(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 签发 Cookie：payload = <expiresMs>.<random>
export async function signToken(env) {
  const secret = getSecret(env);
  const payload = Date.now() + COOKIE_TTL + '.' + Math.random().toString(36).slice(2, 10);
  const sig = await hmac(secret, payload);
  return payload + '.' + sig;
}

export async function verifyToken(env, token) {
  if (!token) return false;
  const secret = getSecret(env);
  if (!secret) return false;
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const payload = parts[0] + '.' + parts[1];
  const sig = parts[2];
  const expect = await hmac(secret, payload);
  if (sig !== expect) return false;
  const exp = Number(parts[0]);
  return !!(exp && exp > Date.now());
}

export function getCookie(req, name) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : '';
}

// 当前是否视为已授权（未设密码 = 开放模式）
export async function isAuthed(env, req) {
  if (!isPasswordSet(env)) return true;
  return verifyToken(env, getCookie(req, COOKIE_NAME));
}

export function authCookieHeader(token) {
  return 'qw_auth=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(COOKIE_TTL / 1000);
}

export function clearCookieHeader() {
  return 'qw_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

export { COOKIE_NAME };
