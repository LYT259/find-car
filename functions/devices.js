// Find Car — Pages Function: GET /devices
//
// 列出所有登记设备（去 token，公开查询）。KV 键 = dev:<device_id>。
// online 判定 = 记录未显式下线 且 距最近一次心跳未超过该类型的在线窗口。

// 在线窗口按设备类型的上报节奏取值：DD 后端 150s 一跳、ESP32 300s 一跳，
// 都留出「漏一跳仍在线」的余量，避免网络抖动造成闪烁。
const ONLINE_WINDOW_MS = {
  dd: 330000, // 5.5 分钟
  esp32: 480000, // 8 分钟
  default: 480000,
};

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
  const prefix = 'dev:';

  try {
    const devices = [];
    const now = Date.now();
    let cursor;

    do {
      const page = await env.FIND_CAR_KV.list({ prefix, cursor });
      for (const item of page.keys) {
        const raw = await env.FIND_CAR_KV.get(item.name);
        if (!raw) continue;

        let rec;
        try {
          rec = JSON.parse(raw);
        } catch {
          continue; // 跳过损坏记录
        }

        const lastSeen = Number(rec.last_seen_epoch_ms) || 0;
        const window = ONLINE_WINDOW_MS[rec.type] || ONLINE_WINDOW_MS.default;
        devices.push({
          device_id: rec.device_id,
          type: rec.type,
          lan_ip: rec.lan_ip,
          port: rec.port,
          hostname: rec.hostname,
          version: rec.version,
          model: rec.model || '',
          os: rec.os || '',
          last_seen_epoch_ms: lastSeen,
          // 显式下线（state=offline）的记录立即算离线，不等到窗口走完
          online: rec.state !== 'offline' && now - lastSeen < window,
        });
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    devices.sort((a, b) => {
      // 在线设备排在前面，其次按主机名 / 设备 ID
      if (!!a.online !== !!b.online) return a.online ? -1 : 1;
      const byHost = String(a.hostname || '').localeCompare(String(b.hostname || ''));
      if (byHost !== 0) return byHost;
      return String(a.device_id || '').localeCompare(String(b.device_id || ''));
    });

    return json({ devices });
  } catch (err) {
    console.error('KV list/get failed:', err);
    return json({ error: 'storage error' }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
