# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 沟通用中文。本仓库的注释、文档、提交信息、UI 文案全部为中文。

## 这个项目是什么

**世界杯 2026 一站式 App** —— 移动优先 PWA,从赔率聚合起步,已演进为一套**足球预测 + 模拟交易 + 投注单识别结算**系统。后端是 Next.js 15 Route Handlers + 进程内常驻后台任务,前端是手机端多 Tab 看板。

**重要:它建立在 Horizon UI 商业模板之上。** `package.json` 的 `name`、`README.md`、`CHANGELOG.md` 都是模板自带的,**与本项目无关**。真正的代码只在下列位置:

| 真正的应用代码 | 模板遗留(基本忽略) |
|---|---|
| `src/lib/**`(全部业务逻辑) | `src/variables/**`、`src/contexts/**` |
| `src/app/(wc)/**`(页面) | `src/components/**`(除 `worldcup/` 外) |
| `src/app/api/worldcup/**`、`src/app/api/tg/**`(接口) | `src/routes.tsx`、`src/types/**`、`src/utils/**` |
| `src/components/worldcup/**`(本项目组件) | 模板的旧 demo 页面 |

模板噪音是 `next.config.js` 里 `typescript.ignoreBuildErrors` 和 `eslint.ignoreDuringBuilds` 都设为 `true` 的原因——生产构建跳过全量 tsc/eslint,避免被模板的历史类型/大小写问题阻断。**新代码请在 dev 下确保类型通过**,别依赖构建检查。

## 常用命令

包管理器是 **pnpm**(只有 `pnpm-lock.yaml`;README 里的 yarn 是模板残留,别用)。`.npmrc` 已设 `legacy-peer-deps`(React 19 RC 需要)。

```bash
pnpm install            # 安装(CI 用 --no-frozen-lockfile)
pnpm dev                # 本地开发 (next dev)
pnpm build              # 生产构建 (standalone 产物)
pnpm test               # 跑全部测试 (jest)
pnpm lint               # next lint

# 跑单个测试文件 / 单个用例
pnpm test src/lib/predict/models/__tests__/poissonCore.test.ts
pnpm test -t "归一化"   # 按用例名过滤 (-t 透传给 jest)
```

测试用 jest + jsdom,只匹配 `**/__tests__/**/*.test.ts(x)`(`jest.config.js`)。导入用 `baseUrl: "src"` 风格(如 `import { loadRatings } from 'lib/db/store'`),不是相对路径。

## 架构大图

### 三层结构
1. **数据源适配层** —— 每个外部源一个可插拔 provider:
   - **The Odds API**(`lib/odds/theoddsapi.ts`):赛前/夺冠赔率,**配额仅 500/月**,必须走配额守卫;key 可逗号分隔多个轮换。
   - **odds-api.io**(`lib/odds/oddsapiio.ts`):实时赔率第二源,100 次/小时,后台轮询动态配速。
   - **ESPN**(`lib/espn/espn.ts`):赛程/比分/积分/对阵/box-score,**免费、非官方隐藏 API**,防御式解析 + 失败静默降级,是赛果与重算的免费底座。
   - **API-Football**(付费 Pro):历史摄取/射手榜;未配 key 则跳过。
   - 跨源没有公共 ID:`lib/match/normalize.ts` 用**归一化队名 + UTC 日期**对齐;对齐失败则不显示赔率(绝不显示错值)。

2. **业务逻辑层(`src/lib`)** —— 见下方子系统表。

3. **接口 + 页面** —— `src/app/api/worldcup/*` 是统一信封的 Route Handler;`src/app/(wc)/*` 是页面(`/` 重定向到 `/schedule`)。前端经 `lib/hooks/useWorldCup.ts`(SWR)取数。

### 持久化:文件型 JSON,不是数据库
`src/lib/db/store.ts` 是**唯一**存储层。所有领域对象(评分/历史/Elo/情报/钱包/注单/初盘闭盘/快照……)是 `WC_DATA_DIR`(本地 `.data/`,生产 `/opt/apps/worldcup-data/`)下 `predict/` 子目录里的独立 JSON 文件。写入**原子**(临时文件 + rename)且**永不抛错**(失败只记 stderr)。新增持久化数据一律加 `load*/save*` 到这个文件,不要绕过。

