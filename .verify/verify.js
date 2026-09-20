/* FDC 本地验证（v1.6.0 起 Apple 为唯一界面风格，座舱象限已移除）：
 * 1) dark/light × zh/en × 390/1280 截图（8 张）
 * 2) 无座舱残留：无切换器、旧 findcar.ui.style=cockpit 键被忽略、Apple 行为恒定
 * 3) 390px 无横向滚动；小字已删；骨架屏出现；tooltip 纯净；复制 toast；语言切换；轮询频率
 */
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8099';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch(process.env.FDC_CI ? {} : { channel: 'chrome' });

  // ---------- 1) 截图矩阵（Apple 唯一风格：dark/light × zh/en × 390/1280） ----------
  for (const theme of ['dark', 'light']) {
    for (const lang of ['zh', 'en']) {
      for (const width of [390, 1280]) {
        const ctx = await browser.newContext({
          viewport: { width, height: 844 },
          colorScheme: theme,
          locale: lang === 'zh' ? 'zh-CN' : 'en-US',
          deviceScaleFactor: 2,
        });
        const page = await ctx.newPage();
        await page.addInitScript((l) => {
          window.localStorage.setItem('findcar.ui.lang', l);
        }, lang);
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForSelector('tbody tr');
        await page.screenshot({ path: path.join(SHOTS, `${theme}-${lang}-${width}.png`) });
        await ctx.close();
      }
    }
  }

  // ---------- 2) 座舱移除回归：旧键被忽略、无切换器、Apple 行为与样式恒定 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN', colorScheme: 'dark' });
    const page = await ctx.newPage();
    // 故意写入旧版「座舱」选择：v1.6.0 起该键必须被完全忽略
    await page.addInitScript(() => window.localStorage.setItem('findcar.ui.style', 'cockpit'));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const probe = await page.evaluate(() => {
      const panel = document.querySelector('.panelCard');
      const row = document.querySelector('tbody tr');
      return {
        seg: !!document.querySelector('.uiSeg'),
        dataUi: document.documentElement.dataset.ui,
        tabindex: row ? row.getAttribute('tabindex') : null,
        radius: panel ? getComputedStyle(panel).borderRadius : '',
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    });
    check('座舱残留清零：无切换器 / data-ui 不再出现 / 旧 localStorage 键被忽略',
      probe.seg === false && probe.dataUi === undefined, JSON.stringify(probe));
    check('旧键=cockpit 仍渲染 Apple（卡片 17px 圆角、深色纯黑底、行可聚焦）',
      probe.radius === '17px' && probe.bodyBg === 'rgb(0, 0, 0)' && probe.tabindex === '0', JSON.stringify(probe));
    await ctx.close();
  }

  // ---------- 3) 390px 无横向滚动 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
    check('390px 无横向滚动', sw <= 390, `scrollWidth=${sw}`);
    await ctx.close();
  }

  // ---------- 4) 骨架屏 + 小字已删 + tooltip 纯净 + 复制 toast ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    // 骨架屏：/devices 有 700ms 延迟，此时应可见
    const skelVisible = await page.evaluate(() => {
      const el = document.querySelector('.skel');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    check('骨架屏出现（首屏等待期）', skelVisible);
    const skelBars = await page.locator('.skelBar').count();
    check('骨架屏占位条数量', skelBars === 20, `${skelBars} 条`);
    await page.waitForSelector('tbody tr');

    const footnoteGone = await page.evaluate(() => !document.querySelector('.footnote') && !document.body.innerText.includes('正常上报周期'));
    check('脚注与「正常上报周期」小字已删', footnoteGone);
    const tipText = await page.evaluate(() => {
      const td = document.querySelector('tbody tr td:nth-child(5)');
      return td ? td.getAttribute('title') : '';
    });
    check('状态悬停提示只含纯数据', /最后心跳：\d{2}:\d{2}:\d{2}（(刚刚|\d+ (分钟|小时|天)前)）/.test(tipText), tipText);
    const leadGone = await page.evaluate(() => !document.querySelector('.lead') && !document.body.textContent.includes('直达对应控制台'));
    check('page.lead 操作指引小字已删（2026-09-16 用户要求）', leadGone);
    const emptyKey = await page.evaluate(() => !document.body.textContent.includes('设备停止上报'));
    check('empty/lead 机制说明已删', emptyKey);

    // 复制 IP toast
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('.copyBtn >> nth=0');
    await page.waitForSelector('.toast.show');
    const toastText = await page.evaluate(() => document.querySelector('.toast').textContent);
    check('复制 IP toast 正常', toastText.includes('已复制'), toastText);
    await ctx.close();
  }

  // ---------- 5) 语言切换：表头词条中英 + 选择持久化 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const zhHead = await page.evaluate(() => document.querySelector('th').textContent);
    await page.click('#lang-btn');
    const enHead = await page.evaluate(() => document.querySelector('th').textContent);
    const storedLang = await page.evaluate(() => window.localStorage.getItem('findcar.ui.lang'));
    check('语言切换：表头词条中英 + 持久化', zhHead === '名称' && enHead === 'Name' && storedLang === 'en', `${zhHead}/${enHead}/${storedLang}`);
    await ctx.close();
  }

  // ---------- 6) 轮询频率未变：5s 内应只见 1 次首取 + 第 5s 第二次 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    let hits = 0;
    page.on('request', (r) => { if (r.url().endsWith('/devices')) hits += 1; });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5600);
    check('轮询频率 ≈5s', hits >= 1 && hits <= 2, `5.6s 内 /devices 请求 ${hits} 次`);
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n== ${results.length - failed.length}/${results.length} 项通过 ==`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
