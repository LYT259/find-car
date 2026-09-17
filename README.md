# Find Car — Cloudflare Pages（Functions + 静态页）

「一键找车」：ESP32 小车（Drifter Console）与 DonkeyDrifter 主机各自周期性把局域网信息
上报到 Cloudflare Pages Functions，网页（<https://find-dkc.pages.dev/>）打开即列出
设备及其局域网 IP，点 IP 直达对应控制台。**去 token、公开上报与查询。**

主机侧上报由**常驻 launcher 服务**（`donkeycar/launcher/server.py`，systemd 用户服务
`donkeydrifter-launcher.service`）负责：只要开机就能被找到，不再依赖按需启动的 DD Web。
上报端口动态取值——DD Web 实例存活时报其实际端口（点 IP 直达 DD 控制台），否则报
launcher 自身端口 8090（点 IP 落到 launcher 菜单页，可一键「打开 DonkeyDrifter」）。

## 文件

- `functions/report.js` — Pages Function：`POST /report` 写 KV（设备「旧不在线 → 新在线」跳变时
  后台扇出 Web Push 上线提醒，见「协议」推送小节）
- `functions/devices.js` — Pages Function：`GET /devices` 读 KV 列出设备
- `functions/push/` — Pages Function：Web Push 端点（`key.js` VAPID 公钥 / `subscribe.js` 订阅 /
  `unsubscribe.js` 退订）
- `public/index.html` — 静态页（单文件、无构建、无框架、移动端友好，5s 自动刷新；座舱 / Apple
  双风格 + 深浅色 + 中英双语，见下「UI 约定」）
- `public/manifest.webmanifest` — PWA 清单（standalone 显示、图标、主题色，「添加到主屏幕」用）
- `public/_headers` — Pages 静态安全响应头（nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy）
- `public/sw.js` — Service Worker：`push` 事件弹系统通知，`notificationclick` 聚焦已开页面或新开首页
- `public/favicon.png` — 标签页图标（与 DD `web_ui/frontend/public/favicon.png`、DC
  `Firmware/MUS4_FW/libraries/mus4_web/src/WebConsoleFavicon.h` 内的同一张 200x200 helmet logo，
  三处 md5 一致）
- `wrangler.toml` — Pages 配置（KV binding `FIND_CAR_KV`）
- `worker.js` — 早期 token 版 Worker 实现，**已废弃**（现网走 Pages Functions，保留仅供参考）
- `.verify/verify-extra.js` — Apple 象限补充验证（10 项；配 `stub-empty.py` 8098 空态桩 /
  `stub-error.py` 8097 错误态桩）
- `.verify/push-unit.mjs` — 推送端点纯 Node 单测（node ≥ 18，无浏览器无网络，VAPID 密钥对现场生成）
- `.github/workflows/verify.yml` — CI：push 到 `main` 时自动跑 `verify.js` + `verify-extra.js`
- `README.md` — 本说明

## 部署

```bash
npx wrangler pages deploy public --project-name find-dkc
```

（Pages 项目名 `find-dkc`；Functions 与静态资源一次部署。）

## UI 约定（座舱 / Apple 双风格）

页面支持两套界面风格，页头分段切换器（`座舱 / Apple`）即时切换，选择写入
`localStorage['findcar.ui.style']`（值 `cockpit` | `apple`，**默认 `apple`**，首屏内联脚本解析防闪烁）；
`<html data-ui>` 为风格开关，`<html data-theme>` 仍为深浅色开关，两者正交。

