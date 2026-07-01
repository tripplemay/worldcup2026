# 需求说明书:联赛策略研究平台 (Phase 10 - League Strategy Research Lab)

> 生成时间:2026-07-01(Asia/Shanghai)
> 状态:**待评审定稿**(定稿后先做 P0,再逐阶段推进)
> 范围:新建 `research/` 引擎 + 独立常驻进程 + 反过拟合评价治理脊柱;先**单联赛试点**跑通,再逐联赛复制。
> 关联既有结论:[市场情报转向] `docs/RLM 与正 EV 关系说明.md`、`docs/模拟盘下注策略 Review.md`;记忆 `market-intel-pivot` / `league-data-phase1` / `predict-minnow-defense-shrink`。

---

## 0. 一句话定位

在本仓库建一个 **headless、数据注入、可并发跑数千组参数**的研究引擎,配一套**反过拟合的评价治理脊柱**,以独立常驻进程在专机上持续搜参 / 前向模拟,**为单个联赛系统性判定「边际到底在不在、在哪个市场 / 时机」**,把任何「盈利策略」卡在 **CLV → 概率评分 → 样本外 ROI** 三道方差递增的闸门后,只让真·可复现的 edge 通过。验证成立后,再把**同一套框架**逐联赛复制(每个联赛各自独立跑通、各产出自己的冠军配置)。

---

## 1. 背景与必须对齐的现实

### 1.1 现有资产(比「初步框架」强)
- **无泄漏 walk-forward 回测底座**:`predictPointInTime`(`src/lib/predict/backtest.ts:43`,自算 Elo + 评分全来自该场之前)、`leagueBacktest.ts`(校准维度 Brier/logLoss/favBias/净胜球诊断)、`leaguePaper.ts`(P&L 维度)。
- **参数已收敛可 sweep**:预测侧 `hfaElo/hfaMult/goalShrink/shrinkEloScale/dcRho/marketWeight`(`tuning.ts`/`leagues.ts`);下注侧 `MIN_EV/MAX_EV/MIN_PROB/KELLY_FRACTION/MAX_STAKE_PCT/…`(`trade/config.ts`)。
- **免费历史赔率底座**:`seed/leagues/*` 已含 5 大联赛的 football-data **开盘 + 闭盘 1X2**;`clv.ts` 已有 CLV KPI/报告基础设施。

### 1.2 「打不过收盘线」是**下界**,不是终点(关键澄清)
`market-intel-pivot` 的 −34%~−65% 实证是在**最苛刻角落**得出:`leaguePaper.ts` 只测 **1X2**、且**照闭盘价当场下注当场结算**(代码写死「下注与结算同场」,**压根没有 CLV**)。它**没有**否死:早盘吃 CLV、亚盘全线 / 大小球、软盘。因此本平台的诚实立场:

> **大联赛主盘 vs 锐线,edge 大概率 ≈ 0。** 平台的价值 = ①干净证明这点而非自欺;②捞出 CLV 为正的早盘 / 市场特定口袋;③永不把运气当 skill。**「证否」也是合格产出。**

### 1.3 成功指标的选择(已与用户确认)
用户明确选定 **成功指标 = 样本外实盘 ROI**——所有目标里**最硬、最易被 data-mining 骗**的一个。故本平台的**评价治理脊柱即产品核心**(见 §5),不是配角;CLV 作为**低方差先行护栏**贯穿始终。

### 1.4 精度(地基)vs edge(产品):分层框架 + 精度作为独立交付物
**赚钱 = 精度【相对于所下注价格】的优势,不是绝对精度。** 闭盘去水概率本身就是公开可得的最准预测器(已聚合聪明钱 + 各家 xG 模型 + 伤停/首发/资金流)。故:
- **第 1 层(必要地基)= 预测精度**:自动调参的**内层**目标(Brier/LogLoss),越准越好——但天花板 = 市场精度。
- **第 2 层(真正产品)= edge**:精度**相对于一个可被打败的价格**的系统性优势(CLV → ROI),外层目标。二者是**不同目标函数,不能混**(内层选参用概率评分、外层才用 CLV/ROI,见 §5.2)。

