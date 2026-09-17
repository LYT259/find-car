// Find Car — Web Push 共享模块（下划线前缀，Pages 不会把它当路由）
//
// 被 functions/report.js（上线跳变扇出）与 functions/push/subscribe.js（订阅成功的
// 欢迎 tickle）共用：VAPID JWT（RFC 8292，ES256）签名 + 向单个订阅发无负载 tickle。
// 私钥 = env.VAPID_PRIVATE_KEY（base64url 编码的 PKCS8 DER，ECDSA P-256），
// 只存 Cloudflare secrets，仓库零密钥材料。

// Web Push JWT 的 sub（RFC 8292 要求的联系方式，推送服务回联用）
const VAPID_SUB = 'https://find-dkc.pages.dev/';

// ---- base64url 小工具（isolates 无 Node crypto，基于 btoa/atob 做 URL 安全替换与 padding）----

export function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 签 VAPID JWT：aud = 推送服务 origin，exp = 12h（RFC 8292 上限 24h 内），sub = 站点联系方式。
export async function signVapidJwt(privateKeyB64Url, audience) {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    base64UrlDecode(privateKeyB64Url),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const unsigned = [
    base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
    base64UrlEncode(JSON.stringify({
      aud: audience,
      exp: Math.floor(Date.now() / 1000) + 12 * 3600,
      sub: VAPID_SUB,
    })),
  ].join('.');
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

// 向单个订阅发无负载 tickle（不带 body、不加密）；订阅失效（404/410）顺手删除 KV 键。
// 单个订阅的任何失败都只记日志，不影响其它订阅与调用方响应。
export async function sendPushTickle(env, kvKey, subscription) {
  try {
    const endpoint = subscription.endpoint;
    const jwt = await signVapidJwt(env.VAPID_PRIVATE_KEY, new URL(endpoint).origin);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
        TTL: '60',
      },
    });
    if (res.status === 404 || res.status === 410) {
      await env.FIND_CAR_KV.delete(kvKey);
    }
  } catch (err) {
    console.error('push tickle failed:', err);
  }
}
