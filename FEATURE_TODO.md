# tryhotellobby.com 功能模块分析 & 实施 ToDo

> 目标：记录参考站（tryhotellobby.com，"双人照片 AI 视频"产品）的全部功能模块，
> 作为本工程（D:\self_pro\Pro1，当前为纯静态演示站 DuoStage）后续迭代的实施清单。
>
> 当前工程进度：**Phase 0 ✅ + Phase 1 演示级 ✅** —— 静态落地页（hero/上传卡/预览卡/examples/how/pricing/FAQ/guides/CTA/footer）+ 原生 JS 交互（计价联动、FAQ 手风琴、页签、上传本地预览）+ 中英文 i18n（localStorage 持久化）+ M1 认证演示适配器（login/account/dev-inbox、魔法链接单次消费、头部登录态 chip）。
>
> **打钩纪律**：每完成一项开发，立即在对应模块 ToDo 打钩 `[x]`，并在该模块验收行下附日期与验证方式；未完成项保持 `[ ]`；演示级与生产级在括号内注明，不把演示级写成生产级完成。
>
> 说明：参考站是"静态前端 + 云端后端"形态；登录、支付、生成、作品库等模块**必须引入后端**才能实现。本文每个模块给出：参考站行为 → 实现要点 → ToDo 清单 → 验收标准。

---

## 一、站点页面 / 功能地图

| 路径 | 模块 | 功能说明 |
|---|---|---|
| `/` | 生成器首页 | 双照片上传、模型/时长/画质/画幅设置、费用联动、示例预览、创建入口 |
| `/login` | 登录 | Google OAuth 一键登录 + 邮箱魔法链接（免密码），同一链接登录或注册 |
| `/account` | 账户设置 | 账户信息、登录方式、积分余额管理 |
| `/creations` | 我的视频 | 渲染结果列表、预览、下载（重复下载不收费） |
| `/pricing` | 定价与积分 | 4 档一次性点数包、交互式计价器、按模型的积分对照表、支付 FAQ |
| （结账流程） | 支付 | Stripe 一次性 checkout；支付确认后入账；未支付/取消不入账 |
| `/hotel-lobby-ai-video-examples` | 示例画廊 | 多组"输入→完整输出"对照，分页（1/2 徽标） |
| `/ai-video-templates` | 模板集合（Genjutsu） | 其他视频模板入口 |
| `/blog` + 3 篇指南 | 内容/SEO | 成本指南、照片指南、选购指南 |
| `/how-to-make-...` | 照片与视频指南 | 照片清单、流程教学 |
| `/hotel-lobby-ai-prompt` | 内置 prompt 公开页 | 透明度营销 |
| `/hotel-lobby-ai-free` | 免费 vs 付费说明 | 转化页 |
| `/migos-ai-video` | 潮流解释页 | SEO/趋势引流 |
| `/privacy` `/terms` | 合规 | 照片隐私与删除政策、积分与退款边界 |
| 头部语言下拉 | i18n | 多语言切换（本工程已实现 zh/en） |

---

## 二、功能模块 ToDo

### M1 认证与账户（P0）

**参考站行为**
- 免密码：`Continue with Google` 或邮箱魔法链接（"One link to sign in or create your account"）。
- 登录前所选照片保留在本地设备（"Your selected photos stay on this device until you create a video"）。
- 登录后才有余额、作品库、账户设置。

