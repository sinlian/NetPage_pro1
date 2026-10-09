# DuoStage — 静态演示站

一个纯静态（HTML + CSS + 原生 JS）的产品落地页演示，参考了"双人肖像 AI 视频"类产品的版式：深色主题、品红渐变 CTA、双栏工作室网格。

## 打开方式

**纯静态（演示/离线）**：直接用浏览器打开 `index.html`，认证自动回落 localStorage 演示模式。

**带真后端**（Node ≥ 18，零依赖）：

```
node server/index.js
# 访问 http://127.0.0.1:8787
```

环境变量：`PORT`、`HOST`、`DS_SECRET`（会话签名密钥，生产必改）、`DS_DATA`（数据文件路径）、`DS_DEV_ENDPOINTS=off`（关闭 /api/dev/inbox）。

后端自测（进程内起服务、跑完自动退出）：

```
node server/selftest.js     # 期望 62 passed, 0 failed
```

## 目录结构

```
index.html        页面结构（hero、工作室网格、examples、how、pricing、guides、faq、cta、footer）
login.html        登录（Google 占位 + 邮箱魔法链接）
account.html      账户设置（会话信息、余额/预留/流水、退出）
## 运行时：Cloudflare Workers（生产/部署）

```
workers/
  wrangler.toml     name=duostage；[assets] 静态站；[triggers] 每分钟僵尸清扫；KV=DS_KV；R2=DS_R2
  src/index.js      fetch：/api/* 路由表（与 Node 镜像同契约）+ 其余走 ASSETS；scheduled：sweepJobs
  src/config.js     env 驱动配置（DS_SECRET 走 wrangler secret）
  src/db.js         KV 仓储（t:<table>:<id>）+ 内存 shim（自测用）
  src/r2.js         R2 上传助手 + 内存 shim
  src/auth.js       Web Crypto HMAC 会话（<sessionId>.<sig>，行存在才可校验，登出即吊销）
  src/credits.js    积分账本 grant/reserve/consume/return（异步）
  src/jobs.js       任务状态机 + 僵尸清扫（Cron 触发）
  src/adapters.js   dev 邮件（dev_inbox）/ dev 支付（checkout-dev）适配器
  public/           静态站副本（scripts/sync-public.mjs 同步；_headers 控缓存）
  selftest.mjs      56 项断言（纯 Node，内存 KV/R2/Assets shim 跑真实 handler）
scripts/sync-public.mjs   仓库根静态文件 → workers/public/
```

部署（一次性绑定 + 每次发布）：

```
cd workers
wrangler login
wrangler kv namespace create DS_KV        # 把 id 填回 wrangler.toml
wrangler r2 bucket create duostage-uploads
wrangler secret put DS_SECRET             # 生产会话 HMAC
wrangler deploy
wrangler dev                              # 本地：miniflare 模拟 KV/R2/Assets，免登录
node selftest.mjs                         # 期望 56 passed, 0 failed
```

`server/` 为遗留 Node 本地镜像（离线 file:// 演示与历史自测保留），**部署运行时以 workers/ 为准**；
两者路由契约一致，前端零改动（相对 `/api/*` + 双适配器）。改静态文件后跑 `node scripts/sync-public.mjs`。

部署状态（2026-10-09）：代码已推送 `https://github.com/sinlian/NetPage_pro1`（main, f47d523）；
`wrangler deploy --dry-run` 校验通过（20 assets / 24.54 KiB / KV+R2+Assets 绑定齐全）。
账号部署待凭据：dashboard 有人机质询且隔离浏览器无会话、wrangler 未登录、环境无 API token。
三选一完成：① 给我 API token（Workers/KV/R2 编辑 scope）→ 我建绑定+secret+deploy；
② 有浏览器的机器 `wrangler login` 后 `wrangler deploy`；
③ dashboard → Workers & Pages → Import from GitHub → 本仓库（root=workers，assets 已提交无需 build 命令）→ UI 挂 KV/R2 + 设 DS_SECRET。

checkout-dev.html 开发结账页（模拟 Stripe 托管页，仅演示，noindex）
dev-jobs.html   开发任务控制页（扮演 vendor 回调：success/failed/rejected，仅演示，noindex）
dev-inbox.html    开发收件箱（仅演示，noindex，上线前移除）
assets/sample-output.svg  dev 成片替身（生产换 vendor mp4）
css/style.css     全部样式（设计变量、组件、响应式）
js/i18n.js        共享 i18n（window.DS：词典、applyLang、语言钩子）
js/auth.js        认证双适配器（http 后端 / localStorage 回落，window.Auth）
js/main.js        首页交互（页签、设置分段→费用联动、FAQ 手风琴、toast）
js/login.js / js/account.js / js/inbox.js   三个子页逻辑
server/           真后端骨架（node:http 零依赖）
  config.js       端口/密钥/TTL/数据文件 + 点数包与积分计价表（单一事实源）
  db.js           JSON 文件仓储层（users/magic_links/sessions/dev_inbox/orders/credit_ledger/jobs，原子写）
  mail.js         邮件适配器接口（DevInboxMailer；生产换 Resend/SES）
  pay.js          支付适配器接口（DevPayAdapter；生产换 Stripe Checkout）
  credits.js      积分账本（grant/reserve/consume/return，预留单次结算，透支拒绝）
  jobs.js         任务状态机（pending/running/succeeded/failed；reserve/consume/return 挂钩；僵尸清扫 sweepJobs）
  auth.js         魔法链接 token + HMAC 会话（登出即吊销）
  http.js         JSON/静态服务助手（含路径穿越防护；html/js/css no-cache）
  app.js          路由：/api/auth/*、/api/pricing、/api/credits、/api/checkout、/api/pay/confirm、/api/uploads/*、/api/jobs、/api/dev/*、/api/health + 静态托管
  index.js        入口（写 server.pid；30s 僵尸任务清扫）
  selftest.js     62 项断言自测
js/checkout.js    开发结账页逻辑
js/devjobs.js     开发任务控制页逻辑
FEATURE_TODO.md   功能模块分析与实施 ToDo（完成即打钩）
```

测试钩子（上线前移除）：`?devgate=1` 无照片启用生成按钮（触达登录/余额门槛）；`?devphotos=1` 用两张 1×1 PNG 走真实预签名直传路径；dev-inbox / checkout-dev / dev-jobs 三页仅演示。

## 已实现的交互

- 预览卡页签：Example / My renders 切换（空态面板默认隐藏）
- 设置分段控件：时长 × 画质 → 实时重算 credits 与设置摘要
- FAQ 手风琴：单开模式，展开动画
- 上传卡：选择图片后预览缩略图、Swap sides 交换、toast 提示
- 平滑锚点滚动 + 吸顶导航

## 说明

文案与插画（SVG 舞台场景）均为原创演示内容，不隶属任何音乐艺人或厂牌。
