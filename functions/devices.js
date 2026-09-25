// Find Car — Pages Function: GET /devices
//
// 只返回「与查询方同一局域网」的设备（2026-09-25 v1.7.0 起；去 token，公开查询）。KV 键 = dev:<device_id>。
// 同一局域网口径 = 双方公网出口一致：IPv4 比完整地址（同一 NAT），IPv6 比 /64 前缀
//（同一家庭前缀；隐私地址只变后 64 位）。设备出口 = 上报时记录的 egress_ip（只参与匹配，不下发）。
// 查询方出口取 CF-Connecting-IP；浏览器经 IPv6 访问、设备走 IPv4 上报时服务端看不到浏览器的
// v4 出口，由页面经纯 IPv4 探测服务拿到后随 ?v4= 带上（仅对 IPv6 客户端有意义，可伪造——
// 这是尽力过滤，不是鉴权）。
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

const V4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

// IPv6 归一化到 /64 前缀（前 4 段，补全 :: 缩写）；非 IPv6 或畸形返回 ''
function v6Prefix64(ip) {
  if (!ip || ip.indexOf(':') === -1) return '';
  let head = ip;
  let tail = '';
  const dc = ip.indexOf('::');
  if (dc !== -1) {
    head = ip.slice(0, dc);
    tail = ip.slice(dc + 2);
  }
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return '';
  const full = headParts.concat(new Array(missing).fill('0'), tailParts);
  if (full.length !== 8) return '';
  return full.slice(0, 4).join(':').toLowerCase();
}

// 出口匹配键：IPv4 精确匹配，IPv6 按 /64 前缀；取不到返回 ''
function egressKey(ip) {
  if (V4_RE.test(ip)) return 'v4:' + ip;
  const prefix64 = v6Prefix64(ip);
  return prefix64 ? 'v6:' + prefix64 : '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ request, env }) {
  const prefix = 'dev:';

  // 查询方出口键集合：CF-Connecting-IP（可信）+ 可选 ?v4=（IPv6 浏览器自报的 v4 出口）
  const clientKeys = new Set();
  const headerKey = egressKey(request.headers.get('CF-Connecting-IP') || '');
  if (headerKey) clientKeys.add(headerKey);
  const queryV4 = new URL(request.url).searchParams.get('v4') || '';
  if (V4_RE.test(queryV4)) clientKeys.add('v4:' + queryV4);

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

        // 同局域网过滤：出口键不在查询方集合里直接跳过；
        // 缺 egress_ip 的旧记录过渡期放行（下一轮心跳即补齐，避免全量闪空）
        const recKey = egressKey(typeof rec.egress_ip === 'string' ? rec.egress_ip : '');
        if (recKey && !clientKeys.has(recKey)) continue;

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
