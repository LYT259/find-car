/* FDC 双风格本地验证：
 * 1) cockpit/apple × dark/light × zh/en × 390/1280 截图（16 张）
 * 2) 座舱象限计算样式与备份版逐值一致（关键元素 × 关键属性）
 * 3) 390px 无横向滚动；小字已删；骨架屏出现；切换器可用
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
  const browser = await chromium.launch({ channel: 'chrome' });

  // ---------- 1) 截图矩阵 ----------
  for (const ui of ['apple', 'cockpit']) {
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
          await page.addInitScript(([u, l]) => {
            window.localStorage.setItem('findcar.ui.style', u);
            window.localStorage.setItem('findcar.ui.lang', l);
          }, [ui, lang]);
          await page.goto(BASE + '/', { waitUntil: 'networkidle' });
          await page.waitForSelector('tbody tr');
          await page.screenshot({ path: path.join(SHOTS, `${ui}-${theme}-${lang}-${width}.png`) });
          await ctx.close();
        }
      }
    }
  }

  // ---------- 2) 座舱象限 vs 备份版：计算样式逐值对比 ----------
  const PROPS = [
    ['body', ['background-color', 'color', 'font-size', 'line-height']],
    ['.panelCard', ['background-color', 'background-image', 'border-top-color', 'border-radius', 'box-shadow']],
    ['th', ['font-size', 'font-weight', 'text-transform', 'letter-spacing', 'color', 'border-bottom-color']],
    ['td.name', ['font-weight', 'color']],
    ['.btnPrimary', ['background-color', 'border-top-color', 'border-radius', 'font-weight', 'color']],
    ['.themeButton', ['background-color', 'border-top-color', 'border-radius', 'box-shadow']],
    ['.headerRow h1', ['font-size', 'font-weight', 'letter-spacing']],
    ['.dot.online', ['background-color']],
    ['.status-online', ['color', 'font-weight']],
    ['.toast', ['background-color', 'border-top-color', 'border-radius']],
  ];
  for (const theme of ['dark', 'light']) {
    const grab = async (url, useInit) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: theme });
      const page = await ctx.newPage();
      if (useInit) {
        await page.addInitScript(() => window.localStorage.setItem('findcar.ui.style', 'cockpit'));
      }
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('tbody tr');
      const data = await page.evaluate((props) => {
        const out = {};
        for (const [sel, names] of props) {
          const el = document.querySelector(sel);
          if (!el) { out[sel] = null; continue; }
          const cs = getComputedStyle(el);
          out[sel] = {};
          for (const n of names) out[sel][n] = cs.getPropertyValue(n);
        }
        return out;
      }, PROPS);
      await ctx.close();
      return data;
    };
    const [backup, cockpit] = await Promise.all([
      grab(BASE + '/backup/index.html', false),
      grab(BASE + '/', true),
    ]);
    let diffs = [];
    for (const [sel] of PROPS) {
      if (!backup[sel] || !cockpit[sel]) { diffs.push(`${sel}: missing`); continue; }
      for (const [, names] of PROPS.filter(p => p[0] === sel)) {
        for (const n of names) {
          if (backup[sel][n] !== cockpit[sel][n]) {
            diffs.push(`${sel}.${n}: backup=${backup[sel][n]} new=${cockpit[sel][n]}`);
          }
        }
      }
    }
    check(`座舱象限计算样式逐值一致 (${theme})`, diffs.length === 0, diffs.join(' | ') || '11 元素 × 属性全部一致');
  }

  // ---------- 3) 行为检查 ----------
  // 390px 无横向滚动（两种风格）
  for (const ui of ['apple', 'cockpit']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.addInitScript((u) => window.localStorage.setItem('findcar.ui.style', u), ui);
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const sw = await page.evaluate(() => document.scrollingElement.scrollWidth);
    check(`${ui} 390px 无横向滚动`, sw <= 390, `scrollWidth=${sw}`);
    await ctx.close();
  }

  // 小字已删 + 骨架屏 + 默认 apple + 切换器 + 持久化 + tooltip 纯净
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 } });
    const page = await ctx.newPage();
    // 不设任何 storage：默认应为 apple
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const defaultUi = await page.evaluate(() => document.documentElement.dataset.ui);
    check('默认风格为 apple', defaultUi === 'apple', `data-ui=${defaultUi}`);
    // 骨架屏：/devices 有 700ms 延迟，此时应可见
    const skelVisible = await page.evaluate(() => {
      const el = document.querySelector('.skel');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    check('骨架屏出现（apple 首屏）', skelVisible);
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

    // 切换器：点「座舱」→ data-ui 变 cockpit、localStorage 持久化、骨架隐藏
    await page.click('.uiSegBtn[data-ui-value="cockpit"]');
    const afterSwitch = await page.evaluate(() => ({
      ui: document.documentElement.dataset.ui,
      stored: window.localStorage.getItem('findcar.ui.style'),
      active: document.querySelector('.uiSegBtn[data-ui-value="cockpit"]').classList.contains('active'),
    }));
    check('切换器切到座舱并持久化', afterSwitch.ui === 'cockpit' && afterSwitch.stored === 'cockpit' && afterSwitch.active, JSON.stringify(afterSwitch));
    const skelHiddenCockpit = await page.evaluate(() => {
      const el = document.querySelector('.skel');
      return !el || getComputedStyle(el).display === 'none';
    });
    check('座舱象限骨架不显示', skelHiddenCockpit);

    // 刷新后仍座舱（持久化），主题仍跟随系统（context 默认 light? 此处未设 colorScheme → 按 no-preference 走深色）
    await page.reload({ waitUntil: 'networkidle' });
    const persisted = await page.evaluate(() => document.documentElement.dataset.ui);
    check('刷新后风格保持座舱', persisted === 'cockpit', `data-ui=${persisted}`);

    // 复制 IP toast
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('.copyBtn >> nth=0');
    await page.waitForSelector('.toast.show');
    const toastText = await page.evaluate(() => document.querySelector('.toast').textContent);
    check('复制 IP toast 正常', toastText.includes('已复制'), toastText);
    await ctx.close();
  }

  // 语言切换 + 词条（座舱段文案中英）
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const zhSeg = await page.evaluate(() => document.querySelector('.uiSegBtn[data-ui-value="cockpit"]').textContent);
    await page.click('#lang-btn');
    const enSeg = await page.evaluate(() => document.querySelector('.uiSegBtn[data-ui-value="cockpit"]').textContent);
    const storedLang = await page.evaluate(() => window.localStorage.getItem('findcar.ui.lang'));
    check('切换器词条中英切换', zhSeg === '座舱' && enSeg === 'Cockpit' && storedLang === 'en', `${zhSeg}/${enSeg}/${storedLang}`);
    await ctx.close();
  }

  // 轮询频率未变：5s 内应只见 1 次首取 + 第 5s 第二次（粗验 POLL_MS 未被改小）
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 } });
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
