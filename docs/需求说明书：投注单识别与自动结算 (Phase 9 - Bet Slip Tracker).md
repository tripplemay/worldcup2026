# 需求说明书：他平台投注单识别与自动结算 (Phase 9 - Bet Slip Tracker)

> **日期**：2026-06-23。**代码基线**：Next.js 15，单 PM2 实例（`worldcup` @ 3100，nginx 反代 `2026.vpanel.cc`），JSON 文件存储，pnpm + Jest。
> **定位**：小范围（几个人）共用一个博彩平台投注。管理员把每个人的**投注单截图**发给 Telegram bot → 视觉 LLM **识别**（本金、可赢、各腿比赛/盘口/选项）→ bot **按钮询问归属哪个人** → 落库 → 赛后（仅**世界杯 + 已接入英/西/德/意/法联赛**范围）**自动结果匹配 + 串关结算** → 页面展示**每人详细盈亏**。

## 0. 已确认的设计决策

1. **赛果来源**：仅系统已覆盖范围 → 复用 ESPN 赛果 + `trade/settle.ts` 的 **90 分钟常规时间**口径，零额外赛果成本。
2. **用户归属**：投注人名册**预置**（几个人）；bot 收到截图后回**内联按钮**（每人一个），管理员点选 → `callback_query` 绑定。
3. **投注类型**：**串关为主**（多腿，全中才赢）。
4. **结果匹配 + 金额按截图**：截图已含锁定的赔率/可赢，系统**只判输赢**，金额一律取截图（**不重算赔率**）。
5. **识别复核**：自动入账，页面可改；低置信/走盘致金额失真 → 标 `needs_review`。

## 1. 数据模型（`src/lib/bets/types.ts`）

- `Bettor { id, name, active? }` —— 预置名册。
- `BetLeg` —— 识别字段（`homeName/awayName/league?/matchDate?/market/selection/line?/odds?/rawText?`）+ 结算回填（`matchId?/homeGoals?/awayGoals?/result?`）。`market` **复用结算引擎盘口码** `MarketType = 1X2|OU|AH|BTTS|DC|DNB`；`selection` 归一到结算词汇（`home|draw|away` / `Over|Under` / `Yes|No` / `1X|12|X2`）。
- `BetSlip { id, bettorId|null, platform?, stake, potentialReturn, currency?, legs[], status, pnl|null, confidence, imageRef?, source?, recognizedRaw?, note?, createdAt, updatedAt, settledAt? }`。
- `BetStatus = pending | won | lost | void | unmatched | needs_review`。
- `LegResult = won | lost | void | half_won | half_lost | pending | unmatched`。
- 存储：`store.ts` 新增 `loadBettors/saveBettors`（`bettors.json`）、`loadBets/saveBets`（`bets.json`），沿用既有 `readJson/writeJson`（`.data/predict/`，生产 `/opt/apps/worldcup-data`）。变更器（`addBet/assignBettor/settleBet/updateBet`）放 `src/lib/bets/bets.ts`（仿 `trade/signals.ts:setSignalStatus`）。

## 2. 识别（`src/lib/bets/recognize.ts`）

- 克隆 `intel/llm.ts` 的 OpenAI 兼容 fetch（`AIGC_BASE` + `BETS_VISION_MODEL ?? INTEL_LLM_MODEL ?? 'qwen3.5-flash'`；`qwen3.5-flash` 支持 vision+json，约 $0.0002/张）。
- **多模态**：`user.content` 为数组 `[{type:'text',text},{type:'image_url',image_url:{url:'data:image/jpeg;base64,...'}}]`；`response_format:json_object`；qwen 关 `enable_thinking`；`temperature:0`；`max_tokens:~1500`；超时 40s。
- 输出 `RecognizedSlip`（`stake/potentialReturn/currency?/platform?/legs[]/confidence`）；数字 `Number.isFinite` 校验、`confidence` 夹 `[0,1]`；任何失败 → `null`（沿用「未配置即禁用」契约）。
- **队名**：识别尽量输出英文/原文队名 + 联赛 + 开赛日，供下一步匹配。