- **座舱象限（`data-ui="cockpit"`）**：与 DonkeyDrifter（DD，`web_ui/frontend/src/themes/theme-mus4.css` /
  `theme-light.css`）和 Drifter Console（DC，`libraries/mus4_web/src/WebConsoleAssets.h`）逐值对齐的原始皮肤，
  即 `:root` 与 `html[data-theme="light"]` 两个变量块，保持原值不动：深色页面 `#101318`、面板 `#171c24`、
  描边 `#2b3441`/`#344154`；浅色页面 `#eef1f5`、面板 `#fff`、描边 `#d5dce4`/`#ccd5df`；强调色 FILL `#5cc8ff`
  （近黑字 `#061019`），状态色 绿 `#39d98a` / 琥珀 `#ffcc66` / 红 `#ff6b6b` / 灰 `#475569`（浅色取 DC 浅色版）；
  面板 10px 圆角 + 1px 细框 + 135deg 渐变，控件 9999px 胶囊，微标签 11–12px 大写 + `.08em` 字距。
- **Apple 象限（`data-ui="apple"`，默认）**：仅新增 `html[data-ui="apple"]` 与
  `html[data-ui="apple"][data-theme="light"]` 两个变量覆写块 + 一组同选择器前缀的细修规则，不碰座舱值。
  浅色 canvas `#f5f5f7` / surface `#fff` / ink `#1d1d1f` / accent `#0066cc`（fill `#0071e3`）/
  状态色 `#34c759` `#ff9500` `#ff3b30` `#8e8e93`；深色 canvas `#000` / surface `#1c1c1e` / `#2c2c2e` /
  ink `#f5f5f7` / accent `#2997ff`（fill `#0a84ff`）/ 状态色 `#30d158` `#ff9f0a` `#ff453a` `#636366`；
  分隔一律 1px hairline（`rgba(0,0,0,.08)` / `rgba(255,255,255,.10)`）。卡片去渐变去投影改 hairline +
  16–18px 圆角；控件 8–10px、胶囊 9999px；字重只用 400/600；标题 `-0.02em` 负字距 600 字重；
  数字 `tabular-nums`；按钮按下 `scale(.97)` 100ms；行增删/状态变化 200ms `cubic-bezier(.32,.72,0,1)`；
  首屏呼吸骨架屏（1.2s 周期，仅 Apple 象限注入）。
  2026-09-16 第二轮全面细修：吸顶页头改 iOS 导航栏材质（半透明 + `backdrop-filter` 背景模糊 + 底部
  hairline，负边距拉通到页面边缘；`prefers-reduced-transparency` 时退实色不模糊）；分组卡去描边改
  inset-grouped 纯底色对比；设备行整行可点击直达对应控制台（行右缘 chevron 暗示、行按压反馈，
  点在链接/按钮上或划选文本时不触发，座舱象限行不可点保持原样），IP 链接带「打开 Drifter Console /
  DonkeyDrifter」悬停提示；在线状态点 2.4s 呼吸脉冲光环；空态带居中信号图标；主题切换 320ms
  交叉淡化；`prefers-reduced-motion` 下关闭脉冲/骨架呼吸/行动画、过渡缩至近乎即时。
  2026-09-17 第三轮：主按钮改全圆角胶囊（9999px），手动刷新时显示 iOS 活动指示器转环
  （reduced-motion 下保留——属状态反馈非装饰）；行分隔线改 tr 背景渐变的 inset-grouped 同款
  （左缩 14px 对齐文字、右缘贯通，桌面表格与移动卡片同一条规则，替代 td 下边框）；toast 改底部
  居中半透明胶囊（`backdrop-filter` 模糊，`prefers-reduced-transparency` 退实色）；复制成功时按钮
  图标短暂变绿勾 1.2s；`:focus-visible` 改 3px 半透明 accent 聚焦环；表格字号 14→15px；补
  `-webkit-tap-highlight-color: transparent` 与 `-webkit-text-size-adjust: 100%`。
  2026-09-17 第四轮：离线设备行不再整行跳转（离线时控制台必不可达——恢复默认指针、收编右缘
  chevron、行按压不染色，整行点击只 toast「设备离线，控制台当前不可达」；行内 IP 链接仍可显式
  点按）；吸顶页头底部 hairline 改为滚离顶部（`scrollY > 2`，JS 加 `.scrolled` 类）才浮现，顶部
  透明、.2s 淡入（apple.com 同款）；补 PWA 清单（`manifest.webmanifest`，「添加到主屏幕」后独立
  窗口运行）与随系统深浅色的 `theme-color`、OG/Twitter 分享 meta；页头新增「上线提醒」铃铛圆钮
  （Web Push 订阅开关，与主题/语言圆钮同一套按钮语言：订阅开启态染 accent 色，不可用/权限被
  拒绝态呈半透明斜杠铃，不支持 PushManager 的浏览器——含未「添加到主屏幕」的 iOS Safari——
  直接隐藏不占位）。
