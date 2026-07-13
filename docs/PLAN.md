# 🏆 世界杯 2026 一站式 App — 项目计划

> 移动优先 PWA,聚合 **The Odds API**(赔率)+ **ESPN**(赛程/比分/积分/对阵),
> 部署到 **`2026.vpanel.cc`**(Nginx + PM2 + Certbot 栈)。
>
> **⚠️ 部署宿主变更(2026-07):** 生产已从退役的 `nextpanel` VPS(`38.175.193.100`)整体迁至边缘机
> **`dmitsvr`(`179.255.116.33`)**,域名不变。下文 Phase 6 中「nextpanel 同机/隔离对照」为历史语境;
> 当前权威部署说明以 `docs/DEPLOY.md` 为准。

最后更新:2026-06-14

---

## 1. 产品定义

一个面向手机的世界杯 2026 伴侣 App,四大板块:

- **🎲 赔率·夺冠** — 单场胜平负赔率 + 夺冠期货赔率(The Odds API)
- **📅 赛程·比分** — 按日期/小组/赛段浏览全部 104 场 + 实时比分 + 进球时间线(ESPN)
- **📊 积分榜** — 12 个小组 A–L 积分表 + 出线形势(ESPN)
- **🏆 淘汰赛对阵树** — 基于赛段数据(ESPN)

## 2. 技术栈(贴合 Horizon 模板)

| 维度 | 选型 |
|------|------|
| 框架 | Next.js 15.1.5(App Router) |
| UI | React 19 RC + TypeScript + Chakra UI 2.x + Tailwind 3 |
| 图表/表格 | ApexCharts · @tanstack/react-table |
| 数据获取 | SWR(轮询/缓存) |
| 形态 | 完整 PWA(可加主屏/全屏/离线壳) |
| 皮肤 | Horizon(品牌紫 `#4318FF` / 渐变 `#868CFF` / 20px 圆角 / 暗色 navy) |

## 3. 数据源(已实测验证)

### The Odds API — 赔率
- Base:`https://api.the-odds-api.com/v4`
- Key:配置在 `.env.local` 的 `ODDS_API_KEY`(已验证有效,配额 500/月)
- 世界杯单场:`soccer_fifa_world_cup`(`has_outrights:false`,markets=`h2h`,3-way:主队/客队/`Draw`)
- 夺冠期货:`soccer_fifa_world_cup_winner`(`has_outrights:true`,markets=`outrights`,忽略 `outrights_lay`)
- 默认 `regions=eu`、`oddsFormat=decimal`
- **计费**:`1 credit × regions × markets / 请求`;`/sports` 列表免费;`/scores` 带 daysFrom 耗 2
- **要点**:h2h outcomes 顺序不固定且用队名标识 → adapter 按 `name` 匹配 `home_team`/`away_team`/`Draw`

### ESPN(隐藏 API,免费无 key)— 赛程/比分/积分/球队/对阵
- 赛程+比分:`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=YYYYMMDD`
  - 字段:`events[].date`(UTC)、`name`、`season.slug`(`group-stage`/淘汰赛)、`competitions[].venue.fullName`
  - live:`competitions[].competitors[].score`、`status.type.state`(pre/in/post)、`status.displayClock`(分钟)
  - 进球/牌:`competitions[].details[]`(射手 `athletesInvolved[].displayName` + 分钟 + 类型)
- 积分榜:`https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026`
  - `children[]` = 12 个小组,每组 `standings.entries[]`,stats:`GP/W/D/L/F/A/GD/P/R`
- 球队:`https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/teams`(48 强)
- **风险**:非官方未文档化端点,可能变动/限流、ToS 灰色 → 服务端缓存 + 失败静默降级 + 不占赔率配额

### 比分-赔率对齐
按 **归一化队名 + UTC 开赛时间** 匹配。归一化层处理变音/别名(`Côte d'Ivoire↔Ivory Coast`、`Türkiye↔Turkey`、`Bosnia-Herzegovina`)。对齐失败则不显示赔率(不显示错值)。

## 4. 架构

