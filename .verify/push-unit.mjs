// Find Car —「设备上线 Web Push」纯 Node 单测（无浏览器、无网络、不起服务）
// 运行：node .verify/push-unit.mjs（需要 node >= 18，用自带的 globalThis.crypto Web Crypto）
//
// 覆盖：
//   ① 正常 /report 仍写 KV 且响应 {"ok":true}；旧记录在线时不扇出
//   ② 旧不在线 → 新在线时扇出一次：Authorization 头形如 vapid t=<jwt>, k=<pubkey>，
//      JWT payload.aud = endpoint origin、sub 正确，并用现场生成的公钥验签
//   ③ /push/subscribe 合法存储 / 非法 400
//   ④ /push/unsubscribe 删除
//   ⑤ 扇出遇 410 响应删除订阅键
//   ⑥ env 缺 VAPID 私钥时 /report 正常返回且零扇出
//   ⑦ /push/key 正常返回公钥 / 未配置 503（附 CORS 头检查）
//
// VAPID 密钥对在测试内现场 generateKey 生成，仓库与文件中不含任何真实密钥材料。

import { onRequestPost as reportPost } from '../functions/report.js';
import { onRequestPost as subscribePost } from '../functions/push/subscribe.js';
import { onRequestPost as unsubscribePost } from '../functions/push/unsubscribe.js';
import { onRequestGet as pushKeyGet } from '../functions/push/key.js';

// ---------- 小工具 ----------

function b64urlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- mock：KV / waitUntil / fetch ----------

function makeKv() {
  const map = new Map();
  return {
    map,
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix } = {}) {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix ?? '')).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

function makeWaitUntil() {
  const pending = [];
  return { pending, waitUntil: (p) => pending.push(Promise.resolve(p)) };
}

let fetchCalls = [];
let fetchStatus = 201;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init: init ?? {} });
  return new Response('', { status: fetchStatus });
};

function resetFetch(status = 201) {
  fetchCalls = [];
  fetchStatus = status;
}

// ---------- 请求构造 ----------

function postJson(path, obj) {
  return new Request(`https://find-dkc.pages.dev${path}`, {
    method: 'POST',
    body: typeof obj === 'string' ? obj : JSON.stringify(obj),
  });
}

const reportBody = (id) => ({
  device_id: id,
  type: 'dd',
  lan_ip: '192.168.3.46',
  hostname: 'dkc-host',
  version: '1.0.0',
});

const SUB_ENDPOINT = 'https://push.example.com/fcm/send/abc123def';
const SUBSCRIPTION = {
  endpoint: SUB_ENDPOINT,
  keys: { p256dh: 'BTestP256dhKeyMaterialPlaceholder', auth: 'TestAuthSecret123' },
};

function seedOffline(kv, id) {
  return kv.put(`dev:${id}`, JSON.stringify({
    device_id: id,
    type: 'dd',
    lan_ip: '192.168.3.46',
    state: 'offline',
    last_seen_epoch_ms: Date.now() - 60000,
  }));
}

async function seedSubscription(kv, endpoint = SUB_ENDPOINT) {
  await kv.put(`pushsub:${await sha256Hex(endpoint)}`, JSON.stringify(SUBSCRIPTION));
}

// ---------- 断言框架 ----------

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}

// ---------- 测试 ----------

// 现场生成 VAPID 密钥对（公钥 = base64url(raw 65 字节非压缩点)，私钥 = base64url(PKCS8 DER)）
const vapidKeyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const VAPID_PUBLIC_KEY = b64urlEncode(await crypto.subtle.exportKey('raw', vapidKeyPair.publicKey));
const VAPID_PRIVATE_KEY = b64urlEncode(await crypto.subtle.exportKey('pkcs8', vapidKeyPair.privateKey));

function makeEnv(kv) {
  return { FIND_CAR_KV: kv, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY };
}