### 进程启动:三个常驻单例
`src/instrumentation.ts`(Next 15 启动钩子,仅 Node 运行时)是生命周期中枢,拉起在 PM2 进程内独立于用户流量运行的三个后台单例:
- `startLivePoller()`(`lib/odds/livePoller.ts`)—— `globalThis` 钉住的单例,轮询实时赔率、算 delta、记时序、跑微观异动雷达、按限流头自我节流。
- `startSettleWatcher()`(`lib/trade/settleWatcher.ts`)—— 自适应节奏守望者,结算已完赛事;一旦有新完赛就 debounce 触发全量重算(摄取历史 → 重算评分 → 摄取球员分钟 → 失效 predict/tmi 缓存)。
- `startWxPoller()`(`lib/wx/poller.ts`)—— 仅当配置 `WX_BOT_TOKEN` 时启动的微信长轮询收单。

### 子系统(`src/lib`)
| 模块 | 职责 |
|---|---|
| `predict` | 预测引擎。`predict.ts` 编排;`models/`(poisson-xg / poisson-goals / elo / market-implied)经 `models/index.ts` 副作用导入注册到 `registry.ts`;`ensemble.ts` 按 Elo 差**动态加权**;`predictionLog.ts` 赛前快照 + 赛后结算做准确率追踪。含联赛/英超回测变体。 |
| `trade` | 自动模拟交易(纸上)。`router.ts`(纯函数)用 `ev.ts` Kelly 选每场单一最优 +EV;`prematch.ts` 赛前下注;`ledger.ts` 是钱包。 |
| `bets` | **Phase 9** 他平台投注单识别。`recognize.ts` 把截图发视觉 LLM(经 AIGC 网关)→ 严格 JSON;`run.ts`/`match.ts`/`settle.ts` 对 ESPN 赛果做幂等结算(`lock.ts` 加锁);串关(多腿)自动判定。 |
| `intel` | LLM 场外情报:RSS 新闻 → LLM 情绪 → `intel.json`,仅作小幅概率旁注(不自动并入)。 |
| `tmi` | 杯赛动能指数(Tournament Momentum Index):纯用已有 JSON 合成球队状态/动能榜,零新增 API 调用,观测性独立于胜率。 |
| `scenario` | **Phase 8d**「沙盘」情景推演。第三轮「每队最期望结果(整条晋级路径最易)」+ 整树 Monte-Carlo。`bracket.ts`(R32 M73–88 + 整树 M89–104 固定模板)、`thirdPlaceTable.ts`(FIFA Annex C 官方 495 行手工表,**非算法可复刻**,三源交叉验证)、`groupSim.ts`(2026 抢断:相互交锋先于总净胜 + 三队递归)、`knockout.ts`(名次→Annex C→R32→整树传播+点球)、`montecarlo.ts`(全赛事 MC + 按本队第三轮自身结果分桶的条件晋级深度 + 双方默契检测)、`pair.ts`(脱 feed 单对阵预测,泊松+Elo 无市场)、`compute.ts`(取实时积分榜+赛果→判轮次→跑 MC→落盘)。已赛钉死、未赛采样;随每场收官重算(挂 `settleWatcher`)。 |
| `odds` | 赔率 provider + 实时轮询 + 雷达(`radar.ts`)+ 跨家分歧(`bookDivergence.ts`)+ 初盘/闭盘捕获。 |
| `lineup` / `team` | 阵型坐标布局、球员状态、单队档案(雷达强度评分),均来自 ESPN summary。 |
| `espn` / `match` | 数据源适配 + 跨源归一化对齐(见上)。 |
| `tg` / `wx` | Telegram Bot 瘦客户端 / 微信(wx-link)接入,二者共用 `bets` 识别→结算管线。 |
| `i18n` | `context.tsx`(LocaleProvider,默认 `zh`)+ 文案/队名/盘口名字典。 |
| `db` / `api` / `hooks` / `format` / `data` / `weather` | 存储 / 响应信封 / SWR 钩子 / 时间格式 / 静态数据(FIFA 排名等) / 天气(open-meteo,免费)。 |