关键三点:
1. **精度只在"可被打败的价格"处变现**:对着锐利闭盘线,精度提升只是更快收敛到市场早知道的答案(无 edge);对着开盘/软盘/薄盘才有缝。
2. **精度是 edge 探测的前提,不是安慰奖**:必须先有"整体 ≈ 市场级"的模型,才有资格去找"某分段我们比市场更好"的缝(逐分段 favBias 验证)。逼近市场精度与找 edge 是同一梯子的上下级。
3. **精度本身就是被珍视的交付物(用户确认)**:即便长期证否 edge,一个**自己拥有、透明、可控、OOS 对标闭盘/开盘/朴素基准、逼近市场精度**的预测引擎,是带得走的资产(反哺现有 App 预测/沙盘/情报,是未来一切方向的地基)。故成功轴 (C) 与 (A)/(B) 并列(见 §3)。**据此决定:近期可覆盖赛季接入真 xG(把预测引擎当正式交付物提质),早期赛季受数据限制回退射门代理 xG。**

---

## 2. 目标与非目标

### 2.1 目标
1. 把预测融合 + 模拟盘决策链抽成 **headless、数据注入、确定性、可并发**的研究引擎(单进程跑数千组参数无泄漏)。
2. 建**单联赛**的多市场历史赔率数据平台(免费 football-data 起步,数据源做成可插拔 adapter)。
3. 建**反过拟合评价治理脊柱**:三层时间隔离 + 嵌套 walk-forward + DSR/PBO/SPA + G0–G7 晋级闸门 + 试验注册表。
4. 建**持续搜参 / 前向模拟**的独立常驻进程,LLM 作分析员(提议 / 解读,不进优化环)。
5. 对试点联赛产出一份**可信的结论**:要么一个过全部闸门的冠军配置,要么一份「此联赛主盘无 edge」的可复现证否。

### 2.2 非目标(明确不做)
- ❌ **一次覆盖全部联赛**。**先单联赛跑通**(验证工程框架合理性 + 承认不同联赛策略可能不同),再逐联赛复制。
- ❌ 接真钱下注。本平台只产研究结论;接真钱是 G7 之后的独立决策。
- ❌ 把研究进程塞进生产 Next PM2 应用(躲开 `lib/odds/*` 的 globalThis 单例、避免与生产抢资源)。
- ❌ 让 LLM 进优化环 / 看 holdout / 定晋级。
- ❌ P5 之前砸钱买付费数据(先用免费数据证明流水线)。

### 2.3 试点联赛 = EPL(已定)+ 试点首要目标 = 跑通工作流
**英超(`key=epl-2025`;seed 已含 2023/24–2025/26 三季 1140 场,P2 扩到 football-data 全 ~7 季)。**

**试点首要目标(用户明确):把「自动调参 + 策略进化」这条工作流本身端到端跑通** —— edge 是次要产出。若 EPL 主盘证否(无 edge),用**同一套框架**转 football-data 上更软的联赛复测(见 §9 后续)。

理由:①已有 Phase 1 校准积累(`league-data-phase1`);②数据最全、闭盘最锐 → 工作流的**最严格压力测试**;③EPL 是最锐市场、edge 最不可能出现,故若脊柱在这里输出「无 edge」,恰好**验证了它能正确说『没有』**——这是工作流可信度的最好背书。

---

## 3. 成功指标与验收标准

| 层级 | 指标 | 阈值(单联赛试点) | 说明 |
|---|---|---|---|
| **先行护栏** | CLV(打败闭盘价) | n≥100 value 注、`t_CLV>2`、`avgClv≥+0.5%`、`posRate≥0.53` | 比 ROI 快 10–50× 收敛;**转负一票否决** |
| **头条验收** | 样本外实盘 ROI | `DSR>0.95` 且 `SPA p<0.05` 且 bootstrap ROI 95%CI 下界>0;n≥§5.4 要求 | 只在外层 OOS / L3 验收,**绝不用于选参** |
| **过拟合体检** | PBO | `<0.10` | CSCV(§5.3) |
| **稳健(单联赛版)** | 跨赛季 / 子周期 / 市场 | ≥2/3 年度子周期正;各市场分段无单段崩盘;锚定+滚动双切分均正 | 单联赛期**跨联赛稳健暂不适用**,转跨赛季 |
| **风控** | 回撤 | 历史最大回撤≤25%;MC 95 分位≤35%;无破产路径 | 一票否决破产路径 |
| **前向** | live 纸面 | 上线后累计≥150 注、CLV 维持 `t>2` | G7,谈真钱前置 |
| **精度交付物** | 对市场的 Brier 差距 gap-to-market | OOS Brier/LogLoss vs 闭盘/开盘/朴素基准(Elo-only、只押热门);gap 收窄且样本外稳健 | 成功轴 (C):edge 有无都产出;OOS + 对标,同受过拟合纪律约束;§5.2 内层已在算 |

