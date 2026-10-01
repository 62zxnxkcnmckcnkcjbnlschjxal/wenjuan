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

// 导入 VAPID 私钥用于 ES256 签名
async function importVapidPrivateKey() {
  const raw = urlBase64ToBuf(VAPID_PRIVATE);
  return crypto.subtle.importKey(
    'raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
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
  // DER -> raw (r||s, 各32字节)
  const der = new Uint8Array(sig);
  const r = der.slice(der[2] + 3, der[2] + 3 + 32);
  const s = der.slice(der[2] + 3 + 32, der[2] + 3 + 64);
  return headerB64 + '.' + payloadB64 + '.' + bufToUrlBase64(new Uint8Array([...r, ...s]));
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
    'raw', userPub, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']
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

  // RFC 8291: auth secret + ecdh -> key
  const keyInfo = enc.encode('WebPush: info\x00') + userPub;
  // 简化：直接用标准 HKDF 步骤
  const pseudoRandomKey = await hkdf(authSecret, ecdhBits, enc.encode('WebPush: info\x00'), 32);

  // salt (16 random bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // content encryption key
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
  return res.status;
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
      endpoint TEXT PRIMARY KEY, sub TEXT NOT NULL, created_at INTEGER NOT NULL
    )`).run();

    // 读所有订阅
    const { results } = await ctx.env.DB.prepare('SELECT endpoint, sub FROM push_subs').all();
    let success = 0, fail = 0;
    for (const row of (results || [])) {
      try {
        const sub = JSON.parse(row.sub);
        const status = await sendPush(sub, payload);
        if (status >= 200 && status < 300) success++;
        else { fail++; if (status === 404 || status === 410) await ctx.env.DB.prepare('DELETE FROM push_subs WHERE endpoint=?').bind(row.endpoint).run(); }
      } catch (e) { fail++; }
    }
    return json({ ok: true, sent: success, failed: fail });
  } catch (e) {
    return error('发送失败：' + e.message, 500);
  }
}
