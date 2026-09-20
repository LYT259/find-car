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
- `functions/push/` — Pages Function：Web Push 端点（`key.js` VAPID 公钥 / `subscribe.js` 订阅（成功即回发
  欢迎 tickle，当场证明推送链路可用）/ `unsubscribe.js` 退订；`_vapid.js` 为 report.js 与 subscribe.js
  共用的 VAPID 签名 + tickle 发送模块，下划线前缀不成路由）
- `public/index.html` — 静态页（单文件、无构建、无框架、移动端友好，5s 自动刷新；Apple 风格
  （v1.6.0 起为唯一界面风格）+ 深浅色 + 中英双语，见下「UI 约定」）
- `public/manifest.webmanifest` — PWA 清单（standalone 显示、图标、主题色，「添加到主屏幕」用）
- `public/_headers` — Pages 静态安全响应头（nosniff / Referrer-Policy / X-Frame-Options / Permissions-Policy）
- `public/sw.js` — Service Worker：`push` 事件弹系统通知，`notificationclick` 聚焦已开页面或新开首页
- `public/favicon.png` — 标签页图标（与 DD `web_ui/frontend/public/favicon.png`、DC
  `Firmware/MUS4_FW/libraries/mus4_web/src/WebConsoleFavicon.h` 内的同一张 200x200 helmet logo，
  三处 md5 一致）
- `wrangler.toml` — Pages 配置（KV binding `FIND_CAR_KV`）
- `worker.js` — 早期 token 版 Worker 实现，**已废弃**（现网走 Pages Functions，保留仅供参考）
- `.verify/verify-extra.js` — Apple 风格补充验证（33 项：整行跳转 / 绿勾 / 转环 / 空错态截图 +
  2026-09-18 新增对比度实算、44×44 命中区、聚焦环、兜底媒体特性（CDP 实跑）、错误态本地化等；配 `stub-empty.py` 8098 空态桩 /
  `stub-error.py` 8097 错误态桩）
- `.verify/push-unit.mjs` — 推送端点纯 Node 单测（node ≥ 18，无浏览器无网络，VAPID 密钥对现场生成）
- `.github/workflows/verify.yml` — CI：push 到 `main` 时自动跑 `verify.js` + `verify-extra.js`
- `README.md` — 本说明

## 部署

```bash
npx wrangler pages deploy public --project-name find-dkc
```

（Pages 项目名 `find-dkc`；Functions 与静态资源一次部署。）

## UI 约定（Apple 为唯一界面风格，v1.6.0 起座舱象限移除）

页面只有一套 Apple 界面风格。v1.6.0 起座舱象限移除：页头 `座舱 / Apple` 分段切换器与
`<html data-ui>` 风格开关一并移除，旧 `localStorage['findcar.ui.style']` 键不再被读取
（老用户残留键自动失效）；`<html data-theme>` 仍为深浅色开关。