**试点整体验收(三条,任一成立即为该轴成功;(C) 独立于 edge 有无)**:
- (A) 试点联赛产出**≥1 个过 G0–G6 全闸门的冠军配置**;或
- (B) 产出一份**可复现的证否**:该联赛主盘在样本外**无法拒绝「零 edge」**,且流程本身(注册表 / holdout / 闸门)证明这是纪律得出的结论而非搜索不够;或
- (C) 产出一个 **OOS 对标闭盘/开盘/朴素基准、逼近市场精度的可复现预测引擎**(gap-to-market 收窄且样本外稳健)——**无论 edge 有无都是实打实收获**(用户确认的独立成功轴,见 §1.4)。

---

## 4. 总体架构

### 4.1 research/ 引擎(headless、数据注入)
**抽离结论**(seam 映射,已 cite):纯核心几乎都在,`predictPointInTime` 已把 `allHist/allRes/tuning/sosEloOf/home/marketOdds/marketWeight` 全参数化。要做三件事:

**(A) 物理切开纯核心(消除「连坐 I/O」)** —— 把三个纯函数抽到无 I/O 姊妹文件,app 与 research 共用:
- `settle.core.ts`(`outcome`/`pnlFor`,脱 `espnProvider`/`loadTrades`)
- `odds.projection.ts`(`candidatesFromSnapshot` + `projectXxx`,脱 `cache`/`theoddsapi`/`afOdds`)
- `ratings.core.ts`(`computeElo`/`ratingsFromHistorical`,脱 `store`)

**(B) 堵住 4 处隐式全局(并发 sweep 的正确性命门)**:
1. **模型 registry 单例** → `predictPointInTime` 增 `models: PredictionModel[]` 参数,不走 `getModels()`(否则多 roster 撞车,同 id 去重挡掉变体)。
2. **`ensemble` 每次读 `process.env.PREDICT_WEIGHTS`**(`ensemble.ts:16`)→ 研究进程**必须 unset** 或删逃生舱(**最阴的坑**:会静默覆盖每个实验的 `marketWeight`+`eloDiff`,不报错、毒化全部 run)。
3. **`tuning.ts` env-baked 默认**(import 时冻结)→ 每次调用传**完整** `Tuning`,绝不留 env 回落(否则 sweep 某维度被默认值悄悄钉死)。
4. **`selectBest` 硬编码 `MIN_EV/MAX_EV/MIN_PROB`**(`router.ts:8`)→ 改成 `selectBest(cands, {minEv,maxEv,minProb})`。

**(C) 研究 driver** = 照抄 `leagueBacktest.ts:154-276` 的 loop(指标数学 / R1 累加 / 净胜球诊断原样搬),把 `loadLeague*`(`:90-92`)换成**注入数据集**;赛果来自数据集 → 直接对已知终分调 `outcome`/`pnlFor`(跳过 ESPN 结算);bankroll 用**内存不可变状态**穿针(不复用 `ledger.ts` 的全局 promise chain / 单调 seq)。

### 4.2 独立常驻进程形态
- 新 `research/` 树(建议 `src/research/` 或独立 `research/` 顶层),裸 Node CLI / daemon,**不进 Next 运行时**。
- 读**数据快照**、写**自己的数据目录**(与生产 `WC_DATA_DIR` 隔离);可部署到独立机器持续跑。
- 环境硬约束:`PREDICT_WEIGHTS` 必须 unset;不走 `runBacktest`/`store`/`predict.ts` 实时编排。