**实现要点**
- Google OAuth 2.0 授权码流程 + 回调。
- 魔法链接：生成一次性 token → 发邮件 → 点击校验（过期/单次）→ 建会话；不存在则自动注册。
- 会话：HttpOnly Cookie 或 JWT；头部登录态切换（Sign in → 头像/余额）。

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [x] 选定后端栈：Node 内置 `http` 零依赖骨架（`server/`）；DB 为 JSON 文件仓储层（`server/db.js`），生产换 SQLite/Postgres 只需重写该文件
- [x] 真后端骨架：`/api/auth/magic-link | consume | me | logout`、`/api/auth/google`（501 占位）、`/api/dev/inbox`、`/api/health`；HMAC 会话（登出即吊销）；同服务托管静态站
- [x] 邮件适配器接口：`DevInboxMailer` 已实现（生产换 Resend/SES，同接口注入）
- [x] 前端双适配器：`js/auth.js` 自动探测后端（http 模式）/ 回落 localStorage（local 模式），调用方 API 不变
- [x] 后端自测 `server/selftest.js` 17/17 通过（链接单次消费、篡改拒绝、登出吊销、路径穿越防护、JSON 持久化）
- [ ] 注册 Google OAuth Client，配置回调与白名单（演示页已有 Google 按钮占位，http 模式返回 501 提示）
- [x] 魔法链接：token 生成、过期（15 分钟）与单次消费（demo：无邮件发送，链接落在 `dev-inbox.html`；生产接 Resend/SES）
- [x] 登录页 UI（Google + 邮箱双入口）；`users` / `magic_links` / 会话为 localStorage 演示表（`js/auth.js`），生产迁移到 DB
- [x] 账户设置页 `account.html`（邮箱、登录方式、注册时间、余额、退出；演示版）
- [x] 头部登录态组件 `navAuth`（未登录=Sign in 按钮，已登录=余额 chip 链到账户页）；照片本地暂存待 M5 接通
- [x] 登录/账户/收件箱页 i18n 接入共享词典（`js/i18n.js`）

**验收**：两种方式均可登录/注册；链接一次性且过期失效；登录后头部显示余额；退出后会话清除。
> 进度（2026-10-09）：演示级验收已全部通过（localStorage 会话）；真后端骨架同日完成并浏览器 E2E 通过（http://127.0.0.1:8787 发链→收件箱→登录→账户→登出→会话吊销），selftest 17/17。剩生产项 = OAuth Client、真实邮件服务、DB 迁移。

---

### M2 积分与支付（P0）

**参考站行为**
- 4 档一次性包（$4.99 / $9.90 / $24.90 / $49.90），可叠加购买、永不过期、无订阅。
- Stripe 一次性 checkout；"Credits are added after Stripe confirms a successful payment"；未支付/取消不入账。
- 积分计价表（MiniMax H3）：768P = 160/200/240（5/10/15s）；2K = 260/325/390。
- 定价页有交互计价器：模型 × 时长 × 画质 → 每支视频积分 + 每包可生成支数。
- 积分返还与支付退款是两套体系（"Credit returns are separate from payment refunds"）。

**实现要点**
- Stripe Checkout Session（mode=payment）+ Webhook（`checkout.session.completed`）入账，幂等处理。
- 积分账本制：grant / reserve / consume / return 四类流水，余额 = 流水合计。
- 计价配置表：model × duration × quality → credits（前端展示与后端扣费共用同一配置）。

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [ ] Stripe 账号、商品/价格配置（4 档包）——生产剩余；DevPay 适配器已就位，同接口换 Stripe Checkout + 真 webhook 验签
- [x] Checkout 创建接口 + 成功/取消回跳页（dev：`checkout-dev.html` 模拟 Stripe 托管页；取消不入账）
- [x] Webhook 入账幂等（dev：`/api/pay/confirm` 扮演 webhook，按 order 状态重入 no-op；selftest 验证重放不重复入账）
- [x] `orders` / `credit_ledger` 表与余额查询接口（`/api/credits`：balance / reserved / 近 20 条流水；四类流水 grant/reserve/consume/return，预留单次结算）
- [x] 定价页计价器与后端配置同步（`/api/pricing` 单一事实源；前端 seg 计价 + 各模型积分对照表由配置渲染，离线回落旧算法）
- [x] 余额不足时的引导购买流程（生成按钮：未登录→登录页；已登录不足→toast+滚到定价区；定价卡按钮发起 checkout）

**验收**：支付成功余额增加且流水可查；取消 checkout 不入账；重复 Webhook 不重复入账；计价器数值与后端配置一致。
> 进度（2026-10-09）：dev 级验收全部通过——selftest 38/38；浏览器 E2E：未登录门槛跳登录 → 余额 0 门槛 toast → 结账页支付 → 账户余额 240 + grant 流水 → chip 同步 240 → 2K(390) 不足再触发门槛。剩生产项 = Stripe 真接入。

---