- **页头**：左侧 32px 圆角 logo（同一张 helmet logo，点进官网）+ 标题；右侧风格分段切换器、页面版本徽标、
  GitHub 图标链接、上线提醒铃铛圆钮（32px，Web Push 订阅开关）、深浅色圆钮（32px）、语言圆钮
  （32px，显示 `中` / `EN`）。Apple 象限下切换器呈 iOS 分段
  控件样（灰底圆角胶囊轨道 + 白色/灰选中滑块），座舱象限下沿用座舱按钮语言。版本徽标样式同 DD
  `VersionBadge` / DC `.version`，当前 `v1.4.0`；改动本页时同步递增 `index.html` 里的 `#page-version`。
- **深浅色**：默认跟随系统 `prefers-color-scheme`（首屏内联脚本防闪烁），手动切换只在当前页面
  视图内生效（不持久化），刷新后重新跟随系统——与 DD `ThemeSwitcher` / DC `themeButton` 一致。
- **语言**：`zh` / `en` 全量词条，首次访问跟随浏览器语言（`zh*` → 中文，其余英文），手动切换写入
  `localStorage['findcar.ui.lang']`（DD 为 `donkeydrifter.ui.lang`、DC 为 `mus4.ui.lang`，同命名惯例），
  并同步 `<html lang>` 与 `<html data-theme>`。
- **列表文案**：`设备类型` 列显示人能看懂的身份——ESP32 设备显示「ESP32 小车」，DD 后端显示
  「<系统> 主机」（如「Ubuntu 26.04 LTS 主机」）；主板型号（如 ADL-N）只出现在悬停提示里。
  状态列：心跳仍在正常上报周期内显示「刚刚」，超出周期才显示「N 分钟未上报」，离线显示「N 分钟前」。
  **页面不放解释性小字**：连最后一句 lead 操作指引（「点局域网 IP 直达对应控制台。」）也已删除
  （2026-09-16 用户要求），机制说明
  （上报周期、自动刷新节奏、「刚刚」定义等）不进 UI；状态悬停提示只含纯数据（最后心跳时刻）。
- **其它**：局域网 IP 可点开控制台（Apple 象限整行皆可点），旁边 26px 复制按钮复制 `IP:端口` 并弹出
  toast（`已复制 …`）；工具条显示「刷新于 HH:MM:SS · N/M 在线」。
- **图标缓存**：`<link rel="icon">` 带 `?v=2` 版本参数。Chrome 会长期缓存 favicon 的旧图/404，
  不带参数时硬刷新也可能不重新请求，导致「页面上看不到图标」。
- **本地验证**：`backups/`（不入部署）存座舱原版备份；`.verify/` 内有桩服务（`stub.py`，8099 端口
  映射 `/devices`）与 Playwright 脚本（`verify.js` 本地 17 项 / `verify-online.js` 线上 7 项），
  含座舱象限计算样式与备份版逐值对比。本地跑法：

  ```bash
  python3 .verify/stub.py &          # 主桩 8099（另起 stub-empty.py 8098 空态 / stub-error.py 8097 错误态）
  NODE_PATH=<playwright 所在 node_modules> node .verify/verify.js        # 17 项：截图矩阵 + 座舱逐值对比 + 行为
  NODE_PATH=<playwright 所在 node_modules> node .verify/verify-extra.js  # 10 项：整行跳转 / 绿勾 / 转环 / 空错态截图
  node .verify/push-unit.mjs         # 推送端点纯 Node 单测（node ≥ 18，无浏览器无网络）
  ```

  push 到 `main` 时 `.github/workflows/verify.yml` 自动跑 `verify.js` + `verify-extra.js`
  （CI 置 `FDC_CI=1` 用 Playwright 自带 chromium，本地默认用本机 Chrome）。

