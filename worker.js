// Find Car — Cloudflare Worker
//
// 协议：
//   POST /report           设备心跳上报（body 为 JSON）
//   GET  /devices?token=   按共享口令列出在线设备
//
// token 只做 SHA-256 哈希后当 KV 键前缀，绝不存储明文。

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const KV_BINDING = 'FIND_CAR_KV';
const TTL_SECONDS = 720; // 12 分钟
const ONLINE_WINDOW_MS = 720000; // 12 分钟，与 TTL 一致

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // 预检请求
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 设备心跳上报
    if (method === 'POST' && url.pathname === '/report') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }

      const token = typeof body.token === 'string' ? body.token.trim() : '';
      const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
      const type = typeof body.type === 'string' ? body.type : '';
      const lanIp = typeof body.lan_ip === 'string' ? body.lan_ip.trim() : '';

      if (!token) {
        return jsonResponse({ error: 'missing token' }, 400);
      }
      if (!deviceId) {
        return jsonResponse({ error: 'missing device_id' }, 400);
      }
      if (type !== 'esp32' && type !== 'dd') {
        return jsonResponse({ error: 'invalid type (expected esp32 or dd)' }, 400);
      }
      if (!lanIp) {
        return jsonResponse({ error: 'missing lan_ip' }, 400);
      }

      const hash = await sha256Hex(token);
      const key = `dev:${hash}:${deviceId}`;

      // 值 = 上报字段去掉 token，另附加 last_seen_epoch_ms 供查询时计算在线状态
      const record = {
        device_id: deviceId,
        type,
        lan_ip: lanIp,
        port: Number.isFinite(Number(body.port)) && Number(body.port) > 0 ? Number(body.port) : 80,
        hostname: typeof body.hostname === 'string' ? body.hostname : deviceId,
        version: typeof body.version === 'string' ? body.version : '',
        last_seen_epoch_ms: Date.now(),
      };

      try {
        await env[KV_BINDING].put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
      } catch (err) {
        console.error('KV put failed:', err);
        return jsonResponse({ error: 'storage error' }, 500);
      }

      return jsonResponse({ ok: true }, 200);
    }

    // 列出设备
    if (method === 'GET' && url.pathname === '/devices') {
      const token = (url.searchParams.get('token') || '').trim();
      if (!token) {
        return jsonResponse({ error: 'missing token' }, 400);
      }

      const hash = await sha256Hex(token);
      const prefix = `dev:${hash}:`;

      try {
        const devices = [];
        const now = Date.now();
        let cursor;

        do {
          const page = await env[KV_BINDING].list({ prefix, cursor });
          for (const item of page.keys) {
            const raw = await env[KV_BINDING].get(item.name);
            if (!raw) continue;

            let rec;
            try {
              rec = JSON.parse(raw);
            } catch {
              continue; // 跳过损坏记录
            }

            const lastSeen = Number(rec.last_seen_epoch_ms) || 0;
            devices.push({
              device_id: rec.device_id,
              type: rec.type,
              lan_ip: rec.lan_ip,
              port: rec.port,
              hostname: rec.hostname,
              version: rec.version,
              last_seen_epoch_ms: lastSeen,
              online: now - lastSeen < ONLINE_WINDOW_MS,
            });
          }
          cursor = page.list_complete ? undefined : page.cursor;
        } while (cursor);

        devices.sort((a, b) => {
          const byHost = String(a.hostname || '').localeCompare(String(b.hostname || ''));
          if (byHost !== 0) return byHost;
          return String(a.device_id || '').localeCompare(String(b.device_id || ''));
        });

        return jsonResponse({ devices });
      } catch (err) {
        console.error('KV list/get failed:', err);
        return jsonResponse({ error: 'storage error' }, 500);
      }
    }

    return jsonResponse({ error: 'not found' }, 404);
  },
};