- **Apple 风格（唯一界面风格）**：原 `html[data-ui="apple"]` 覆写层已随座舱象限移除拍平为
  唯一规则（`:root` 与 `html[data-theme="light"]` 变量块直接取 Apple 值）。
  浅色 canvas `#f5f5f7` / surface `#fff` / ink `#1d1d1f` / accent `#0066cc`（fill `#0071e3`）/
  状态色 `#34c759` `#ff9500` `#ff3b30` `#8e8e93`；深色 canvas `#000` / surface `#1c1c1e` / `#2c2c2e` /
  ink `#f5f5f7` / accent `#2997ff`（fill `#0a84ff`）/ 状态色 `#30d158` `#ff9f0a` `#ff453a` `#636366`；
  分隔一律 1px hairline（`rgba(0,0,0,.08)` / `rgba(255,255,255,.10)`）。卡片去渐变去投影改 hairline +
  16–18px 圆角；控件 8–10px、胶囊 9999px；字重只用 400/600；标题 `-0.02em` 负字距 600 字重；
  数字 `tabular-nums`；按钮按下 `scale(.97)` 100ms；行增删/状态变化 200ms `cubic-bezier(.32,.72,0,1)`；
  首屏呼吸骨架屏（1.2s 周期）。
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
  2026-09-18 第五轮（Apple 深化，一次性对齐 `APPLE-SPEC-V1`）：
  ① **语义色双轨**：新增 `--ok-text` / `--warn-text` / `--bad-text`（浅 `#1a7f37` / `#c93400` / `#d70015`，
  深 `#30d158` / `#ff9f0a` / `#ff453a`）。圆点、描边、图标底等**填充**继续用 `--ok/--warn/--bad`
  （系统色），**文字**（`.status-online`、错误横幅、复制成功绿勾、离线行文字）改用 text 变体——
  浅色在线绿字 2.22:1 → 5.08:1。主按钮填充保持 Apple 系统蓝（浅 `#0071e3` / 深 `#0a84ff`），
  这是「对齐 Apple 原生」优先于 AA 的刻意取舍（白字 4.70 / 3.65:1）。
  ② **灰阶达标**：浅色 `--text-3` .62→**.72**（4.53:1）、`--text-4` .45→**.62**（3.50:1）；深色
  `--text-4` .42→**.52**（4.93:1）；`--version-ink` 跟随 text-4。规则：结构性文字（`th`、移动端
  `td::before` 字段名、`tr.offline td`）至少 text-3，只有纯 meta（`#updated`、`.version`、`.last-seen`）
  才用 text-4；分段控件未选段是控件标签，用 text-2。深色离线状态点 `#636366`→`#8e8e93`（2.84 → 5.22:1）。
  页头圆钮底色（`rgba(118,118,128,.12)` 叠在画布上）比画布更暗，浅色 `--btn-text` .72→**.80**
  （语言钮 4.21 → 5.16:1，复制键 4.39 → 5.44:1）；铃铛不可用态 `opacity` .45→**.75**（禁用态也要读得清，2.5 → 3.15:1，
  同时保留斜杠铃图标的第二通道）。
  ③ **聚焦环不透明**：`:focus-visible` 改 `3px solid`（浅 `#0066cc` / 深 `#2997ff`）+ `outline-offset: 2px`
  （半透明环实测仅 1.86–2.31:1，非文本需 ≥3:1）；`:focus-visible` 与 `:hover` 拆开——**聚焦不再改主按钮
  填充色**（此前聚焦会把主按钮提亮一档）。行获得键盘焦点时环内缩（面板 `overflow:hidden` 会裁掉外环）。
  ④ **触控目标 ≥44×44**：`.themeButton / .langButton / .bellButton / .copyBtn / .ghLink` 用 `::after`
  铺不可见命中区（视觉尺寸不变）；`.uiSegBtn` 只在纵向扩到 44（段与段相邻，段宽 48–58 已 ≥44）；
  主按钮高 38→44。相邻冲突按「只在不相邻的轴扩展 + 可见间距 ≥8px」处理：复制键与同行 IP 链接
  可见间距 6→10px（命中区左缘落在链接右缘之外），页头控件间距 12→14px（32px 圆钮的命中区相接不互吞），
  整行点击额外做了一次命中区几何排除，落在复制键 44×44 内的点击不会触发整行跳转。
  ⑤ **iOS 控件尺寸**：分段轨道 28→32 / 段 24→28；主按钮宽度按该语言最宽标签固定
  （`min-width` 中文 118px / 英文 148px）——「刷新 → 查找中…」宽度跳变 43.98px → **0**，右侧 meta 不再位移。
  ⑥ **错误态**：非 2xx 一律映射本地化词条（`page.errorService`「服务暂时不可用，请稍后重试」），
  后端原文（如 `KV unavailable`）只 `console.warn`；错误且无上次数据时把空面板整个收起（原先留
  366×96 空白卡）。
  ⑦ **轮询不再摧毁焦点**：行签名（设备集 + 在线状态）不变时只 patch 变化的单元格文本/属性、不重挂载
  tbody；必须重挂载时按「哪台设备 + 行还是复制键」把焦点放回原处（实测 5.8s 后焦点从 BODY 变为
  仍停在复制的按钮上）。设备行补 `tabindex="0"`，Enter/Space 与点击同一行为（键盘可达）。
  ⑧ **toast**：`inset-inline: 18px; margin-inline: auto; width: fit-content; max-width: none`，
  长文案不再被 50vw 卡死（390 下 195px 3 行 → 354px 2 行），`max-width` 声明真正可达；
  多行内容自动换 16px 圆角（`.multiline`，胶囊是单行形状），单行仍是 9999px 胶囊。
  ⑨ **骨架屏不跳动**：占位块几何改成与真实列表同高（栏头行 37.5px = `th` 行高、设备行 50px、
  移动卡片 166px），行数按上次拉到的设备数（`localStorage['findcar.ui.deviceCount']` 记忆；冷启动桌面估
  3 台 = 20 条占位条、移动估 2 台），并同时占住工具条 meta 行——390 首屏位移 +18px / 高度 +202px →
  **0 / 0**。
  ⑩ **离线行链接**：改 `aria-disabled="true"` + `tabindex="-1"`，点按只给离线 toast、不跳不可达控制台，
  颜色从 text-4 提到 text-3。
  ⑪ **chevron 图标化**：行右缘指示符由 `content:"›"` 文本字符（浅色 2.40:1、字重不受控）换成
  13px SVG 掩膜图标（`--chevron` + `mask-image`，色取 text-3／hover 提为 text-2）。
  ⑫ **行反馈**：hover `rgba(255,255,255,.045)→.06`、按压 `.09→.11`（浅色 `.03→.05` / `.055→.08`）；
  IP 链接补自身 `:active`（opacity .6），不再只有整行染色。
  ⑬ **兜底**：`prefers-contrast: more`（文字提到 label/secondary、发丝线 .10→.30、卡片加 1px 实描边、
  材质退实色）、`forced-colors: active`（用 `CanvasText` 画回分隔线与状态点——它们本来就是背景色/背景图
  画的，强制配色下会整块消失）、`<meta viewport>` 加 `viewport-fit=cover` 且页头 padding-top /
  toast bottom 加 `env(safe-area-inset-*)`（manifest 已是 standalone + black-translucent）；手动切主题时
  同步 `meta[name=theme-color]`（此前只认系统偏好，手动切换后不跟随）；15px 表格字补 `-.01em` 字距。