### 4.3 单进程跑数千组参数的泄漏清单(必须逐条堵)
Registry 单例去重、`ensemble` 读 env、`tuning`/`config` env 冻结、`normalize._normCache` 内存蠕变(良性)、`lib/cache` provider 残留(绕开)、`ledger` 全局 chain/seq(改内存 bankroll)。详见 §4.1(B) + 工程实现时对照 seam 清单逐项确认。

---

## 5. 评价治理脊柱(产品核心)

> 下注 P&L 信噪比 μ/σ≈0.02–0.05(比股票日收益还低一个量级),搜索空间 5¹⁵≈3×10¹⁰。ROI **禁止**作为选参主门;**CLV 先行、概率评分选参、ROI 最后验收**。

### 5.1 三层时间隔离(强制)
```
全部历史(试点联赛多赛季 + WC live 前向)
├── L1 训练/校准 60%   ← 内层参数 sweep 只能在此
├── L2 验证/选择 20%   ← 外层 walk-forward OOS,选晋级候选
└── L3 最终 holdout 20%(最靠后)← 优化器【永不接触】,一次性验收(用完即烧毁)
     + WC2026 live = 纯前向监控(样本小,只作方向确认)
```
- **时间锚定不可打乱**(足球有时间箭头);K-fold 随机切分泄漏未来 → 禁用。
- **L3 物理隔离**:`holdoutManifest.json`(遵 `store.ts` 的 `load*/save*`)记 holdout 比赛 ID 集 + 锁定 SHA/时间戳;评价代码按 manifest **硬过滤**,sweep 入口物理拿不到。

### 5.2 嵌套 walk-forward
- **锚定(扩张窗)**用于评分/Elo 状态(与生产一致);**滚动(1–1.5 赛季固定窗)**用于下注参数选择(暴露非平稳)。**候选必须两种切分下都为正**(仅锚定正、滚动转负 → 判「吃早期低效红利」拒绝)。
- **内层选参目标 = 概率评分(Brier/LogLoss)+ CLV**,**不用 ROI**(概率评分方差远小)。ROI 只在外层 OOS / L3 验收。
- **净化 + 隔离带**:按整轮 gameweek 边界切分、train↔test embargo 1 轮、按 `matchKey` 去重。

### 5.3 多重检验三件套(全过才算)
- **Deflated Sharpe(DSR)**:每注收益尺度;带偏度 γ₃ / 峰度 γ₄ 修正(下注收益强正偏厚尾,罚「运气尾」)。阈值 `>0.95`(候选)/`>0.975`(直通)。
- **PBO / CSCV**:性能矩阵(行=周/轮块,列=N 配置),S=16 组合对称 CV,`PBO<0.10`。
- **White RC / Hansen SPA**:基准=「跟随闭盘 / 不下注」;平稳自助保留块内自相关;优先 SPA(studentize + 剔垃圾策略)。`p<0.05`。
- **有效独立试验数 N_eff**:相关配置聚类抵消重复惩罚,但**探索方向数照实计入**(不得洗小分母)。

### 5.4 最小样本量(为什么单届 WC / 单赛季不够)
`n* = (z_{1-α}+z_{1-β})²·σ²/μ²`。ROI 通道 μ=3%、σ=1.0 → n*≈6900,再叠多重检验(N_eff=1000)→ ~25000 注;**故 ROI 显著性只能在「多赛季合并池(数千注)」上谈**,单赛季远不够。CLV 通道 σ≈0.04、μ=0.01 → n*≈100 注即显著 → **CLV 当先行护栏的量化依据**。

### 5.5 晋级闸门 G0–G7(串行,前闸不过后闸不测)
| 闸 | 判据 |
|---|---|
| **G0 构造无泄漏** | 只用 `predictPointInTime`/`live`;不用被 sweep 过数据上的 `reconstructed` 回填;切分含 embargo |
| **G1 CLV 先行** | n≥100 value 注、`t_CLV>2`、`avgClv≥+0.5%`、`posRate≥0.53` |
| **G2 ROI 显著** | `DSR>0.95` 且 `SPA p<0.05` 且 bootstrap ROI CI 下界>0;n≥§5.4 |
| **G3 过拟合体检** | `PBO<0.10`;IS-vs-OOS 退化斜率显著>0 |
| **G4 跨切面稳健(单联赛版)** | ≥2/3 年度子周期正;各市场分段无单段崩盘;锚定+滚动双正 |
| **G5 风控回撤** | 历史回撤≤25%;MC 95 分位≤35%;无破产路径;敞口集中度≤阈值 |
| **G6 最终 holdout** | **仅此一次**在 L3 评价:CLV 仍正 + ROI 不显著为负 + 无新崩盘;失败即淘汰、**holdout 烧毁** |
| **G7 前向纸面** | live 累计≥150 注、CLV 维持 `t>2`,方可考虑接真钱 |
> **一票否决**:G1(CLV 转负)、G5(破产路径)—— 无论 ROI 多亮都拒。

