// Find Car — Pages Function: POST /report
//
// 设备心跳上报（去 token，公开）。KV 键 = dev:<device_id>。
//   - 在线心跳：TTL 900s（15 分钟），设备停止上报后先显示「离线」，随后过期消失。
//   - 显式下线：body 带 {"state":"offline"}（DD 后端优雅退出时发一次），TTL 600s，
//     查询端立即显示「离线」，不必等在线窗口走完。
//   - 上线跳变（旧记录不在线 → 本次在线）时，KV 写完后经 waitUntil 后台扇出 Web Push
//     提醒（无负载 tickle）；推送的任何失败都被吞掉，绝不影响 /report 响应。

const TTL_SECONDS = 900; // 15 分钟：正常心跳记录的存活时间（大于在线窗口）
const OFFLINE_TTL_SECONDS = 600; // 10 分钟：显式下线记录的存活时间
const MAX_TEXT_LEN = 64; // 文本字段长度上限，防止脏数据撑大记录

// 上线判定窗口：与 functions/devices.js 的在线口径保持一致（DD 150s 一跳、ESP32 300s 一跳，留漏一跳余量）
const ONLINE_WINDOW_MS = {
  dd: 330000, // 5.5 分钟
  esp32: 480000, // 8 分钟
  default: 480000,
};

// Web Push JWT 的 sub（RFC 8292 要求的联系方式，推送服务回联用）
const VAPID_SUB = 'https://find-dkc.pages.dev/';

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

// ---- base64url 小工具（isolates 无 Node crypto，基于 btoa/atob 做 URL 安全替换与 padding）----

function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- 设备上线 Web Push：VAPID JWT（RFC 8292，ES256）与订阅扇出 ----

// 签 VAPID JWT：aud = 推送服务 origin，exp = 12h（RFC 8292 上限 24h 内），sub = 站点联系方式。
// 私钥 = env.VAPID_PRIVATE_KEY（base64url 编码的 PKCS8 DER，ECDSA P-256）。
async function signVapidJwt(privateKeyB64Url, audience) {
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
// 单个订阅的任何失败都只记日志，不影响其它订阅与上报响应。
async function sendPushTickle(env, kvKey, subscription) {
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

// 遍历 pushsub: 前缀的全部订阅逐个扇出；未配置 VAPID 密钥对时静默跳过，任何异常一律吞掉。
async function fanoutPush(env) {
  try {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
    let cursor;
    do {
      const page = await env.FIND_CAR_KV.list({ prefix: 'pushsub:', cursor });
      for (const item of page.keys) {
        const raw = await env.FIND_CAR_KV.get(item.name);
        if (!raw) continue;
        let subscription;
        try {
          subscription = JSON.parse(raw);
        } catch {
          continue; // 跳过损坏记录
        }
        await sendPushTickle(env, item.name, subscription);
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (err) {
    console.error('push fanout failed:', err);
  }
}

// 旧记录是否处于在线态：与 GET /devices 的口径一致（显式 offline 立即算离线，否则看窗口）
function wasOnline(oldRecord, now) {
  if (!oldRecord || oldRecord.state === 'offline') return false;
  const lastSeen = Number(oldRecord.last_seen_epoch_ms) || 0;
  const window = ONLINE_WINDOW_MS[oldRecord.type] || ONLINE_WINDOW_MS.default;
  return now - lastSeen < window;
}

export async function onRequestPost({ request, env, waitUntil }) {
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
  const now = Date.now();

  // 写新记录之前先读旧记录，判断是否「旧不在线 → 新在线」；读失败按无旧记录处理，不影响上报
  let oldRecord = null;
  try {
    const oldRaw = await env.FIND_CAR_KV.get(key);
    oldRecord = oldRaw ? JSON.parse(oldRaw) : null;
  } catch {
    // 读旧记录失败：跳过上线检测，照常写新记录
  }
  const oldOnline = wasOnline(oldRecord, now);

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
    last_seen_epoch_ms: now,
  };

  try {
    await env.FIND_CAR_KV.put(key, JSON.stringify(record), {
      expirationTtl: state === 'offline' ? OFFLINE_TTL_SECONDS : TTL_SECONDS,
    });
  } catch (err) {
    console.error('KV put failed:', err);
    return json({ error: 'storage error' }, 500);
  }

  // 上线跳变：KV 照常写完后，经 waitUntil 后台扇出推送（不阻塞响应，失败绝不让 /report 报错）
  if (!oldOnline && state === 'online' && typeof waitUntil === 'function') {
    try {
      waitUntil(fanoutPush(env));
    } catch {
      // waitUntil 本身异常也吞掉
    }
  }

  return json({ ok: true }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
