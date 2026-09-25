/* FDC Apple 象限补充验证（verify.js 未覆盖），仓库常驻、仅本地验证用，不参与部署：
 * 1) apple 象限桌面/移动端整行点击 → window.open 设备控制台 URL
 * 2) 点复制按钮不触发行跳转（原 cockpit 象限回归块已随 v1.6.0 座舱移除一并删除）
 * 3) 复制成功绿勾（.copied + icoCheck 可见，1.2s 后自动消失）、
 *    刷新转环（.loading + btnSpin 可见，完成后复位回「刷新」）
 * 4) 空态（stub-empty.py）/ 错误态（stub-error.py）/ toast 胶囊 / 转环 截图 → .verify/shots/
 * 5) 2026-09-18 Apple 深化：语义色文字对比度（页内实算 WCAG）、44×44 命中区、
 *    3px 不透明聚焦环与「聚焦不改填充」、prefers-reduced-motion / -transparency /
 *    contrast:more / forced-colors（CDP Emulation 实跑，非 grep 源码）、
 *    错误态本地化文案与横幅对比度、轮询不摧毁焦点、行键盘可达、离线链接不可点、
 *    骨架不跳动、刷新按钮宽度稳定、toast 宽度/多行圆角、meta theme-color 跟随手动切主题。
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

  // 2)（原 cockpit 回归块已随 v1.6.0 座舱移除一并删除）

  // 3) apple 移动端整行点击
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
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


  // ==================================================================
  // 5) 2026-09-18 Apple 深化（第五轮）：对比度 / 命中区 / 聚焦环 / 兜底 / 行为
  // ==================================================================

  // 页内实算：逐层 alpha 合成到最近不透明祖先底色后的 WCAG 对比度
  const CONTRAST_FN = function (sel) {
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const comp = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b), hi = Math.max(l1, l2), lo = Math.min(l1, l2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
    const el = document.querySelector(sel);
    if (!el) return null;
    let layers = [], n = el;
    while (n && n.nodeType === 1) { layers.push(parse(getComputedStyle(n).backgroundColor)); n = n.parentElement; }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) { const c = layers[i]; if (!c || c.a === 0) continue; bg = c.a >= 1 ? { r: c.r, g: c.g, b: c.b, a: 1 } : comp(c, bg); }
    let op = 1, m = el;
    while (m && m.nodeType === 1) { op *= parseFloat(getComputedStyle(m).opacity); m = m.parentElement; }
    const raw = parse(getComputedStyle(el).color);
    const fg = comp({ r: raw.r, g: raw.g, b: raw.b, a: raw.a * op }, bg);
    return { ratio: ratio(fg, bg), color: getComputedStyle(el).color, fontSize: getComputedStyle(el).fontSize };
  };

  // 以中心为原点在 ±21px 采样：9 点全命中自身才算 44×44 命中区
  const HIT_FN = function (arg) {
    const sel = arg.sel, d = arg.d;
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pts = [[0, 0], [-d, 0], [d, 0], [0, -d], [0, d], [-d, -d], [d, d], [-d, d], [d, -d]];
    const miss = [];
    for (const [dx, dy] of pts) {
      const hit = document.elementFromPoint(Math.round(cx + dx), Math.round(cy + dy));
      if (!hit || !(hit === el || el.contains(hit))) miss.push(dx + ',' + dy + '→' + (hit ? hit.tagName.toLowerCase() : 'null'));
    }
    return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, miss };
  };

  // 5.1 浅色语义色文字：在线绿字不再用系统填充色（2.22 → ≥4.5）
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: 'light', locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const c = await page.evaluate(CONTRAST_FN, '.status-online');
    check('浅色 .status-online 对比度 ≥4.5（语义色文字变体）', c && c.ratio >= 4.5, c ? `${c.ratio}:1 ${c.color} ${c.fontSize}` : 'no node');
    const th = await page.evaluate(CONTRAST_FN, 'thead th');
    const seen = await page.evaluate(CONTRAST_FN, '.last-seen');
    check('浅色结构性文字 th ≥4.5、纯 meta .last-seen ≥3.4', th && th.ratio >= 4.5 && seen && seen.ratio >= 3.4,
      `th=${th && th.ratio} last-seen=${seen && seen.ratio}`);
    // 圆钮底色（rgba(118,118,128,.12) 叠在画布上）比画布更暗：--btn-text 提到 .80
    const lang = await page.evaluate(CONTRAST_FN, '#lang-btn');
    const themeBtn = await page.evaluate(CONTRAST_FN, '#theme-btn');
    check('浅色圆钮文字 ≥4.5（语言/主题；底比画布暗，.72 时只有 4.21）',
      lang && lang.ratio >= 4.5 && themeBtn && themeBtn.ratio >= 4.5,
      `lang=${lang && lang.ratio} theme=${themeBtn && themeBtn.ratio}`);
    const bell = await page.evaluate(CONTRAST_FN, '#bell-btn');
    check('浅色铃铛不可用态（禁用，带斜杠铃图标）仍 ≥3:1', bell && bell.ratio >= 3,
      `bell(off)=${bell && bell.ratio}`);
    await ctx.close();
  }

  // 5.2 工具条 meta / 版本徽标（浅 ≥3.4、深 ≥4.5）
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: theme, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const upd = await page.evaluate(CONTRAST_FN, '#updated');
    const ver = await page.evaluate(CONTRAST_FN, '.version');
    const need = theme === 'light' ? 3.4 : 4.5;
    check(`${theme === 'light' ? '浅' : '深'}色 #updated ≥${need} 且 .version ≥${need}`,
      upd && upd.ratio >= need && ver && ver.ratio >= need, `#updated=${upd && upd.ratio} .version=${ver && ver.ratio}`);
    await ctx.close();
  }

  // 5.3 命中区 44×44：圆钮（1280 / 390）
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const round = {};
    for (const sel of ['#theme-btn', '#lang-btn', '#bell-btn']) round[sel] = await page.evaluate(HIT_FN, { sel, d: 21 });
    const bad = Object.keys(round).filter((k) => !round[k] || round[k].miss.length);
    check(`${width}px 圆钮命中区 44×44（±21px 九点全命中）`, bad.length === 0,
      bad.length ? bad.map((k) => `${k}:${(round[k] || {}).miss}`).join(' ') : `${round['#bell-btn'].w}×${round['#bell-btn'].h} 可见 / 44×44 命中`);
    await ctx.close();
  }

  // 5.4 命中区 44×44：复制键（且不与同行 IP 链接的命中区重叠）、主按钮、主题按钮
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const copy = await page.evaluate(HIT_FN, { sel: '.copyBtn', d: 21 });
    check('复制键命中区 44×44（26px 可见 + ::after，不吞同行链接点击）', copy && copy.miss.length === 0,
      copy ? `${copy.w}×${copy.h} 可见 miss=${copy.miss}` : 'no node');
    const gap = await page.evaluate(() => {
      const a = document.querySelector('td.mono a').getBoundingClientRect();
      const b = document.querySelector('.copyBtn').getBoundingClientRect();
      return { gap: Math.round((b.left - a.right) * 100) / 100, copyCenterX: b.left + b.width / 2, copyCenterY: b.top + b.height / 2, linkRight: a.right };
    });
    // 复制键命中区左缘 = 中心 -22，必须落在 IP 链接可见右缘之外
    check('复制键与 IP 链接可见间距 ≥8px 且命中区不压链接', gap.gap >= 8 && gap.copyCenterX - 22 >= gap.linkRight,
      `可见间距 ${gap.gap}px，命中区左缘 ${Math.round(gap.copyCenterX - 22)} vs 链接右缘 ${Math.round(gap.linkRight)}`);
    const primary = await page.evaluate(HIT_FN, { sel: '#search-btn', d: 21 });
    check('主按钮命中区 ≥44×44（高 44）', primary && primary.miss.length === 0 && primary.h >= 44, primary ? `${primary.w}×${primary.h}` : 'no node');
    const themeBtn = await page.evaluate(HIT_FN, { sel: '.themeButton', d: 21 });
    check('主题按钮命中区 44×44（可见尺寸不变 + ::after 扩展）', themeBtn && themeBtn.miss.length === 0, themeBtn ? `${themeBtn.w}×${themeBtn.h} miss=${themeBtn.miss}` : 'no node');
    await ctx.close();
  }

  // 5.5 聚焦环：3px 不透明；聚焦不改主按钮填充（与 hover 分开）
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: theme, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    // 真实 Tab 到主按钮
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.mouse.move(2, 2);
    let focused = false;
    for (let i = 0; i < 30 && !focused; i += 1) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement && document.activeElement.id === 'search-btn');
    }
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      const m = cs.outlineColor.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(/[,\s\/]+/).filter(Boolean).map(Number) : [];
      return {
        width: cs.outlineStyle === 'none' ? '0px' : cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor,
        alpha: parts.length > 3 ? parts[3] : 1, offset: cs.outlineOffset, bg: cs.backgroundColor,
      };
    });
    check(`${theme === 'light' ? '浅' : '深'}色 :focus-visible 环 3px 且不透明`, focused && ring.width === '3px' && ring.style === 'solid' && ring.alpha === 1,
      JSON.stringify(ring));
    const base = await page.evaluate(() => {
      const el = document.querySelector('#search-btn');
      const keep = el.style.background;
      el.style.background = 'none';
      const v = getComputedStyle(el).backgroundColor;
      el.style.background = keep;
      el.blur();
      return v;
    });
    await page.hover('#search-btn');
    await page.waitForTimeout(320);
    const hover = await page.evaluate(() => getComputedStyle(document.querySelector('#search-btn')).backgroundColor);
    check(`${theme === 'light' ? '浅' : '深'}色聚焦不改主按钮填充（focus=base≠hover）`, ring.bg === base && ring.bg !== hover,
      `focus=${ring.bg} base=${base} hover=${hover}`);
    await ctx.close();
  }

  // 5.6 兜底媒体特性：CDP Emulation 实跑（page.emulateMedia 对 reduced-transparency 不生效，用 CDP）
  const MEDIA_FEATURES = [
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'prefers-reduced-transparency', value: 'reduce' },
    { name: 'prefers-contrast', value: 'more' },
    { name: 'forced-colors', value: 'active' },
  ];
  const mediaRead = function () {
    const g = (s) => getComputedStyle(document.querySelector(s));
    return {
      dotAnim: g('.dot.online').animationName,
      skelAnim: (() => { const el = document.querySelector('.skelBar'); return el ? getComputedStyle(el).animationName : 'none'; })(),
      btnTrans: g('.themeButton').transitionDuration,
      headerBg: g('.headerRow').backgroundColor, headerBlur: g('.headerRow').backdropFilter,
      toastBg: g('.toast').backgroundColor, toastBlur: g('.toast').backdropFilter,
      panelBorder: g('.panelCard').borderTopWidth + ' ' + g('.panelCard').borderTopColor,
      updated: g('#updated').color,
      dotBorder: g('.dot.online').borderTopWidth + ' ' + g('.dot.online').borderTopColor,
      trBorder: (() => { const el = document.querySelector('tbody tr + tr'); return el ? getComputedStyle(el).borderTopWidth + ' ' + getComputedStyle(el).borderTopColor : 'none'; })(),
      trBgImage: (() => { const el = document.querySelector('tbody tr + tr'); return el ? getComputedStyle(el).backgroundImage.slice(0, 30) : 'none'; })(),
      mq: {
        rm: matchMedia('(prefers-reduced-motion: reduce)').matches,
        rt: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        cm: matchMedia('(prefers-contrast: more)').matches,
        fc: matchMedia('(forced-colors: active)').matches,
      },
    };
  };
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: 'dark', locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const cdp = await ctx.newCDPSession(page);
    const base = await page.evaluate(mediaRead);
    const emulate = async (feature) => {
      await cdp.send('Emulation.setEmulatedMedia', {
        features: MEDIA_FEATURES.map((f) => ({ name: f.name, value: f.name === feature ? f.value : 'no-preference' })),
      });
      await page.waitForTimeout(400);
      return page.evaluate(mediaRead);
    };
    const rm = await emulate('prefers-reduced-motion');
    check('prefers-reduced-motion 实跑生效（脉冲/骨架停、过渡缩到 0.01ms）',
      rm.mq.rm && base.dotAnim !== 'none' && rm.dotAnim === 'none' && rm.skelAnim === 'none' && parseFloat(rm.btnTrans) < 0.001,
      `dot ${base.dotAnim}→${rm.dotAnim} skel ${base.skelAnim}→${rm.skelAnim} transition ${base.btnTrans}→${rm.btnTrans}`);
    const rt = await emulate('prefers-reduced-transparency');
    check('prefers-reduced-transparency 实跑生效（材质退实色、去模糊）',
      rt.mq.rt && base.headerBlur !== 'none' && rt.headerBlur === 'none' && rt.toastBlur === 'none' && rt.headerBg.startsWith('rgb('),
      `header blur ${base.headerBlur}→${rt.headerBlur} / ${base.headerBg}→${rt.headerBg}`);
    const cm = await emulate('prefers-contrast');
    check('prefers-contrast: more 实跑生效（文字提级 / 卡片 1px 描边 / 材质退实色）',
      cm.mq.cm && cm.panelBorder.startsWith('1px') && cm.updated !== base.updated && cm.headerBlur === 'none',
      `border ${base.panelBorder}→${cm.panelBorder} / #updated ${base.updated}→${cm.updated}`);
    const fc = await emulate('forced-colors');
    check('forced-colors: active 实跑生效（CanvasText 画回分隔线与状态点）',
      fc.mq.fc && fc.dotBorder.startsWith('1px') && fc.trBorder.startsWith('1px') && fc.trBgImage === 'none',
      `dot ${base.dotBorder}→${fc.dotBorder} / 行分隔 ${base.trBorder}→${fc.trBorder}`);
    await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [] });
    await ctx.close();
  }

  // 5.7 轮询（5s）不摧毁键盘焦点 + 行 tabindex/Enter 可达
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    await ctx.addInitScript(() => {
      window.__opened = [];
      window.open = function (url) { window.__opened.push(String(url)); return null; };
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const rowAttr = await page.evaluate(() => {
      const tr = document.querySelector('tbody tr');
      return { tabIndex: tr.tabIndex, hasAttr: tr.hasAttribute('tabindex') };
    });
    await page.locator('tbody tr').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const opened = await page.evaluate(() => window.__opened);
    check('设备行键盘可达（tabindex=0 + Enter 打开控制台）',
      rowAttr.tabIndex === 0 && rowAttr.hasAttr && opened.length === 1 && opened[0] === 'http://192.168.1.46/', JSON.stringify({ rowAttr, opened }));
    await page.locator('.copyBtn').first().focus();
    await page.waitForTimeout(5800);   // 5s 轮询至少跑一轮
    const after = await page.evaluate(() => ({
      tag: document.activeElement.tagName, cls: document.activeElement.className,
      isCopy: !!(document.activeElement.closest && document.activeElement.closest('.copyBtn')),
    }));
    check('5s 轮询不摧毁焦点（焦点仍在复制的按钮上）', after.isCopy && after.tag === 'BUTTON', JSON.stringify(after));
    await ctx.close();
  }

  // 5.8 离线行：IP 链接 aria-disabled 且不跳转，只给离线 toast
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, locale: 'zh-CN' });
    await ctx.route('**/devices', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ devices: [
        { device_id: 'mus4-esp', type: 'esp32', lan_ip: '192.168.1.46', port: 80, hostname: 'mus4-esp', version: 'v1.8.78', online: true, last_seen_epoch_ms: Date.now() - 20000 },
        { device_id: 'garage-esp', type: 'esp32', lan_ip: '192.168.1.77', port: 80, hostname: 'garage-esp', version: 'v1.7.2', online: false, last_seen_epoch_ms: Date.now() - 5 * 3600 * 1000 },
      ] }),
    }));
    const page = await ctx.newPage();
    let popups = 0;
    ctx.on('page', () => { popups += 1; });
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr.offline');
    const info = await page.evaluate(() => {
      const a = document.querySelector('tbody tr.offline td.mono a');
      return { aria: a.getAttribute('aria-disabled'), tabIndex: a.tabIndex, color: getComputedStyle(a).color };
    });
    // aria-disabled 的链接 Playwright 拒绝 click()（交互层面已不可用），用坐标点按验证真实鼠标行为
    const box = await page.locator('tbody tr.offline td.mono a').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const toast = await page.evaluate(() => document.getElementById('toast').textContent);
    check('离线行 IP 链接 aria-disabled 且不跳转（改走离线 toast）',
      info.aria === 'true' && info.tabIndex === -1 && popups === 0 && toast.includes('离线'),
      JSON.stringify({ ...info, popups, toast }));
    await ctx.close();
  }

  // 5.9 错误态：本地化词条、不回显后端原文、空面板收起
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: 'light', locale: 'zh-CN' });
    const page = await ctx.newPage();
    const warns = [];
    page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
    await page.goto(`http://127.0.0.1:${PORT_ERROR}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const info = await page.evaluate(() => {
      const p = document.querySelector('.panelCard');
      const r = p.getBoundingClientRect();
      return { status: document.getElementById('status').textContent, hidden: !!p.hidden, display: getComputedStyle(p).display, area: Math.round(r.width * r.height), body: document.body.innerText };
    });
    const banner = await page.evaluate(CONTRAST_FN, '.banner');
    check('错误横幅文字对比度 ≥4.5（浅色；系统红 #ff3b30 仅 2.94:1）',
      banner && banner.ratio >= 4.5, banner ? `${banner.ratio}:1 ${banner.color}` : 'no node');
    check('错误态本地化文案（不含后端原文 KV unavailable）且不显示空面板',
      info.status.length > 0 && !info.body.includes('KV unavailable') && !/^[A-Za-z]/.test(info.status) &&
      info.hidden && info.display === 'none' && info.area === 0 && warns.some((w) => w.includes('KV unavailable')),
      JSON.stringify({ status: info.status, panel: info.display, warn: warns[0] }));
    await ctx.close();
  }

  // 5.10 骨架屏不跳动（工具条 meta 行同时占位、按上次设备数占位行数）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'domcontentloaded' });
    const during = await (async () => {
      for (let i = 0; i < 30; i += 1) {
        const s = await page.evaluate(() => {
          const skel = document.querySelector('.skel');
          if (!skel) return null;
          const r = document.querySelector('.panelCard').getBoundingClientRect();
          return { y: Math.round(r.y * 100) / 100, h: Math.round(r.height * 100) / 100, rows: skel.querySelectorAll('.skelRow').length, meta: document.getElementById('updated').textContent };
        });
        if (s) return s;
        await page.waitForTimeout(60);
      }
      return null;
    })();
    await page.waitForSelector('tbody tr');
    await page.waitForTimeout(200);
    const content = await page.evaluate(() => {
      const r = document.querySelector('.panelCard').getBoundingClientRect();
      return { y: Math.round(r.y * 100) / 100, h: Math.round(r.height * 100) / 100, rows: document.querySelectorAll('tbody tr').length };
    });
    // 骨架换成内容：面板 y 不移位（工具条 meta 行已占位），高度也按设备数对齐（390 = 卡片 166px/台）
    check('390 骨架→内容不跳动（meta 行占位、y 位移 0、高度差 ≤24px、行数按上次设备数）',
      !!during && during.meta.length === 1 && Math.abs(content.y - during.y) <= 1 && Math.abs(content.h - during.h) <= 24,
      JSON.stringify({ during, content, jumpY: during ? Math.round((content.y - during.y) * 100) / 100 : null, jumpH: during ? Math.round((content.h - during.h) * 100) / 100 : null }));
    await ctx.close();
  }

  // 5.11 刷新按钮宽度稳定（meta 不位移）+ toast 宽度/多行圆角 + meta theme-color 跟随主题
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 }, colorScheme: 'dark', locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    const idle = await page.evaluate(() => {
      const b = document.querySelector('#search-btn').getBoundingClientRect();
      const m = document.getElementById('updated').getBoundingClientRect();
      return { w: Math.round(b.width * 100) / 100, metaX: Math.round(m.x * 100) / 100 };
    });
    await page.click('#search-btn');
    await page.waitForTimeout(250);
    const loading = await page.evaluate(() => {
      const b = document.querySelector('#search-btn').getBoundingClientRect();
      const m = document.getElementById('updated').getBoundingClientRect();
      return { w: Math.round(b.width * 100) / 100, metaX: Math.round(m.x * 100) / 100, label: document.querySelector('.btnLabel').textContent };
    });
    check('刷新按钮宽度固定（刷新/查找中… 等宽，meta 不位移）',
      Math.abs(loading.w - idle.w) <= 0.5 && Math.abs(loading.metaX - idle.metaX) <= 0.5,
      `${idle.w} → ${loading.w}（meta ${idle.metaX} → ${loading.metaX}）`);
    // meta theme-color 跟随手动切主题（切前系统深色 = #000000）
    const before = await page.evaluate(() => document.querySelector('meta[name=theme-color]').content);
    await page.click('#theme-btn');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 2000 });
    await page.waitForTimeout(400);   // 等 320ms 主题交叉淡化结束，取值稳定
    const after = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      metas: Array.from(document.querySelectorAll('meta[name=theme-color]')).map((m) => m.content),
    }));
    check('手动切主题后 meta[name=theme-color] 跟随（系统深色 → 手动浅色）',
      before === '#000000' && after.theme === 'light' && after.metas.every((c) => c === '#f5f5f7'), JSON.stringify({ before, after }));
    await ctx.close();
  }

  // 5.12 toast：长文案不再被 50vw 卡死；多行内容 16px 圆角（走真实 push 拒绝分支）
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
    await ctx.addInitScript(() => {
      localStorage.setItem('findcar.ui.lang', 'en');
      function N() {}
      N.permission = 'denied';
      N.requestPermission = function () { return Promise.resolve('denied'); };
      Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: N });
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT_MAIN}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('tbody tr');
    await page.click('#bell-btn');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'), null, { timeout: 3000 });
    const g = await page.evaluate(() => {
      const el = document.getElementById('toast');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100, x: Math.round(r.x), radius: cs.borderRadius, maxWidth: cs.maxWidth, cls: el.className, text: el.textContent };
    });
    check('toast 长文案宽度可达（>195px，不再被 50vw 卡死）且多行用 16px 圆角',
      g.w > 195 && g.w <= 354.5 && g.x >= 17 && g.h > 52 && g.radius === '16px' && g.cls.includes('multiline'),
      JSON.stringify(g));
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter(r => !r).length;
  console.log(`\n== ${results.length - failed}/${results.length} 项通过 ==`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
