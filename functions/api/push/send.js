// POST /api/push/send —— 发送推送通知给所有已订阅用户
// Body: { title, body, url }
// 从 PUSH_KV 读所有订阅，逐个发送
import { json, error, readBody } from '../../_lib/util.js';

const VAPID_PUBLIC = 'BP00uHKqQ_AN9U07z2bDAjdXoW7q9NruGAYkPGY0z7aMC2A6oGiBKi11P_qTzrzoL657yeNR9IeWH0qFa4OkJes';
const VAPID_PRIVATE = '1xBkJVu1Owl60yrCwpBF16WvJsTSGouDvOp47EsrBCI';
const VAPID_SUBJECT = 'mailto:admin@skyzyf335.top';

function urlBase64ToBuf(b64) {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function bufToUrlBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 导入 VAPID 私钥用于 ES256 签名（JWK 格式，需要 d + x + y）
async function importVapidPrivateKey() {
  // 从公钥 raw（65字节: 0x04 + X(32) + Y(32)）提取 x 和 y
  const pubRaw = urlBase64ToBuf(VAPID_PUBLIC);
  const x = bufToUrlBase64(pubRaw.slice(1, 33));
  const y = bufToUrlBase64(pubRaw.slice(33, 65));
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: VAPID_PRIVATE,
    x: x,
    y: y,
    use: 'sig',
    alg: 'ES256'
  };
  return crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
}

// 创建 VAPID JWT
async function createVapidJwt(audience) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud: audience, exp: now + 12 * 3600, sub: VAPID_SUBJECT };
  const enc = new TextEncoder();
  const headerB64 = bufToUrlBase64(enc.encode(JSON.stringify(header)));
  const payloadB64 = bufToUrlBase64(enc.encode(JSON.stringify(payload)));
  const signingInput = enc.encode(headerB64 + '.' + payloadB64);
  const key = await importVapidPrivateKey();
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput);
  // CF Workers 返回 raw 格式（r||s 各32字节，共64字节），直接用
  // 标准 Web Crypto 返回 DER 格式，需要解析转换
  let rawSig;
  const sigBytes = new Uint8Array(sig);
  if (sigBytes.length === 64) {
    // 已经是 raw 格式
    rawSig = sigBytes;
  } else {
    // DER 格式：0x30 len | 0x02 rlen rvalue | 0x02 slen svalue
    let offset = 2;
    const rLen = sigBytes[offset + 1];
    let rStart = offset + 2;
    let r = sigBytes.slice(rStart, rStart + rLen);
    if (r.length > 32) r = r.slice(1);
    if (r.length < 32) { const pad = new Uint8Array(32 - r.length); r = new Uint8Array([...pad, ...r]); }
    offset = rStart + rLen;
    const sLen = sigBytes[offset + 1];
    let sStart = offset + 2;
    let s = sigBytes.slice(sStart, sStart + sLen);
    if (s.length > 32) s = s.slice(1);
    if (s.length < 32) { const pad = new Uint8Array(32 - s.length); s = new Uint8Array([...pad, ...s]); }
    rawSig = new Uint8Array([...r, ...s]);
  }
  return headerB64 + '.' + payloadB64 + '.' + bufToUrlBase64(rawSig);
}

// 加密 payload (aes128gcm, RFC 8291)
async function encryptPayload(sub, plaintext) {
  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(plaintext);

  // 服务端临时密钥对
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey));

  // 用户公钥 (p256dh) 和 auth secret
  const userPub = urlBase64ToBuf(sub.keys.p256dh);
  const authSecret = urlBase64ToBuf(sub.keys.auth);

  const userPubKey = await crypto.subtle.importKey(
    'raw', userPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const ecdhBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: userPubKey }, serverKeyPair.privateKey, 256
  ));

  // HKDF 派生 content encryption key
  const hkdf = async (salt, ikm, info, length) => {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8
    );
    return new Uint8Array(bits);
  };

  // RFC 8291: 第一步 HKDF：auth_secret + ecdh -> PRK1 -> IKM_info
  // info = "WebPush: info\0" + user_public_key (65 bytes)
  const wpInfo = new Uint8Array([...enc.encode('WebPush: info\x00'), ...userPub]);
  const pseudoRandomKey = await hkdf(authSecret, ecdhBits, wpInfo, 32);

  // salt (16 random bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // content encryption key: HKDF with salt, IKM=pseudoRandomKey
  const cekInfo = enc.encode('Content-Encoding: aes128gcm\x00');
  const cek = await hkdf(salt, pseudoRandomKey, cekInfo, 16);

  // nonce
  const nonceInfo = enc.encode('Content-Encoding: nonce\x00');
  const nonce = await hkdf(salt, pseudoRandomKey, nonceInfo, 12);

  // 加密 (aes128gcm)，加 0x02 padding delimiter
  const plaintextWithPadding = new Uint8Array([...plaintextBytes, 0x02]);
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintextWithPadding
  );

  // 组装 aes128gcm content coding: salt(16) + rs(4, 4096) + idlen(1) + keyid(serverPub,65) + ciphertext
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  const idLen = new Uint8Array([65]);
  return new Uint8Array([...salt, ...rs, ...idLen, ...serverPubRaw, ...new Uint8Array(ciphertext)]);
}

// 发送单条推送
async function sendPush(sub, payloadStr) {
  const endpoint = sub.endpoint;
  const url = new URL(endpoint);
  const audience = url.protocol + '//' + url.host;
  try {
    const jwt = await createVapidJwt(audience);
    const encrypted = await encryptPayload(sub, payloadStr);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC,
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Urgency': 'normal'
      },
      body: encrypted
    });
    const respBody = await res.text().catch(() => '');
    return { status: res.status, body: respBody };
  } catch (e) {
    return { status: -1, body: e.message };
  }
}

export async function onRequestPost(ctx) {
  try {
    const body = await readBody(ctx.request);
    const title = (body && body.title) || '问卷新提交';
    const msgBody = (body && body.body) || '有人填写了你的问卷！';
    const url = (body && body.url) || '/';
    const payload = JSON.stringify({ title: title, body: msgBody, url: url });

    // 确保表存在
    await ctx.env.DB.prepare(`CREATE TABLE IF NOT EXISTS push_subs (
      endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, device TEXT DEFAULT '', created_at INTEGER NOT NULL
    )`).run();
    try { await ctx.env.DB.prepare('ALTER TABLE push_subs ADD COLUMN device TEXT DEFAULT ""').run(); } catch (e) {}

    // 读所有订阅
    const { results } = await ctx.env.DB.prepare('SELECT endpoint, sub FROM push_subs').all();
    let success = 0, fail = 0;
    const details = [];
    for (const row of (results || [])) {
      try {
        const sub = JSON.parse(row.sub);
        const r = await sendPush(sub, payload);
        if (r.status >= 200 && r.status < 300) {
          success++;
        } else {
          fail++;
          details.push(r.status + ': ' + (r.body || '').slice(0, 200));
          if (r.status === 404 || r.status === 410) await ctx.env.DB.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(row.endpoint).run();
        }
      } catch (e) { fail++; details.push('异常: ' + e.message); }
    }
    return json({ ok: true, sent: success, failed: fail, details: details });
  } catch (e) {
    return error('发送失败：' + e.message, 500);
  }
}