### 5.6 反 LLM/自动环「制造假赢家」六锁
1. **试验注册表 `trialRegistry.json`**:每评价一个配置,**看 OOS 前**先写 `{configHash,参数,SHA,dataSnapshotHash}` 并原子自增全局 N;DSR/Bonferroni 分母**用累计 N(含丢弃的)**→ 直接废掉「反复提交刷显著」;设 epoch 预算 N_max。
2. **提议者/裁判分离**:LLM/自动环只写注册表提议;指标由确定性、无 LLM、只读锁定切分的独立评价器算;**LLM 永不接触 L3、不写指标、不定晋级**。
3. 相似配置聚类得 N_eff 抵消重复惩罚,但原始 N 永久保留可审计。
4. 只认 `live`(真前向)入 G1/G7 信心;`reconstructed` 仅诊断。
5. 反 p-hacking:口径冻结(改指标/窗/白名单/结算规则 = 新试验,重置计数 + 重锁 holdout);序贯监控用 always-valid(e-value/mSPRT/群序贯),禁 optional stopping。
6. 可复现审计(每次落 `{gitSHA,dataSnapshotHash,参数,切分}`)+ 上线后滚动 CLV 监控自动降级。

### 5.7 新增持久化(遵 `store.ts` 约定,研究数据目录)
`trialRegistry.json` / `holdoutManifest.json` / `promotionLedger.json`(每候选各闸通过/否决 + 证据快照)。

---

## 6. 数据层

### 6.0 赛季数据量:必须多赛季(实测口径)
| 现状 / 可得 | 数字 | 用途 |
|---|---|---|
| seed 现有 EPL | **3 季(2023/24–2025/26)= 1140 场**,全含闭盘 1X2 | 立即可用 |
| P2 扩到 football-data | **~7 季(2019/20 起有开盘+闭盘列)≈ 2660 场** + 亚盘主线 + 大小球2.5 | CLV + 多市场回测底座 |
| pre-2019 | 有 1X2 **无闭盘** | 只能喂预测校准,测不了 CLV |

**量级现实(直接定期望)**:~2660 场**足够把 CLV 打到显著(仅需 ~100 注)**,但**达不到多重检验校正后的完整 ROI 显著性**(单联赛 μ=3% 需 ~6900 注,叠搜索惩罚 ~25000,见 §5.4)。→ **单联赛 EPL 的现实判据 = CLV 显著 + 工作流跑通**;完整 ROI 显著性留给「多联赛合并池」(后续)。**P2 必须摄取全部 ~7 季,不是 3 季。**

### 6.1 单联赛起步 + 可插拔 adapter
- **P2 只做试点联赛**的多市场历史赔率,数据源做成 adapter;免费 football-data 先跑通,**P5 才接付费**扩市场深度(亚盘全梯队 / 大小球全线 / 盘中 / tick)。
- 逐联赛复制:每加一个新联赛 = 重跑 P2–P5 的数据+搜索,框架不动、策略不复用。

