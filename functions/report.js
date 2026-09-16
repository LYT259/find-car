// Find Car — Pages Function: POST /report
//
// 设备心跳上报（去 token，公开）。KV 键 = dev:<device_id>。
//   - 在线心跳：TTL 900s（15 分钟），设备停止上报后先显示「离线」，随后过期消失。
//   - 显式下线：body 带 {"state":"offline"}（DD 后端优雅退出时发一次），TTL 600s，
//     查询端立即显示「离线」，不必等在线窗口走完。

const TTL_SECONDS = 900; // 15 分钟：正常心跳记录的存活时间（大于在线窗口）
const OFFLINE_TTL_SECONDS = 600; // 10 分钟：显式下线记录的存活时间
const MAX_TEXT_LEN = 64; // 文本字段长度上限，防止脏数据撑大记录

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

function text(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LEN) : '';
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  const deviceId = text(body.device_id);
  const type = typeof body.type === 'string' ? body.type : '';
  const lanIp = text(body.lan_ip);
  const state = body.state === 'offline' ? 'offline' : 'online';

  if (!deviceId) return json({ error: 'missing device_id' }, 400);
  if (type !== 'esp32' && type !== 'dd') return json({ error: 'invalid type (expected esp32 or dd)' }, 400);
  if (!lanIp) return json({ error: 'missing lan_ip' }, 400);

  const key = `dev:${deviceId}`;
  const record = {
    device_id: deviceId,
    type,
    lan_ip: lanIp,
    port: Number.isFinite(Number(body.port)) && Number(body.port) > 0 ? Number(body.port) : 80,
    hostname: text(body.hostname) || deviceId,
    version: text(body.version),
    // 主机身份（DD 后端上报的系统 / 本机型号）：网页「设备类型」列显示系统（如 Ubuntu 26.04 LTS 主机），
    // 主板型号（如 ADL-N）只作悬停提示，避免把没人认识的型号当类型展示
    model: text(body.model),
    os: text(body.os),
    state,
    last_seen_epoch_ms: Date.now(),
  };

  try {
    await env.FIND_CAR_KV.put(key, JSON.stringify(record), {
      expirationTtl: state === 'offline' ? OFFLINE_TTL_SECONDS : TTL_SECONDS,
    });
  } catch (err) {
    console.error('KV put failed:', err);
    return json({ error: 'storage error' }, 500);
  }

  return json({ ok: true }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