## 3. 赛果匹配（`src/lib/bets/match.ts`）

- `resolveLeg(leg): LegResolution{ status:matched|pending|unmatched, matchId?, homeGoals?, awayGoals? }`，**90' 比分**。
- 队名：`normalizeTeam` 双边归一；**CJK 兜底**——`normalizeTeam` 仅留 `[a-z0-9]`，纯中文名归一为空，故先过一层可扩展的中文→规范英文映射（`src/lib/bets/cnTeams.ts`），再 `normalizeTeam`。
- **联赛**（`getLeague(comp)` 命中 5 大联赛）：`loadLeagueResults(key)` → `Object.values` 按 `homeNorm/awayNorm` + 日期窗（±1 天）查；命中即 FT，取 `homeGoals/awayGoals`。
- **世界杯**：`loadResults()` 扫到 `eventId` → `espnProvider.getMatchSummary(eventId)` → `regulationScore(...)`（处理加时/点球，对齐现有 `runSettlement`）；`loadResults` 空则 `getScoreboard(日期窗)` 兜底找 `eventId`。
- 联赛未知则遍历 `listLeagues()`；都查不到 → `unmatched`；查到比赛但未完赛 → `pending`。

## 4. 结算（`src/lib/bets/settle.ts` + 钩子）

- `judgeLeg(market, selection, line, gf, ga): LegResult`：非 AH / 整数·半盘 AH → 直接复用 `trade/settle.ts:outcome()`；**四分盘 AH**（`±.25/.75`，现引擎不支持）→ 拆成相邻两个半盘各判 `outcome()` 再合：全胜=`won`、全负=`lost`、胜+走=`half_won`、负+走=`half_lost`。
- `settleSlip(slip, resolvedLegs): { status, pnl }`（**串关聚合 + 金额按截图**）：
  - 任一腿 `unmatched` → `unmatched`；任一腿 `pending` → `pending`（保持待结）。
  - 全部已判：任一 `half_*` → `needs_review`；否则任一 `lost` → `lost`（`pnl=−stake`）；否则任一 `void` → `needs_review`（截图可赢已失真）；否则全 `won` → `won`（`pnl=potentialReturn−stake`）。
  - 单注（1 腿）：`won→won(pnl=潜回−本)`、`lost→lost(−本)`、`void→void(0)`、`half_*→needs_review`。
- `settlePendingBets()`：仿 `runSettlement` 控制流，遍历 `pending`/`unmatched`?(仅 pending) 注单逐腿 `resolveLeg` → `settleSlip` → 回填。**钩子两处**（幂等）：`settleWatcher.tick()` FT 块之后 + cron `POST /api/worldcup/trade/run`。

## 5. Telegram（`src/lib/tg/client.ts` + `POST /api/tg/webhook`）

- **零新依赖**，原生 `fetch`（Node 20）。client：`sendMessage`、`sendKeyboard`（内联按钮）、`editMessageText`、`answerCallbackQuery`、`getFile`、`downloadFile→Buffer`。
- webhook（顶层 `src/app/api/tg/webhook/route.ts`，`dynamic='force-dynamic'`，`maxDuration=300`）：
  - 校验 `x-telegram-bot-api-secret-token === TG_WEBHOOK_SECRET`（未设→403，不匹配→401）；仅信任 `chat.id === TG_ADMIN_CHAT_ID`；**始终尽快回 200**（非 2xx 会被 Telegram 重试）。
  - `message.photo`：取**最大尺寸** `photo[last].file_id` → 下载 → base64 → `recognizeBetSlip` → 落库 `BetSlip(bettorId=null, status=pending)` → 回**识别摘要 + 投注人按钮**（`callback_data=assign:<betId>:<bettorId>`）；原图落 `WC_DATA_DIR` 供复核。
  - `callback_query`：`assign:*` → 绑定 `bettorId` → `editMessageText("✅ 已归属：张三")` + `answerCallbackQuery`。
- 注册：`deploy.yml` pm2 start 后 `curl .../setWebhook -d url=https://$DOMAIN/api/tg/webhook -d secret_token=$TG_WEBHOOK_SECRET`（幂等）。

