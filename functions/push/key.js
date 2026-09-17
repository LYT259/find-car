// Find Car — Pages Function: GET /push/key
//
// 返回 Web Push 的 VAPID 应用服务器公钥（base64url），前端 PushManager.subscribe
// 时作为 applicationServerKey。未配置 VAPID_PUBLIC_KEY 时返回 503，前端据此隐藏订阅入口。

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

export async function onRequestGet({ env }) {
  const key = typeof env.VAPID_PUBLIC_KEY === 'string' && env.VAPID_PUBLIC_KEY ? env.VAPID_PUBLIC_KEY : null;
  if (!key) return json({ error: 'push not configured' }, 503);
  return json({ key }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
