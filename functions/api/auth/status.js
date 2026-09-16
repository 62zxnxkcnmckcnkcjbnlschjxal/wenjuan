// GET /api/auth/status —— 登录状态 + 是否已设置后台密码 + DeepSeek 密钥状态
import { json } from '../../_lib/util.js';
import { isAuthed, isPasswordSet } from '../../_lib/auth.js';
import { hasKey } from '../../_lib/deepseek.js';

export async function onRequestGet(ctx) {
  const authed = await isAuthed(ctx.env, ctx.request);
  return json({
    authed,
    passwordSet: isPasswordSet(ctx.env),
    deepseekConfigured: hasKey(ctx.env),
    openMode: !isPasswordSet(ctx.env)
  });
}