### M3 生成任务管线（AI 模型 API）（P0 核心）

**参考站行为**
- 多模型可选：MiniMax H3 / Seedance 2.5 / Kling 3.0 Omni。
- 输入 = 2 张照片 + 固定参考视频 + 内置 prompt（自动分配左右角色），用户不写 prompt。
- 任务状态：pending（积分预留）→ 成功（积分消耗）/ 确认失败（积分返还）。
- 参数：5/10/15s、768P/2K、9:16（默认）/16:9/1:1；音频为全新生成。
- 上传限制：JPG/PNG/WebP、每张 ≤10MB；"Private uploads"。

**实现要点**
- 模型适配层：统一 `submit(job) / status(job) / fetch(job)` 接口，三家 vendor 各自实现。
- 状态机 + 超时/重试；失败判定要明确（vendor 报错 or 超时阈值）。
- 参考视频与 prompt 为后端固定资产，前端不可改。
- 上传走预签名 URL 直传对象存储；服务端二次校验类型/大小；可选人脸检测预检。
- 内容审核：上传图与输出视频均需过审（vendor 自带或第三方）。

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [x] 调研三家 API（文档级核实，2026-10-09）：MiniMax 官方 `platform.minimax.io` 的 `/v2/video_generation` 原生支持 Reference Generation（prompt + 参考图/视频/音频），与"固定参考片段 + 双照片"模板流最匹配 → **生产首发候选**；Kling 3.0 Omni 有官方 kling.ai/dev（i2v / video omni 多参考）与 PiAPI/Magic Hour 等转售；Seedance 2.5 官方走 BytePlus ModelArk（待开通）或 Replicate（bytedance/seedance-2.5）。生产接入前需复核计费与区域可用性
- [x] `jobs` 表 + 状态机（pending/running/succeeded/failed）+ 预留/消耗/返还挂钩（`server/jobs.js`；dev 结算由 `/api/dev/jobs/finish` 扮演 vendor 回调）
- [x] 预签名上传接口与前端直传改造（`/api/uploads/presign` + PUT 直传，服务端 mime/size 校验；前端 `uploadFile()` 走真实路径并保留本地预览；local 模式回落 FileReader；生产换 S3 预签名 URL）
- [x] 任务创建接口：校验登录、余额、参数合法性；reserve 积分（`POST /api/jobs`：模型/时长/画质/画幅/照片归属校验 + 并发上限 + 透支 402）
- [x] 轮询或 Webhook 获取结果；写回 `renders`（前端 2s 轮询 `GET /api/jobs`；成功写 renders 并提供 Watch/Download）
- [x] 失败返还与超时兜底（`sweepJobs` 每 30s 扫描僵尸 pending/running → failed + return；selftest 验证）
- [x] 并发上限（每用户 `maxActiveJobs=3` → 429）
- [ ] 成本监控告警（生产）
- [x] 审核拒绝话术与积分返还 dev 模拟（outcome=rejected → `error_code=moderation` + return）
- [ ] 生产审核接入（vendor 自带或第三方；积分策略需写入 terms）

**验收**：端到端跑通一支视频；pending 期间余额显示"已预留"；模拟失败后积分自动返还；僵尸任务被兜底清理。
> 进度（2026-10-09）：dev 级验收通过——selftest 62/62；浏览器 E2E：`?devphotos=1` 真实预签名直传 → 生成 → pending（GENERATING…）→ dev 结算 success → READY + Watch/Download；账本三笔（purchase/reserve/consume）余额归零；二次生成被余额门槛拦截。失败返还、审核拒绝、僵尸清扫由 selftest 覆盖。剩生产项 = 真 vendor 适配、审核、成本告警。

---

### M4 我的视频库（P1）

**参考站行为**
- `/creations` 列表：生成中/成功/失败状态、设置元数据（时长/画质/画幅/积分/日期）。
- 预览 + 下载；重复下载不消耗积分；"Videos may become unavailable later"（存储有生命周期）。

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [ ] `renders` 表 + 对象存储（设置过期策略，如 30 天）
- [ ] 库页面 UI：状态卡、空态（复用现有 `stage-empty` 样式）、失败卡含"积分已返还"说明
- [ ] 签名下载 URL（短时效）
- [ ] 到期清理任务 + 页面提示文案
- [ ] 删除作品入口