## 6. 展示与管理（`(wc)/pnl` + 路由）

- `GET /api/worldcup/pnl` → `ok({ bettors, slips, perUser })`（**永不 `ok(null)`**，fetcher 见 null 会抛）。
- `GET/POST /api/worldcup/bettors`（名册增删；POST 走 `x-admin-token`）。
- `POST /api/worldcup/bets`（**管理员改账**：改金额/腿、重指归属、手动结算、绑定 `unmatched`、清 `needs_review`）。
- 页面 `src/app/(wc)/pnl/page.tsx`（`'use client'`，纯 Tailwind/Horizon）：每人盈亏总览（总投/净盈亏/注数/命中率，`money/signMoney/pct/posCls` 复用 `paper/page.tsx`）→ 点入逐单明细（腿、状态、盈亏；`pending/已结/待复核` 分组）→ 管理编辑区（`KeyManager` 解锁式 `x-admin-token`，localStorage `wc_admin_token`）。
- `BottomTabBar` 加 `💰 盈亏` Tab（注意已 7 个，第 8 个偏挤——评估或移一个到设置）。i18n `nav.pnl` + `pnl.*` 同步 zh/en。

## 7. 环境与部署

- 新 env：`TG_BOT_TOKEN`、`TG_ADMIN_CHAT_ID`、`TG_WEBHOOK_SECRET`、`BETS_VISION_MODEL`(默认 qwen3.5-flash)。需同步 `.env.local` + GitHub Secrets + `deploy.yml`（`env:` 块 + 第 ~69 行 `envs:` 白名单 + `export` 行；缺一则生产取不到）。`AIGC_API_KEY` 已有。
- webhook 经现有 nginx catch-all 直达，**零 nginx 改动**；certbot TLS 满足 Telegram。

## 8. 验收

- **识别**：发图 → `recognizeBetSlip` 出结构化 `RecognizedSlip`（单测：纯解析/校验/夹值）。
- **归属**：bot 按钮点选 → `bettorId` 绑定、消息编辑为「已归属」。
- **结算**（核心单测）：`judgeLeg` 六类盘口 + 四分盘 half_*；`settleSlip` 串关：全中赢/任负输/含走盘→review/未匹配→unmatched/未完赛→pending；金额=截图。
- **页面**：每人盈亏明细可见；管理员可改错账、绑定 unmatched、手动结算。

## 9. 风险

- **HIGH 识别准确率**（金额/队名/盘口）→ 页面可改 + 低置信 `needs_review` + 留原图。
- **MED 队名对齐**（平台简称/中文）→ `cnTeams`/`ALIASES` 扩展 + `unmatched` 人工绑定。
- **MED 四分盘 half_*** 在串关无法用截图金额表达 → 一律 `needs_review` 交人工。
- **MED 走盘**致截图可赢失真 → `needs_review`。
- **LOW 可赢口径**默认含本金（净利=可赢−本金）；若平台显示净利则 `pnl=potentialReturn`，一处可调。
- **LOW 并发写**：`writeJson` 非原子、整表重写；单 PM2 + 低频，可接受。

## 10. 复用对照

| 能力 | 状态 |
|---|---|
| `outcome/regulationScore/pnlFor`（盘口判定 + 90' 比分） | ✅ `trade/settle.ts`（四分盘 AH + 串关聚合本方案新增） |
| `readJson/writeJson` + load/save 模式 | ✅ `db/store.ts` |
| `normalizeTeam/matchKey/findMatch` | ✅ `match/normalize.ts`（CJK 兜底新增） |
| `loadResults/loadLeagueResults` + ESPN provider + `regulationScore` | ✅ 赛果匹配复用 |
| settleWatcher / cron `trade/run` | ✅ 结算钩子复用 |
| LLM OpenAI 兼容 fetch | ✅ `intel/llm.ts`（视觉多模态新增） |
| `ok/fail`、`x-admin-token`、SWR、Horizon、`BottomTabBar` | ✅ 路由/页面复用 |
| **Telegram client + webhook + 识别 + 匹配 + 串关结算 + 名册 + 盈亏页** | 🔲 本方案新增 |
