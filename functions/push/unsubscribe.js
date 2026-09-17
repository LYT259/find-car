// Find Car — Pages Function: POST /push/unsubscribe
//
// 删除 Web Push 订阅：body {"endpoint"} → 删除对应 pushsub:<sha256 hex> 键。
// 幂等：键不存在或 endpoint 缺失也返回 {"ok":true}（退订的最终状态都是"没有这个订阅"）。

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
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
  if (endpoint) {
    try {
      await env.FIND_CAR_KV.delete(`pushsub:${await sha256Hex(endpoint)}`);
    } catch (err) {
      console.error('KV delete failed:', err);
      return json({ error: 'storage error' }, 500);
    }
  }

  return json({ ok: true }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