## 协议

- `POST /report`，body 为 JSON：

  ```json
  {"device_id":"<稳定标识>","type":"esp32|dd","lan_ip":"192.168.1.100","port":8000,
   "hostname":"mus4-esp","version":"v1.8.78","model":"ADL-N","os":"Ubuntu 26.04 LTS",
   "state":"online|offline"}
  ```

  写 KV：键 `dev:<device_id>`，值 = 上述字段（另附 `last_seen_epoch_ms`）。
  `state` 省略即 `online`；`offline` 由 launcher 服务关停（systemctl stop / 关机）
  时发一次，查询端立即显示「离线」。TTL：`online` 900 秒、`offline` 600 秒。
  成功返回 200 `{"ok":true}`。

- `GET /devices` → 200：

  ```json
  {"devices":[{"device_id":"...","type":"esp32|dd","lan_ip":"...","port":8000,"hostname":"...",
   "version":"...","model":"ADL-N","os":"Ubuntu 26.04 LTS","state":"online",
   "last_seen_epoch_ms":1720000000000,"online":true}]}
  ```

  在线判定：`state !== "offline"` 且 `Date.now() - last_seen_epoch_ms <` 该类型的在线窗口
  （`dd` 5.5 分钟、`esp32` 8 分钟，均大于各自心跳间隔，容忍漏跳一次）。
  排序：在线优先，其次 hostname / device_id。

- 所有响应带 CORS 头；`OPTIONS` 预检返回 204；其它路径 404；参数缺失/JSON 解析失败 400；异常 500。

### 设备上线提醒（Web Push）

- `GET /push/key` → 200 `{"key":"<VAPID 公钥 base64url>"}`；未配置时 503（前端据此把铃铛置灰）。
- `POST /push/subscribe`，body = PushSubscription JSON
  （`{"endpoint":"https://…","keys":{"p256dh":"…","auth":"…"}}`）→ 200 `{"ok":true}`；
  非法订阅 400。KV 键 `pushsub:<endpoint 的 sha256 hex>`，值 = 订阅 JSON 原文，无 TTL
  （直到退订或推送失效被清理）。
- `POST /push/unsubscribe`，body `{"endpoint":"https://…"}` → 200 `{"ok":true}`（幂等：键不存在也 200）。
- **扇出时机**：`POST /report` 时设备「旧不在线 → 新在线」跳变，KV 写完后经 `waitUntil` 后台向全部
  `pushsub:` 订阅发**无负载 tickle**（不带 body、不加密，Authorization 头为 VAPID JWT，ES256）；
  订阅失效（404/410）顺手删 KV 键；推送的任何失败都被吞掉，绝不影响 `/report` 响应。
- VAPID 密钥只存在于 Cloudflare Pages secrets：`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`，由
  `wrangler pages secret put` 配置，**仓库零密钥材料**。

## 心跳节奏与 KV 免费额度

- 主机（launcher 常驻服务）：150 秒一跳（576 写/天），配置由 DD Web 的
  `/api/findcar/config` 接口读写（`~/.donkeycar_findcar.json`，launcher 每跳重读、即改即生效）。
- ESP32：300 秒一跳、上报失败 60 秒快速重试（约 288 写/天）。
- 合计约 864 写/天，低于 KV 免费层 1000 写/天的上限。
- 网页轮询 5 秒一次（后台标签页暂停），避免打满 Pages Functions 免费请求额度。