### 6.2 新数据模型 `LeagueMatchOdds`(不动旧 `LeagueClosing`)
新增 `loadLeagueOddsX`/`saveLeagueOddsX`(`league-<key>-oddsx.json`,顶层 `Record<matchKey, LeagueMatchOdds>`):
- 键仍用 `matchKey`(队名对排序 + UTC 日),但**记录体内必存 `homeNorm/awayNorm`**——`matchKey` 排序**丢主客方向**,亚盘/让球是**有向盘口**,读端必须从记录体判方向(**已知坑**)。
- 每市场三时点 `MarketSeries<T> = { open?, close?, intraday?[] }`(与 WC 侧「初盘/闭盘 write-once + 实时时序」同构)。
- 亚盘/大小球全线用 `{line, …}[]` 数组(含 ±0.25/±0.75 四分盘);逐家 `books[]` + 一份 `consensus`(去水均值/Pinnacle 优先)供模型直接消费。
- **向后兼容**:`consensus.x2.close.{h,d,a}` 就是旧 `LeagueClosing`;投影函数 `toLeagueClosing()` 让现有 `leagueBacktest.ts:155-168` 零改动。
- 摄取仿 `ingestFootballDataOdds`(`eplIngest.ts:34-82`):队名过 `fdAlias/providerAlias` → `normalizeTeam` → `matchKey` 入键;多季 merge 叠加勿覆盖;football-data `DD/MM/YYYY` 经 `fdDateToISO` 取正午 UTC 避日界。

### 6.3 付费源(P5,带价对比)
| 源 | 补免费层缺的 | 价格 | 契合 |
|---|---|---|---|
| **Betfair 历史** ⭐ | 成交量 + 全价档深度 + 赛前/盘中逐笔 tick + BSP 金标准闭盘 | Basic 免费;Advanced/Pro 按量,低百英镑 | 8/10 |
| **Pinnacle 聚合商** | 全亚盘四分盘梯队 + 大小球全线 + 每跳线动 + devig | bettingiscool 几十$/mo;SportsGameOdds $99/mo | 7/10 |
| The Odds API historical | 5 分钟盘中快照(线动/RLM) | $249/mo(15M) | 6.5/10 |
| ~~OddsJam/OpticOdds/Sportradar~~ | 内容最全但企业价 ~$5k/mo + 销售门槛 | 数千$/mo | 避开 |
> 注意:Pinnacle 官方 API 2025-07 已对公众关闭,聚合商为灰色转售;Betfair 官方最稳。

---

## 7. P0 前置:亚盘四分盘(.25/.75)EV/结算修复(阻断项)

**不修则任何回测盈利都是假的**;且同时修好生产模拟盘那 22/30 笔失真 AH 单,是风险最低、收益立现的第一刀。

### 7.1 错在哪(cite)
- 投影 `projectAsianHandicap`(`trade/projection.ts:80-96`):`point=±.25/.75` 时 `d` 永不为 0 → `push` 恒 0,只产二元 `homeCover/awayCover`,边界档整块算进赢或输。
- 候选(`trade/odds.ts:83-97`):`pPush=0`、`pWin` 混入本应半赢/半输的档 → 喂 `scoreCandidate` 算 EV/Kelly 已错。
- 结算(`trade/settle.ts:88-92`):四分盘 `margin` 分数永不为 0 → 只返 won/lost,**永不半赢半输**。
- **偏差有向**:.75 线系统性**高估** EV `+pHalf·b/2` → Kelly 虚高 → 被 `selectBest` 顶榜首 → 系统押入灌水 -EV 单;.25 线系统性**低估** `−pHalf·0.5` → 漏真价值单。

### 7.2 正确参考
`src/lib/bets/settle.ts:63-127`:`isQuarterLine=Math.abs((line*4)%2)===1`;拆 `line±0.25` 两条相邻 .0/.5 盘,各判后聚合(`won&won→won`;`lost&lost→lost`;一赢一走→`half_won`;一输一走→`half_lost`)。

### 7.3 修正模型
```
EV = pFullWin·b + pHalfWin·(b/2) − pHalfLoss·0.5 − pFullLoss     (b=odds−1)
结算 5 值枚举:full_won | half_won | push | half_lost | full_lost
pnlFor:  full_won→stake·(odds−1) / half_won→…/2 / push→0 / half_lost→−stake/2 / full_lost→−stake
settleTrade 统一 payout = stake + pnl(替换 ledger.ts:111-113 硬编码分支);half_won 计胜、half_lost 计负、push 不计
```

