/* FDC Apple 象限补充验证（verify.js 未覆盖），仓库常驻、仅本地验证用，不参与部署：
 * 1) apple 象限桌面/移动端整行点击 → window.open 设备控制台 URL
 * 2) 点复制按钮不触发行跳转；cockpit 象限行点击不跳转（交互原样）
 * 3) 复制成功绿勾（.copied + icoCheck 可见，1.2s 后自动消失）、
 *    刷新转环（.loading + btnSpin 可见，完成后复位回「刷新」）
 * 4) 空态（stub-empty.py）/ 错误态（stub-error.py）/ toast 胶囊 / 转环 截图 → .verify/shots/
 * 运行前需先起三个桩：stub.py（主）、stub-empty.py（空态）、stub-error.py（错误态）。
 * 端口可用环境变量覆盖：FDC_PORT_MAIN（默认 8099）/ FDC_PORT_EMPTY（默认 8098）/ FDC_PORT_ERROR（默认 8097），
 * 需与三个桩各自监听的端口一致，例如：
 *   FDC_PORT_MAIN=8180 FDC_PORT_EMPTY=8181 FDC_PORT_ERROR=8182 \
 *   NODE_PATH=/home/dkc/projects/node_modules node .verify/verify-extra.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT_MAIN = process.env.FDC_PORT_MAIN || 8099;
const PORT_EMPTY = process.env.FDC_PORT_EMPTY || 8098;
const PORT_ERROR = process.env.FDC_PORT_ERROR || 8097;
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch(process.env.FDC_CI ? {} : { channel: 'chrome' });

  // 1) apple 桌面：整行点击 + 复制不冲突 + 绿勾 + toast 截图 + 转环
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('findcar.ui.style', 'apple');
      window.__opened = [];
      window.open = function (url) { window.__opened.push(String(url)); return null; };
    });
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    await page.click('tbody tr:first-child td.name');
    const opened = await page.evaluate(() => window.__opened);
    check('apple 桌面整行点击打开控制台', opened.length === 1 && opened[0] === 'http://192.168.1.46/', JSON.stringify(opened));

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    let popupCount = 0;
    ctx.on('page', () => { popupCount += 1; });
    await page.click('.copyBtn >> nth=0');
    await page.waitForTimeout(300);
    check('点复制按钮不触发行跳转', popupCount === 0, `popups=${popupCount}`);
    const copied = await page.evaluate(() => {
      const btn = document.querySelector('.copyBtn');
      const checkVisible = getComputedStyle(btn.querySelector('.icoCheck')).display !== 'none';
      return { cls: btn.classList.contains('copied'), checkVisible };
    });
    check('复制成功绿勾出现（.copied + icoCheck）', copied.cls && copied.checkVisible, JSON.stringify(copied));
    await page.waitForSelector('.toast.show');
    await page.screenshot({ path: path.join(SHOTS, 'toast-pill-dark.png') });
    await page.waitForTimeout(1100);
    const copiedGone = await page.evaluate(() => !document.querySelector('.copyBtn').classList.contains('copied'));
    check('绿勾 1.2s 后自动消失', copiedGone);

    // 刷新转环：桩 /devices 有 700ms 延迟，点击后 300ms 内应可见
    await page.click('#search-btn');
    await page.waitForTimeout(300);
    const loading = await page.evaluate(() => {
      const btn = document.querySelector('#search-btn');
      const spin = btn.querySelector('.btnSpin');
      return {
        cls: btn.classList.contains('loading'),
        disabled: btn.disabled,
        label: btn.querySelector('.btnLabel').textContent,
        spinVisible: getComputedStyle(spin).display !== 'none',
      };
    });
    check('手动刷新进入转环态（.loading + 禁用 + 查找中… + 转环可见）',
      loading.cls && loading.disabled && loading.label === '查找中…' && loading.spinVisible, JSON.stringify(loading));
    await page.screenshot({ path: path.join(SHOTS, 'refresh-spin-dark.png') });
    // 等 loading 类消失（拉取完成的确定信号），而不是等 tbody tr（旧行一直都在）
    await page.waitForFunction(() => !document.querySelector('#search-btn').classList.contains('loading'), null, { timeout: 5000 });
    const idle = await page.evaluate(() => {
      const btn = document.querySelector('#search-btn');
      return { cls: btn.classList.contains('loading'), label: btn.querySelector('.btnLabel').textContent };
    });
    check('刷新完成后复位（文字回「刷新」）', !idle.cls && idle.label === '刷新', JSON.stringify(idle));

    const titles = await page.evaluate(() => Array.from(document.querySelectorAll('td.mono a')).map(a => a.title));
    check('IP 链接带控制台悬停提示', titles[0] === '打开 Drifter Console' && titles[1] === '打开 DonkeyDrifter', JSON.stringify(titles));
    await ctx.close();
  }

  // 2) cockpit：行点击不跳转、转环/绿勾不出现（基座隐藏）
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.addInitScript(() => window.localStorage.setItem('findcar.ui.style', 'cockpit'));
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    let popupCount = 0;
    ctx.on('page', () => { popupCount += 1; });
    await page.click('tbody tr:first-child td.name');
    await page.waitForTimeout(700);
    const cursor = await page.evaluate(() => getComputedStyle(document.querySelector('tbody tr')).cursor);
    check('cockpit 行点击不跳转（交互原样）', popupCount === 0 && cursor !== 'pointer', `popups=${popupCount} cursor=${cursor}`);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('.copyBtn >> nth=0');
    await page.waitForTimeout(300);
    const cock = await page.evaluate(() => {
      const btn = document.querySelector('.copyBtn');
      return getComputedStyle(btn.querySelector('.icoCheck')).display === 'none'
        && getComputedStyle(btn.querySelector('.icoCopy')).display !== 'none';
    });
    check('cockpit 复制不出现绿勾换图标（视觉原样）', cock);
    await ctx.close();
  }

  // 3) apple 移动端整行点击
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('findcar.ui.style', 'apple');
      window.__opened = [];
      window.open = function (url) { window.__opened.push(String(url)); return null; };
    });
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    await page.click('tbody tr:first-child td.name');
    const opened = await page.evaluate(() => window.__opened);
    check('apple 移动端整行点击打开控制台', opened.length === 1 && opened[0] === 'http://192.168.1.46/', JSON.stringify(opened));
    await ctx.close();
  }

  // 4) 空态 / 错误态截图
  for (const [port, name, theme, width] of [
    [PORT_EMPTY, 'empty-apple-dark-1280', 'dark', 1280],
    [PORT_EMPTY, 'empty-apple-light-1280', 'light', 1280],
    [PORT_ERROR, 'error-apple-dark-1280', 'dark', 1280],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log(`\n== ${results.length - failed}/${results.length} 项通过 ==`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