// ① 正常 /report 仍写 KV 且响应 {"ok":true}；旧记录在线时不扇出
{
  const kv = makeKv();
  const env = makeEnv(kv);
  resetFetch();

  const w1 = makeWaitUntil();
  const r1 = await reportPost({ request: postJson('/report', reportBody('car-1')), env, waitUntil: w1.waitUntil });
  await Promise.all(w1.pending); // 首次上报算上线跳变会触发扇出，但无订阅 → 零 fetch
  const stored = JSON.parse(kv.map.get('dev:car-1'));
  check('① 正常上报响应 200 {"ok":true}', r1.status === 200 && JSON.stringify(await r1.json()) === JSON.stringify({ ok: true }));
  check('① 设备记录写入 KV 且 state=online', stored?.device_id === 'car-1' && stored?.state === 'online' && stored?.lan_ip === '192.168.3.46');
  check('① 无订阅时零推送请求', fetchCalls.length === 0);

  // 旧记录在线（刚写入、state=online、时间戳新鲜）→ 再次上报不得扇出
  await seedSubscription(kv);
  resetFetch();
  const w2 = makeWaitUntil();
  const r2 = await reportPost({ request: postJson('/report', reportBody('car-1')), env, waitUntil: w2.waitUntil });
  await Promise.all(w2.pending);
  check('① 旧记录在线时再次上报仍 200 {"ok":true}', r2.status === 200);
  check('① 旧记录在线时不触发扇出（waitUntil 未被调用、零 fetch）', w2.pending.length === 0 && fetchCalls.length === 0);
}

// ② 旧不在线 → 新在线：扇出一次，Authorization 头与 JWT 内容正确
{
  const kv = makeKv();
  const env = makeEnv(kv);
  await seedOffline(kv, 'car-2');
  await seedSubscription(kv);
  resetFetch(201);

  const w = makeWaitUntil();
  const r = await reportPost({ request: postJson('/report', reportBody('car-2')), env, waitUntil: w.waitUntil });
  check('② 上线跳变上报响应 200 {"ok":true}', r.status === 200);
  check('② waitUntil 收到一次扇出', w.pending.length === 1);
  await Promise.all(w.pending);

  check('② 恰好发出一个推送请求且目标是订阅 endpoint', fetchCalls.length === 1 && fetchCalls[0]?.url === SUB_ENDPOINT);
  const call = fetchCalls[0] ?? { init: {} };
  const authHeader = call.init.headers?.Authorization ?? '';
  check('② 请求方法 POST 且带 TTL: 60', call.init.method === 'POST' && call.init.headers?.TTL === '60');
  check('② Authorization 头形如 vapid t=<jwt>, k=<pubkey>', /^vapid t=[^,]+, k=/.test(authHeader));
  check('② Authorization 的 k = VAPID 公钥', authHeader.endsWith(`, k=${VAPID_PUBLIC_KEY}`));

  const jwt = authHeader.match(/^vapid t=([^,]+), k=/)?.[1] ?? '';
  const [h, p, s] = jwt.split('.');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h ?? '')));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p ?? '')));
  check('② JWT header = {"typ":"JWT","alg":"ES256"}', header.typ === 'JWT' && header.alg === 'ES256');
  check('② JWT payload.aud = endpoint origin', payload.aud === new URL(SUB_ENDPOINT).origin);
  check('② JWT payload.sub = https://find-dkc.pages.dev/', payload.sub === 'https://find-dkc.pages.dev/');
  check('② JWT payload.exp ≈ now+12h', Math.abs(payload.exp - Math.floor(Date.now() / 1000) - 12 * 3600) < 60);

  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapidKeyPair.publicKey,
    b64urlDecode(s ?? ''),
    new TextEncoder().encode(`${h}.${p}`),
  );
  check('② JWT 签名可用生成的公钥验签通过', verified === true);
  check('② 推送返回 201 时订阅键保留', kv.map.has(`pushsub:${await sha256Hex(SUB_ENDPOINT)}`));
}

