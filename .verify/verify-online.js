/* FDC 线上实测：https://find-dkc.pages.dev/
 * Apple 为唯一风格（座舱切换器已移除）、旧 localStorage 键 findcar.ui.style 被忽略、真实设备渲染正常、线上小字已删
 */
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://find-dkc.pages.dev';
const SHOTS = path.join(__dirname, 'shots');

(async () => {
  const browser = await chromium.launch(process.env.FDC_CI ? {} : { channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN', colorScheme: 'dark' });
  const page = await ctx.newPage();
  let failed = 0;
  const check = (name, ok, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  const switcher = await page.evaluate(() => ({
    hasSeg: !!document.querySelector('.uiSeg'),
    hasSegBtn: !!document.querySelector('.uiSegBtn'),
    ui: document.documentElement.dataset.ui,
  }));
  check('线上无座舱切换器（Apple 唯一风格）',
    !switcher.hasSeg && !switcher.hasSegBtn && switcher.ui === undefined,
    `data-ui=${switcher.ui}`);

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

  // v1.6.0 起页面不再读取 findcar.ui.style：写入旧值 cockpit 后重载，仍为 Apple 深色 #000
  await page.evaluate(() => localStorage.setItem('findcar.ui.style', 'cockpit'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('tbody tr', { timeout: 15000 });
  const legacyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('线上残留 findcar.ui.style=cockpit 被忽略', legacyBg === 'rgb(0, 0, 0)', legacyBg);

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
