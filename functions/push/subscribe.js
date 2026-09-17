// Find Car — Pages Function: POST /push/subscribe
//
// 保存浏览器的 Web Push 订阅。KV 键 = pushsub:<endpoint 的 sha256 hex>（endpoint 很长且含
// 推送服务令牌，不适合直接当键），值 = 订阅 JSON 原文（无 TTL，直到退订或推送失效被清理）。
// 与设备心跳记录（dev: 前缀）共用同一个 KV namespace（FIND_CAR_KV）。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  let subscription;
  try {
    subscription = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const endpoint = typeof subscription?.endpoint === 'string' ? subscription.endpoint : '';
  let isHttps = false;
  try {
    isHttps = new URL(endpoint).protocol === 'https:';
  } catch {
    // 非法 URL：走下面的 400
  }

  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!isHttps || typeof p256dh !== 'string' || !p256dh || typeof auth !== 'string' || !auth) {
    return json({ error: 'invalid subscription (expected {endpoint: https URL, keys:{p256dh, auth}})' }, 400);
  }

  try {
    await env.FIND_CAR_KV.put(`pushsub:${await sha256Hex(endpoint)}`, JSON.stringify(subscription));
  } catch (err) {
    console.error('KV put failed:', err);
    return json({ error: 'storage error' }, 500);
  }

  return json({ ok: true }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