// ③ /push/subscribe：合法存储 / 非法 400
{
  const kv = makeKv();
  const env = { FIND_CAR_KV: kv };

  const ok = await subscribePost({ request: postJson('/push/subscribe', SUBSCRIPTION), env });
  const subKey = `pushsub:${await sha256Hex(SUB_ENDPOINT)}`;
  const storedSub = kv.map.has(subKey) ? JSON.parse(kv.map.get(subKey)) : null;
  check('③ 合法订阅响应 200 {"ok":true}', ok.status === 200 && JSON.stringify(await ok.json()) === JSON.stringify({ ok: true }));
  check('③ 订阅按 pushsub:<sha256(endpoint)> 完整存储', storedSub?.endpoint === SUBSCRIPTION.endpoint && storedSub?.keys?.p256dh === SUBSCRIPTION.keys.p256dh && storedSub?.keys?.auth === SUBSCRIPTION.keys.auth);

  const badProtocol = await subscribePost({ request: postJson('/push/subscribe', { ...SUBSCRIPTION, endpoint: 'http://insecure.example.com/x' }), env });
  check('③ 非 https endpoint 返回 400', badProtocol.status === 400);

  const missingKeys = await subscribePost({ request: postJson('/push/subscribe', { endpoint: SUB_ENDPOINT }), env });
  check('③ 缺 keys 返回 400', missingKeys.status === 400);

  const emptyAuth = await subscribePost({ request: postJson('/push/subscribe', { endpoint: SUB_ENDPOINT, keys: { p256dh: 'x', auth: '' } }), env });
  check('③ 空 auth 返回 400', emptyAuth.status === 400);

  const badJson = await subscribePost({ request: postJson('/push/subscribe', 'not json{'), env });
  check('③ 非法 JSON 返回 400', badJson.status === 400);
  check('③ 非法请求均未写入 KV（仍只有 1 个订阅键）', [...kv.map.keys()].filter((k) => k.startsWith('pushsub:')).length === 1);

  // ④ /push/unsubscribe：删除对应订阅键（复用本场景的 KV）
  const un = await unsubscribePost({ request: postJson('/push/unsubscribe', { endpoint: SUB_ENDPOINT }), env });
  check('④ 退订响应 200 {"ok":true}', un.status === 200 && JSON.stringify(await un.json()) === JSON.stringify({ ok: true }));
  check('④ 订阅键已从 KV 删除', !kv.map.has(subKey));
}

// ⑤ 扇出遇 410：删除失效订阅键
{
  const kv = makeKv();
  const env = makeEnv(kv);
  await seedOffline(kv, 'car-5');
  await seedSubscription(kv);
  resetFetch(410);

  const w = makeWaitUntil();
  const r = await reportPost({ request: postJson('/report', reportBody('car-5')), env, waitUntil: w.waitUntil });
  await Promise.all(w.pending);
  check('⑤ 上报照常 200 {"ok":true} 且设备记录已写入', r.status === 200 && JSON.parse(kv.map.get('dev:car-5'))?.state === 'online');
  check('⑤ 410 响应后订阅键被删除', fetchCalls.length === 1 && !kv.map.has(`pushsub:${await sha256Hex(SUB_ENDPOINT)}`));
}

// ⑥ env 缺 VAPID 私钥：/report 正常返回且零扇出
{
  const kv = makeKv();
  const env = { FIND_CAR_KV: kv, VAPID_PUBLIC_KEY }; // 只有公钥、没有私钥
  await seedOffline(kv, 'car-6');
  await seedSubscription(kv);
  resetFetch();

  const w = makeWaitUntil();
  const r = await reportPost({ request: postJson('/report', reportBody('car-6')), env, waitUntil: w.waitUntil });
  await Promise.all(w.pending);
  check('⑥ 缺私钥时上报仍 200 {"ok":true}', r.status === 200 && JSON.stringify(await r.json()) === JSON.stringify({ ok: true }));
  check('⑥ 缺私钥时零推送请求、订阅键不动', fetchCalls.length === 0 && kv.map.has(`pushsub:${await sha256Hex(SUB_ENDPOINT)}`));
}

// ⑦ /push/key：返回公钥 / 未配置 503 / CORS 头
{
  const ok = await pushKeyGet({ env: { VAPID_PUBLIC_KEY } });
  const okBody = await ok.json();
  check('⑦ /push/key 返回 200 {"key": 公钥}', ok.status === 200 && okBody.key === VAPID_PUBLIC_KEY);
  check('⑦ /push/key 带 CORS 头 Access-Control-Allow-Origin: *', ok.headers.get('Access-Control-Allow-Origin') === '*');

  const missing = await pushKeyGet({ env: {} });
  const missingBody = await missing.json();
  check('⑦ 未配置时返回 503 {"error":"push not configured"}', missing.status === 503 && missingBody.error === 'push not configured');
}

// ---------- 汇总 ----------

globalThis.fetch = realFetch;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