**验收**：成功任务入库可预览可下载；失败任务显示返还说明；过期条目给出明确提示而非报错。

---

### M5 生成器前端接通（P0，部分已完成）

**已完成（静态演示）**
- [x] 双上传位本地预览 / 交换（Swap sides）
- [x] 模型 / 时长 / 画质 / 画幅 seg 控件与费用联动（时长×16 点数/秒，2K 翻倍）
- [x] Example / My renders 页签与空态隐藏（含 `[hidden]` 被 flex 覆盖的修复）
- [x] toast 提示、移动端汉堡菜单、平滑锚点滚动

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [x] 上传改为预签名直传 + 服务端校验（保留本地预览体验）（dev 直传落地；生产换 S3）
- [x] 登录门槛：点击生成 → 未登录跳登录；已登录但余额不足 → 引导购买（`?devgate=1` 钩子供 E2E 触达门槛；真实上传启用待 M5 预签名直传）
- [x] 结账后确认照片 → 创建任务的流程串接（购买 → 上传 → 生成 → job 全链路 E2E 通过）
- [x] 生成中进度态（轮询展示 pending/running）与完成态（播放器 + 下载按钮）（My renders 面板：状态 chip + Watch/Download）
- [x] 错误态：格式不支持、超 10MB（已有 toast）、余额不足、审核拒绝（badType/over/needCredits/tooMany/createFail/moderation 话术齐备）
- [ ] 未登录照片本地暂存，登录后续传

**验收**：从选图到拿到成片的完整链路在浏览器走通，各错误态有对应文案。

---

### M6 示例与展示（P2，部分已完成）

**已完成**
- [x] examples 对照卡（输入→输出，SVG 舞台示意，含左右互换组）
- [x] "1 / 2" 分页徽标样式

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [ ] 真实示例视频托管与播放（替换示意 SVG/播放按钮 toast）
- [ ] 示例画廊独立页：多组对照 + 分页
- [ ] "输入→输出"对照组件抽象复用（首页/画廊/指南）

---

### M7 内容与 SEO（P2）

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [ ] 指南文章页 ×3（成本/照片/选购）+ 照片指南长页
- [ ] 内置 prompt 公开页、免费 vs 付费页、潮流解释页（转化与 SEO）
- [ ] sitemap.xml / robots.txt / 每页 title+description+OG / hreflang（配合 i18n）
- [ ] 结构化数据（Product/FAQ schema）

---

### M8 合规与隐私（P1）

**参考站行为**：照片隐私与删除政策单独成页并提供删除入口；terms 明确"积分返还 ≠ 支付退款"。

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [ ] privacy / terms 页面（中英）
- [ ] 上传与成片的保留期策略 + 用户主动删除 API
- [ ] 肖像权/授权声明（上传即承诺有权使用）
- [ ] 审核拒绝与申诉话术；未成年人保护声明

---

### M9 通知与状态反馈（P2）

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [x] 站内 toast 基础组件（全站共用，含 i18n 文案）
- [ ] 邮件通知：生成成功 / 失败返还 / 积分入账
- [ ] 头部余额变化的即时刷新
- [ ] （可选）Web Push 或回站提醒

---

### M10 i18n（已完成，持续维护）

**已完成**
- [x] zh/en 词典（约 150 键）+ 头部下拉切换 + localStorage 持久化
- [x] 动态文案跟随（计价 / toast / 按钮 / 文档标题 / `<html lang>`）
- [x] 共享模块 `js/i18n.js`（多页复用 + 语言变更钩子 `DS.onLangChange`）

**运行时**：Cloudflare Workers（`workers/`：KV 仓储 + R2 上传 + Cron 僵尸清扫 + Static Assets；Web Crypto HMAC 会话）。`server/` 为遗留 Node 本地镜像（离线演示保留），部署以 workers/ 为准。Workers 自测 56/56；`wrangler dev`（miniflare）浏览器 E2E 全链路通过（magic link 登录→买包 240→devphotos 直传→生成 GENERATING…→dev 结算 SUCCEEDED→READY+Watch/Download→账本三笔余额归零）。