- **页头**：左侧 32px 圆角 logo（同一张 helmet logo，点进官网）+ 标题；右侧页面版本徽标、
  GitHub 图标链接、上线提醒铃铛圆钮（32px，Web Push 订阅开关）、深浅色圆钮（32px）、语言圆钮
  （32px，显示 `中` / `EN`）。版本徽标样式同 DD
  `VersionBadge` / DC `.version`，当前 `v1.6.0`；改动本页时同步递增 `index.html` 里的 `#page-version`。
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
- **其它**：局域网 IP 可点开控制台（整行皆可点），旁边 26px 复制按钮复制 `IP:端口` 并弹出
  toast（`已复制 …`）；工具条显示「刷新于 HH:MM:SS · N/M 在线」。
- **图标缓存**：`<link rel="icon">` 带 `?v=2` 版本参数。Chrome 会长期缓存 favicon 的旧图/404，
  不带参数时硬刷新也可能不重新请求，导致「页面上看不到图标」。
- **本地验证**：`.verify/` 内有桩服务（`stub.py`，8099 端口
  映射 `/devices`）与 Playwright 脚本（`verify.js` 本地 12 项 / `verify-online.js` 线上 6 项），
  含座舱移除回归（旧 `findcar.ui.style` 键被忽略、无切换器残留）。本地跑法：

  ```bash
  python3 .verify/stub.py &          # 主桩 8099（另起 stub-empty.py 8098 空态 / stub-error.py 8097 错误态）
  NODE_PATH=<playwright 所在 node_modules> node .verify/verify.js        # 12 项：截图矩阵 + 座舱移除回归 + 行为
  NODE_PATH=<playwright 所在 node_modules> node .verify/verify-extra.js  # 33 项：整行跳转 / 绿勾 / 转环 / 空错态截图
                                                                          #      + 对比度实算 / 命中区 / 聚焦环 / 兜底媒体特性（CDP 实跑）/ 错误态本地化
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
  （直到退订或推送失效被清理）。**落库后经 `waitUntil` 立即回发一条欢迎 tickle**——用户点完铃铛
  几秒内收到真实系统通知，当场证明「VAPID 配置 → 推送服务 → SW 弹窗」全链路可用（未配置 VAPID
  密钥时跳过，失败吞掉不影响响应）。
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