### 7.4 要改的文件
`projection.ts`(加 `projectAsianHandicapQuarter`)、`ev.ts`(加 `expectedValueQuarter/kellyQuarter`)、`odds.ts:83-97`(`isQuarterLine` 分流)、`router.ts:12-20`(`scoreCandidate` 识别四分盘)、`settle.ts:88-100`(`outcome`/`pnlFor` 扩 5 值)、`ledger.ts:100-124`(payout 统一)、`types.ts`(枚举扩展,建议低侵入:持久化仍 won/lost/void,靠 `pnl` 精确表金额)。`isQuarterLine` 提公用工具消 bets/trade 复制粘贴。连带 `leaguePaper.ts:127-128` 自动受益。

### 7.5 测试(TDD,先红)
8 条结算用例(−0.75 赢1=half_won +50 / −0.75 赢2=full_won +100 / −0.75 平=full_lost −100 / −0.25 平=half_lost −50 / +0.25 平=half_won +50 / +0.25 输1=full_lost −100 / 客+1.25 输1=half_won +50 / 整数半盘回归)+ 投影四类概率和=1、边界档精确 + EV↔PnL 闭环(`placeBet→outcome→pnlFor→settleTrade` 净额一致)。

---

## 8. 搜索/调参 + 资金管理 + LLM + 可视化

### 8.1 参数空间(两阶段,**edge 与 sizing 必须分离**)
grid 起步 → 贝叶斯优化;试点期先窄网格锁定流水线,再放宽。分两档、用**不同目标函数**:

**阶段 A —— edge 发现(决定「押哪些、什么价」)**:预测侧 6 参(`hfaElo/hfaMult/goalShrink/shrinkEloScale/dcRho/marketWeight`)+ 下注侧筛选参(`MIN_EV/MAX_EV/MIN_PROB`)+ RLM/R1 veto 开关 + **市场白名单**。
- **目标函数 = CLV + 单位注 ROI(与杠杆无关)+ 概率评分**;**绝不用复利终值**。

**阶段 B —— 资金管理(决定「押多大」)**:`KELLY_FRACTION / MAX_STAKE_PCT / MIN_STAKE / COVERAGE_STAKE_PCT / 各市场 stake cap`。
- ⚠️ **坑**:Kelly 系数**不能**和别的参数一起对「最大化 ROI/终值」调——优化器必发现「越接近满 Kelly 回测终值越高」,实盘爆仓。
- **目标函数 = 风险调整**(期望对数增长 / CAGR÷MaxDD / 权益曲线 Sortino),**G5 回撤闸当硬约束**;**Kelly 系数限定合理带(如 0.1–0.5)**——分数 Kelly 的意义就是对 edge 估计噪声的稳健性,我们的 edge 估计有噪声,不该允许调到满 Kelly。现状 1/4 Kelly 可能过保守,此阶段专门验证。

### 8.2 LLM = 分析员
读回测结果、提假设(「测大小球早盘」「降级前 3 轮」)、写诊断报告;**不进优化环、不看 L3、不算指标、不定晋级**(提议者/裁判分离,§5.6)。塞进优化环只会加噪声+成本+过拟合。

### 8.3 前向衰减监控
晋级后挂滚动 CLV 监控,`t` 跌破阈值(市场变锐/edge 被吃)→ 自动降级。

### 8.4 调参可视化面板(round-over-round)—— 用户核心诉求
研究进程每 epoch 落 `tuningTimeline.json`(+ `trialRegistry`/`promotionLedger`),面板**只读**这些渲染,零干扰研究进程。**5 块**:
1. **进度时间线**:横轴 epoch,每格标「本轮试验数 N / 冠军指标 / 闸门状态色块」——一眼看搜索走到哪、收敛还是发散。
2. **本轮 vs 上轮 Diff 卡(核心)**:并排上轮冠军 ↔ 本轮冠军 —— **参数增量表**(每参 旧→新 + 箭头幅度)+ **指标增量**(CLV avgClv/t、OOS ROI、DSR、PBO、SPA p 各 Δ,红绿标向好/坏)+ **闸门翻转**(哪些 G0–G7 过↔否)。
3. **冠军演化曲线**:CLV/ROI/DSR/PBO 随 epoch 的 sparkline;L3 holdout 只在最后一次点亮。
4. **本轮候选榜**:本轮所有配置排行(按内层选参目标)+ 各 veto 拦截原因分布。
5. **参数边际响应**:每参 vs 目标指标散点/热力,看哪参在驱动改善、哪些已饱和(辅助人工/LLM 提下一轮假设)。