**ToDo**
- [x] 新增页面同步登记 i18n 键：登录 / 账户 / 开发收件箱（约 40 键 ×2 语）；库 / 指南页创建时继续同步
- [ ] hreflang 与多语言 URL 策略（配合 M7）

---

## 三、分阶段路线图

| 阶段 | 内容 | 依赖 |
|---|---|---|
| Phase 0 ✅ | 静态落地页 + 交互 + i18n | 无 |
| Phase 1 ✅ | M1 认证：演示适配器 + 真后端骨架（node:http + JSON 仓储 + HMAC 会话 + 邮件适配器接口）；生产剩余 = OAuth Client / 真实邮件 / DB 迁移 | 域名/部署/邮件服务 |
| Phase 2 ✅（dev 级） | M2 支付与积分账本：checkout + 幂等入账 + 四类流水 + `/api/pricing` 单一事实源 + 余额门槛；生产剩余 = Stripe 真接入 | Stripe 账号 |
| Phase 3 ✅（dev 级） | M3 生成管线：jobs 状态机 + 预签名直传 + 轮询 + 失败返还/僵尸兜底 + 并发上限；DevVendor 结算；**部署运行时 = Cloudflare Workers**（KV+R2+Cron+Assets，wrangler dev E2E 通过）；生产剩余 = 真 vendor 适配（首发 MiniMax H3）、审核、成本告警 | 模型 vendor 账号与额度；Cloudflare 账号 + KV/R2 绑定 + DS_SECRET |
| Phase 4 | M4 作品库 + M8 合规页 | 对象存储 |
| Phase 5 | M6 真实示例 + M7 内容 SEO + M9 通知 |  Phase 3 产出素材 |

---

## 四、数据模型草案

```
users(id, email, google_id, locale, created_at)
magic_links(id, email, token_hash, expires_at, used_at)
orders(id, user_id, pack, amount_usd, stripe_session_id, status, created_at)
credit_ledger(id, user_id, delta, reason[grant|reserve|consume|return], ref_type, ref_id, created_at)
jobs(id, user_id, model, duration_s, quality, aspect, photo1_key, photo2_key,
     status[pending|running|succeeded|failed], reserved_credits, error_code,
     created_at, finished_at)
renders(id, job_id, output_key, thumb_key, expires_at, downloads_count)
deletion_requests(id, user_id, scope[uploads|renders|account], status, created_at)
```

余额 = Σ credit_ledger.delta；pending 任务显示为"已预留"（reserve 负流水或单独 reserved 字段，二选一并全文档统一）。

---

## 五、关键业务规则速查（摘自参考站，作为验收基线）

- 积分：永不过期；多包叠加；pending 期间预留；**确认失败返还**；成功即消耗（不满意重渲也消耗）。
- 支付：一次性、无自动续费；入账以支付网关确认事件为准；积分返还与支付退款相互独立。
- 上传：JPG/PNG/WebP、每张 ≤10MB；登录前照片仅存本地设备。
- 输出：5/10/15s；768P/2K；9:16 默认、16:9、1:1；音频全新生成、不含原曲。
- H3 积分表：768P = 160/200/240；2K = 260/325/390（5/10/15s）。
- 登录：免密码（Google 或邮箱魔法链接）。
- 下载：免费，重复下载不收费；成片不永久托管。

---

## 六、风险与注意事项

1. **模型 vendor 政策**：三家 API 的内容政策、区域限制与单价差异大，先小额度压测再定首发模型。
2. **肖像权与同意**：双人照片涉及第三方肖像，上传声明与审核策略要前置，避免事后补救。
3. **成本失控**：2K + 15s 单价高，需并发上限、单用户日限额与成本告警。
4. **支付合规**：积分"返还 ≠ 退款"的表述要在 terms 与结账页双重披露。
5. **存储成本**：成片与上传图设置生命周期，避免无限累积。
6. **静态站边界**：~~Phase 1 起前端需迁移部署形态~~ 已由 `server/index.js` 解决（同一进程托管静态资源 + API）；生产部署可换对象存储 + 函数后端，前端适配器无需改动。
