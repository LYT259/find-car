/* FDC 线上实测：https://find-dkc.pages.dev/
 * 默认 Apple 风格、切换器可用、真实设备渲染正常、线上小字已删
 */
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://find-dkc.pages.dev';
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await ctx.newPage();
  let failed = 0;
  const check = (name, ok, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const ui = await page.evaluate(() => document.documentElement.dataset.ui);
  check('线上默认风格为 apple', ui === 'apple', `data-ui=${ui}`);

  await page.waitForSelector('tbody tr', { timeout: 15000 });
  const rows = await page.locator('tbody tr').count();
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('tbody tr td.name')).map((td) => td.textContent));
  check('真实设备渲染（≥1 台）', rows >= 1, `${rows} 行: ${names.join(', ')}`);

  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('线上 Apple 深色 canvas #000', bodyBg === 'rgb(0, 0, 0)', bodyBg);

  const noSmallText = await page.evaluate(() =>
    !document.querySelector('.footnote') && !document.body.innerText.includes('正常上报周期'));
  check('线上小字已删', noSmallText);

  await page.screenshot({ path: path.join(SHOTS, 'online-apple-dark-zh-1280.png') });

  // 切换器线上可用：apple → cockpit → apple
  await page.click('.uiSegBtn[data-ui-value="cockpit"]');
  const cockpitBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('线上切座舱（bg #101318）', cockpitBg === 'rgb(16, 19, 24)', cockpitBg);
  await page.screenshot({ path: path.join(SHOTS, 'online-cockpit-dark-zh-1280.png') });
  await page.click('.uiSegBtn[data-ui-value="apple"]');
  // 2026-09-16 第二轮 Apple 细修起：cockpit→apple 的 body 背景有刻意为之的 320ms 交叉淡化，
  // 立即读计算样式会拿到过渡中间值，等动画结束再断言
  await page.waitForTimeout(450);
  const backBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('线上切回 Apple', backBg === 'rgb(0, 0, 0)', backBg);

  // 真实 /devices 契约
  const resp = await page.evaluate(async () => {
    const r = await fetch('/devices', { cache: 'no-store' });
    return { ok: r.ok, data: await r.json() };
  });
  check('线上 GET /devices 契约', resp.ok && Array.isArray(resp.data.devices),
    `${(resp.data.devices || []).length} 台设备`);

  await browser.close();
  console.log(failed ? `\n== ${failed} 项失败 ==` : '\n== 线上实测全部通过 ==');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