```
4 Tab UI(移动 + PWA)
  ├ useSchedule / useLiveScores(20-30s)/ useMatchEvents / useStandings / useBracket
  └ useOdds / useWinner(SWR 准实时)
        │  /api/worldcup/{matches,winner,schedule,scores,events,standings,teams,bracket}
  OddsProvider→TheOddsApiProvider[key·缓存·配额守卫]   EspnProvider[多能力·缓存·容错降级]
        └────────── lib/match/normalize.ts(归一化 + UTC对齐)──────────┘
```

目录约定(贴合模板):页面 `src/app/admin/<板块>/page.tsx` + `src/routes.tsx` 注册;
组件 `src/components/worldcup/*`;数据层 `src/lib/{odds,espn,match}/*`。

## 5. 六阶段

### Phase 0 — 初始化 + PWA 脚手架
模板解压 ✓ · install · `git init` + GitHub 私有仓库 · `.env.local`(key) · PWA(manifest/SW/图标/safe-area) · `next.config` 加 `output:'standalone'`

### Phase 1 — 数据层
双 Provider + `normalize.ts` + 全部 Route Handler + 缓存 + 配额守卫 + ESPN 静默降级

### Phase 2 — 数据 Hooks
差异化刷新(比分 20–30s / 赔率准实时 / 赛程缓存数小时 / 积分赛后)+ 页面隐藏暂停

### Phase 3 — 移动框架 + 赛程·比分主页
`BottomTabBar`(4 Tab)+ PWA shell + 下拉刷新 + `MatchCard`(赛程+实时比分+LIVE+赔率入口+进球时间线)

### Phase 4 — 其余板块
赔率·夺冠页 + 积分榜页(12 组)+ 淘汰赛对阵树 + 设置页

### Phase 5 — 测试与验收
单元(adapter/归一化对齐/缓存/配额/hooks,80%)+ 移动 Lighthouse PWA + ESPN 容错

### Phase 6 — CI/CD + 同机部署(贴合 nextpanel 栈)
- **构建在 GitHub Actions**:lint/typecheck/test → `next build`(standalone)→ 打包 `.next/standalone`+`.next/static`+`public`
- **SSH 传产物**到 VPS `/opt/apps/worldcup`(复用 nextpanel 同机 `SSH_*` secrets);**VPS 只跑不构建**:`pm2 start node -- .next/standalone/server.js`(**PORT=3100**)
- **首次幂等**:独立 Nginx `sites/worldcup`(`server_name 2026.vpanel.cc → 127.0.0.1:3100`)+ `certbot --nginx -d 2026.vpanel.cc`
- **严格隔离不碰 nextpanel**:端口 3100 / 目录 worldcup / nginx sites/worldcup / pm2 `worldcup` / 证书独立
- **密钥**:`ODDS_API_KEY` 注入 VPS `/opt/apps/worldcup/.env`(`chmod 600`,仓库外)
- **Cloudflare**:`2026 → VPS IP`,**灰云**(DNS-only,复用 certbot --nginx)

#### 需在新 GitHub repo 配置(走 Secrets/Vars)
- Secrets:`SSH_HOST/SSH_USER/SSH_PORT/SSH_PASSWORD`(= nextpanel 同机)、`CERTBOT_EMAIL`、`ODDS_API_KEY`
- Vars:`DOMAIN=2026.vpanel.cc`

## 6. 配额与风险

- 配额:赔率 500/月(仅赔率·配额守卫兜底)· ESPN 免费(赛程/比分/积分全包,零占用)
- 风险:ESPN 非官方(缓存+静默降级)· 队名对齐(归一化+别名表)· 同机部署须严格隔离 · VPS 内存紧(CI 构建规避)· React 19 RC 安装(锁版本先验证 dev)

## 7. 同机部署隔离对照

| 资源 | nextpanel(现有) | 世界杯 App(新增) |
|------|------------------|------------------|
| 域名 | vpanel.cc | 2026.vpanel.cc |
| PM2 | nextpanel-server/web | worldcup |
| 端口 | 3000 / 3001 | 3100 |
| 目录 | /opt/apps/nextpanel | /opt/apps/worldcup |
| Nginx | sites/nextpanel | sites/worldcup |
| 证书 | certbot vpanel.cc | certbot 2026.vpanel.cc |