### 跨切面约定
- **响应信封**:接口统一返回 `{ success, data, error }`(`lib/api/respond.ts` 的 `ok` / `okLive`(no-store) / `fail`)。
- **管理员鉴权**:**没有共享 helper**——每个受保护路由内联同一段 `checkAuth(req)`(参考 `api/worldcup/engine/route.ts`):读 `process.env.ADMIN_TOKEN`,未设返回 null → 403「未启用」,否则比对请求头 `x-admin-token` → 不符 401。出现在 `engine`/`intel`/`trade/run`/`trade/reset`/`odds/capture-openings`/`epl/ingest`/`keys`/`bets`/`bettors`/`pnl-auth`/`scenarios/run`。(Telegram webhook 用 `TG_WEBHOOK_SECRET`;盈亏页用 `PNL_VIEW_PASSWORD`/`PNL_ADMIN_PASSWORD` 看改分权,见 `bets/viewAuth.ts`。)若做整改,这是一个值得收敛的复制粘贴点。
- **不可变**:遵循全局规则,改对象用 spread 返回新副本,不原地改。

### Cron 驱动的接口(部署脚本注册,见 `docs/DEPLOY.md` / `.github/workflows/deploy.yml`)
- `POST engine?days=N`(每日 4:30):摄取 ESPN 历史 + 权威 Elo → 重算评分;后台预热阵容/球队统计/球员分钟/射手榜(全免费,不耗赔率配额)。
- `POST intel?hours=N`(每 2 小时):刷新近期比赛场外情报。
- `POST trade/run`(每 15 分钟):结算已完成纸上注单 + Phase 9 注单,赛前下注,快照/结算预测日志。
- `POST odds/capture-openings`(每日 4:10):未开赛比赛初盘 write-once 捕获(幂等)。
- `POST scenarios/run`(每 20 分钟,部署后亦立即预热一次):重算「沙盘」情景推演(?sims=N 可覆盖)。事件驱动主路径已挂 `settleWatcher`(每场收官即重算),cron 仅兜底。

## 部署

生产宿主 **`dmitsvr`(`179.255.116.33`,DMIT LAX,Ubuntu 26.04)**——一台 nginx 边缘机(同时反代 design/invoce/sync.imava.net),**严格隔离**(端口 **3100** 绑 `127.0.0.1` / 目录 `/opt/apps/worldcup` / 独立 nginx `2026.vpanel.cc.conf`(`listen <IP>:80/443`)/ pm2 名 `worldcup` / 独立证书)。push 到 `main` 触发 GitHub Actions:**CI 构建 standalone 产物,dmitsvr 只跑不构建**;SSH 用**密钥认证**(`SSH_KEY`)。首配已手工完成(Node22+pm2+cron、按边缘机 webroot 约定建 nginx/证书、置哨兵 `/opt/.worldcup_setup_done` 让 CI 跳过自带 `certbot --nginx` 段)。〔2026-07 前生产在退役的 `nextpanel` VPS `38.175.193.100`,已整体迁来,域名不变。〕

- 运行时密钥**只经 `process.env` 注入**(部署脚本 export 后 `pm2 --update-env`),不写磁盘、不入库;standalone `server.js` 不读 `.env` 文件。所有 env 清单见 `deploy.yml` 的 `envs:` 与底部 `env:`。
- 持久化数据在部署目录之外的 `/opt/apps/worldcup-data`,`rm -rf APP_DIR` 重部署不会丢。
- 联赛回测数据:`seed/leagues/` 是唯一真相源,随产物带上、部署时覆盖播种到数据目录(工作流:本地 ingest → 刷新 `seed/` → 重部署)。
- 文档:`docs/PLAN.md`(总计划与隔离对照)、`docs/DEPLOY.md`(一次性配置)、`docs/需求说明书:*.md`(各 Phase 中文需求规格)。