**落点**:研究进程在独立机器 → 面板先做**读 JSON 的静态 HTML 报告(每轮重生成)**,零耦合、可离线看;稳定后再考虑并入 app 的 `/research` 只读页(若研究数据同步到 app 数据目录)。**提前到 P4** 交付(边跑边看)。

---

## 9. 分阶段路线图 + 验收

| 阶段 | 内容 | 复杂度 | 验收 |
|---|---|---|---|
| **P0** | AH 四分盘 EV/结算修复 + 8 测试(TDD) | Medium | jest 全绿;`leaguePaper` 下界读数变干净;生产 AH 历史可标注 |
| **P1** | 核心抽离(3 core 姊妹文件)+ 堵 4 全局 + headless 引擎 driver | High | 研究引擎能对注入数据集**确定性**复现 `leagueBacktest` 结果(同输入同输出) |
| **P2** | `LeagueOddsX` 模型 + adapter 化 + **EPL 全 ~7 季**免费 football-data 摄取(2019/20+ 开+闭盘) | Medium | ~2660 场入库、对齐率达标、`toLeagueClosing` 向后兼容通过 |
| **P3** | 评价脊柱:切分 manifest + trialRegistry + DSR/PBO/SPA + 嵌套 walk-forward + G0–G7 + **风险调整目标(阶段B)** | **High**(智力核心) | 对已知配置能跑完整闸门评估、输出 `promotionLedger`;holdout 物理隔离验证 |
| **P4** | 搜索环(**两阶段:edge / sizing**)+ 独立常驻进程 + LLM 分析员层 + **调参可视化面板(§8.4)** | Medium-High | 进程可持续搜参、注册表钉死分母、**面板可看每轮 + round-diff**、产出 EPL 结论(冠军配置 或 可复现证否) |
| **P5** | 付费源接入(试点联赛亚盘全梯队/盘中/tick)+ 报告看板 + 前向监控 | Medium | 付费数据扩市场后重跑、结论更新 |
| **后续** | **逐联赛复制** P2–P5(框架冻结,每联赛独立跑通) | 每联赛 Medium | 每联赛各自 `promotionLedger` |

**里程碑**:P0→P4 在**免费试点联赛**上端到端跑通、拿到第一份诚实结论 = 平台可行性验证成功。

---

## 10. 风险 + 开放问题

### 风险
1. **过拟合(头号)** —— §5 整套脊柱压制,纪律须制度化(注册表钉死分母、口径冻结、禁 optional stopping)。
2. **付费数据 ToS/连续性(P5)** —— 聚合商灰色转售、抓取脆弱;Betfair 官方最稳。
3. **有向盘口对齐** —— 新模型必须靠记录体内 `homeNorm/awayNorm` 判方向。
4. **最可能结论是「无 edge」** —— 这是平台存在的意义;证否也是合格产出。

### 开放问题
- ~~**O1 试点联赛**~~ → **已定 EPL**(2026-07-01);试点首要目标=跑通工作流,EPL 证否则同框架转软联赛。
- O2 `research/` 落点:`src/research/` vs 独立顶层 `research/`(工程实现时定,不阻塞)。
- O3 独立常驻进程的宿主机:先本地长跑,还是一开始就上独立 VPS?(P4 前定)
- O4 面板落点:先静态 HTML 报告(建议)vs 直接做 app `/research` 页(P4 前定)。

---

## 附:关联代码锚点(绝对/仓库相对)
- 纯核心:`src/lib/predict/{backtest,ensemble,ratings,tuning,divergence}.ts`、`models/{poissonCore,index}.ts`、`registry.ts`
- 交易链:`src/lib/trade/{ev,router,projection,odds,settle,ledger,config,types}.ts`
- 对齐/存储:`src/lib/match/normalize.ts`、`src/lib/db/store.ts`
- 现成模板:`src/lib/predict/{leagueBacktest,leaguePaper,leagues}.ts`
- CLV/前向:`src/lib/predict/{clv,predictionLog}.ts`
- P0 正确参考:`src/lib/bets/settle.ts:63-127`
