# 实施方案：盘口时序底座 + CLV 真值靶 + 微观异动雷达 (Phase 8c 合并版)

> **合并背景**：Phase 8c(微观异动雷达)与 CLV 真值靶**共用同一套数据底座**(逐场赔率时序 + 去水 True_IP)。闭盘价就是时序的最后一点;雷达的「市场拒绝(RLM)」就是实时版 CLV 审计。故合并为**一套工程、三层楼**:
> **A 地基(赔率时序 + 去水 + 闭盘) → B CLV 真值靶(模型校准 + 模拟盘 KPI) → C 异动雷达(产品 + 风控)**。
> **日期**:2026-06-19。**代码基线**:Next.js 15,单 PM2 实例,JSON 存储。

---

## 0. 一箭三雕(为什么合并)
1. **模型**:CLV 提供**逐场、连续的高密度真值靶** → 解我们卡住的 R1(泊松错配欠自信"测不准":28 场二元结果噪声太大,改用闭盘价做靶)。
2. **模拟盘**:正 CLV 是**盈利的领先指标**(比等几百注 P&L 快);RLM 提供**临场风控拦截**(避免下负 CLV 坏注)。
3. **产品**:多一个「⚡异动」情报流(steam / 关键线击穿 / 市场拒绝)。

---

## 1. 架构原则(与现状对齐 —— 对原 8c spec 的修订)
| 原 spec | 本方案修订 | 原因 |
|---|---|---|
| 新建 `global.oddsBuffer` | **复用现有 `globalThis.__wcLivePoller`**,在其 state 上加时序环形缓冲 + alerts | 已有单例轮询器(~36s,含 `marketsById` 全盘口);另起炉灶会跑双定时器 |
| "36s 全量比赛" | **仅最近 N 场(临近开赛/进行中)** 36s 级 | odds-api.io 限 100/小时,`/odds/multi` 10 场/次 + 自适应配速,做不到 48 场全程 |
| "Smart Money / Steam" | 措辞降级为 **"线在动(line movement)"** | Bet365 是**跟盘**大众盘,非 Pinnacle 锐盘;线动为真,但未必是聪明钱 |
| 每 36s 写盘 | 内存环形缓冲 + **5min 异步原子落盘** | 防高频 I/O;复用 store 写入(确认原子:tmp+rename) |
| 去水比例法 | v1 用**比例法**;留 Shin 法接口(对热门-冷门偏差更稳) | 够用即可,后续可升 |

**关键效率点**:整套**几乎零新增 odds-api.io 配额** —— 时序只是**保留**每拍本就拉取的数据;闭盘价是开赛前已有的最后一拍;雷达检测纯内存计算。

---

## 2. Phase A —— 地基(赔率时序 + 去水 + 闭盘)

### A1. 去水基石 `calculateTrueIP`(`lib/odds/trueIP.ts`,纯函数)
- **1X2(三项)**:`Sum=Σ(1/odds)`;`True_IP_x=(1/odds_x)/Sum`。
- **两项(AH/OU)**:`True_IP=(1/odds_a)/((1/odds_a)+(1/odds_b))`。
- 是 A/B/C 所有计算的唯一概率来源。**严禁用未去水的简单倒数。**

### A2. 时序环形缓冲(扩展 livePoller state)
- `__wcLivePoller.series: Record<matchId, Snapshot[]>`;`Snapshot = [ts, h, d, a, ahLine, ahHome, ahAway]`(紧凑数组,省体积)。
- 每次 `doTick`:对在跟踪的每场 append 当前快照;**每场上限 200 点**(超出剔最老),防内存溢出。
- AH 线从 `marketsById`(已有全盘口)取。

### A3. 异步落盘
- 独立 `setInterval` 每 **5min** 把 `series` + `alerts` 原子写入 `odds-snapshots.json`(复用 store/`write-file-atomic`;非阻塞)。

### A4. 闭盘价捕获(write-once)
- 轮询器对**仍 pending** 的每场持续刷新"最新赔率";当该场**翻入 live / 离开 pending 列表**(即开赛)→ 把**最后一拍**冻结为闭盘价 → `closing-odds.json`(键=matchId,write-once)。
- 与现有**初盘**(`opening-odds.json`,首见 write-once)对称;复用同一捕获模式(初=first,闭=last)。

**A 产出**:逐场赔率时序(内存+落盘)+ 初盘(已有)+ 闭盘(新)+ 去水函数。

---

## 3. Phase B —— CLV 真值靶(模型校准 + 模拟盘 KPI)

### B1. 闭盘隐含概率
对每场用 `calculateTrueIP(closing)` 得闭盘 1X2 真值(去水)。

### B2. 校准报告 `GET /api/worldcup/clv-report`
- 对每场**有闭盘价 + 有预测存档**(`predictions-log.json` 已有)的比赛,比较各模型概率 vs 闭盘 True_IP:
  - 逐模型(**poisson-xg / poisson-goals / elo**;融合仅供参考)对闭盘的**平均绝对偏差**;
  - 按置信分箱的**校准曲线**;
  - **错配子集**(闭盘隐含热门方强):泊松是否系统性低估、低估多少。
- **干净对比是市场无关的泊松 vs 闭盘**(融合本就含市场锚 0.2,自比循环,标注)。
- → **这才是 R1 的有效真值靶**:用上百场连续概率而非 28 场二元结果,量出"泊松错配欠自信"的真实幅度,指导要不要/怎么修。

### B3. 模拟盘 CLV KPI
- 每笔已结算注:`下注赔率 vs 闭盘赔率` → CLV;
- 账本/`model-stats` 增:**正 CLV 占比 + 平均 CLV**;模拟盘页展示。
- 意义:**领先于 P&L 的 edge 指标**——若持续正 CLV,即便短期 P&L 波动也说明策略有效。

**B 产出**:回答 R1 的真值靶 + 模拟盘 edge KPI。**(本层最该先做,解模型卡点。)**

---

## 4. Phase C —— 异动雷达(产品 + 风控)

### C1. 异动检测 `detectMicrostructureAnomaly`(全部基于去水 True_IP)
- **闪崩/线动(Steam,§2.1)**:1X2,`ΔTrue_IP(近~3min) ≥ +0.025` → 报警。
- **关键线击穿(§2.2)**:AH 主盘口线跨越关键数 `{0, −0.5, −1.0}`,且破位后 `True_IP_new > 0.48`(防诱盘假动作)。
- **市场拒绝/RLM(§2.3)**:开赛前 ≤1h,`Ensemble_Prob > 0.60` 但 `Drift = Ensemble − 市场True_IP ≥ +0.10` 且市场 True_IP **持续下降** → 风控报警。
- alerts 进 series 缓冲 + 落盘。

### C2. 雷达信息流 UI(`(wc)/radar`)
- 底部 `BottomTabBar` 加「⚡异动」Tab;
- 倒序信息流卡片:类型 Icon + 队名 + 相对时间 + **去水 True_IP 绝对增减(辅原始赔率)** + 30min True_IP **SVG sparkline**;
- RLM 卡片底色灰红,并给该场在预测列表打"警告"角标。

### C3. 模拟盘 RLM 风控钩子
- RLM 触发的比赛 → **拦截/标记**该场下注(接入 `prematch`/`router`):避免下"市场强烈拒绝"的负 CLV 注。
- 与 Phase 8 模拟盘闭环:预测 → 路由 → **RLM 风控** → 下注。

**C 产出**:异动情报产品 + 模拟盘临场风控。

---

## 5. 数据结构
```jsonc
// odds-snapshots.json(5min 落盘;内存为权威)
{ "lastFlushed": 0,
  "matches": { "<matchId>": {
    "baseline": { "h":1.5,"d":4.5,"a":6.5,"ahLine":-1.0,"ahH":1.95,"ahA":1.85 },
    "snapshots": [ [ts,h,d,a,ahLine,ahH,ahA], ... ],   // 上限 200
    "alerts": [ { "id","ts","type":"STEAM|BREAKOUT|RLM","severity","message" } ]
}}}
// closing-odds.json(write-once,开赛冻结)
{ "<matchId>": { "capturedAt":ts, "h","d","a", "ahLine","ahH","ahA" } }
```

---

## 6. 配额与边界
- **odds-api.io 100/小时**:复用现有轮询,**新增 ≈0**;36s 级仅覆盖最近 N 场(临近/进行中);闭盘=已有最后一拍。
- 内存:每场 ≤200 点环形缓冲;5min 落盘。
- **覆盖范围明确**:steam/RLM 只对**临近开赛/进行中**有效(本就只在此时有意义),不承诺远期全量。

---

## 7. 复用点对照(已有 vs 新增)
| 能力 | 状态 |
|---|---|
| ~36s 实时轮询 + `marketsById` 全盘口 | ✅ `lib/odds/livePoller.ts` |
| 初盘 write-once + 每日批量 + cron | ✅ `opening-odds` |
| 预测存档(供 CLV 对照) | ✅ `predictions-log.json` |
| 模拟盘账本/路由/结算 | ✅ Phase 8 |
| settleWatcher(状态探测) | ✅ 可复用其 pre→in 检测 |
| **去水 True_IP / 时序缓冲 / 闭盘捕获 / CLV 报告 / 雷达检测+UI / RLM 钩子** | 🔲 本方案新增 |

---

## 8. 验收与指标
- **A**:`odds-snapshots.json` 正常落盘、每场 ≤200 点;`closing-odds.json` 随开赛逐场写入;`calculateTrueIP` 单测(三项/两项、和=1)。
- **B**:`/clv-report` 给出逐模型对闭盘偏差 + 错配子集;**首个可量化结论**:泊松错配欠自信幅度(回答 R1);模拟盘正 CLV 占比上线。
- **C**:三类 alert 在临近开赛/进行中正确触发;UI 信息流 + sparkline;RLM 能拦截下注。

---

## 9. 风险与注意
1. **Bet365 非锐盘**:线动 ≠ 必然聪明钱;RLM/steam 当"市场信号"用,别过度解读。
2. **去水偏差**:比例法对热门-冷门有小偏;CLV 当"最佳可得估计"而非"上帝真值"。
3. **循环**:融合含市场锚 → CLV 校准**只信泊松 vs 闭盘**这条干净对比。
4. **样本**:CLV 靶虽密,极端错配场仍随赛程积累;R1 结论待小组赛后更稳。
5. **不破坏现状**:全部增量;轮询配额、模拟盘、预测默认行为不变。

---

## 10. 建议次序与决策门
1. **A 地基**(去水 + 时序 + 闭盘)——一切的基础;
2. **B CLV 校准 + 模拟盘 KPI**——**先做**,因为它解 R1 模型卡点、给模拟盘 edge 指标;
3. **C 雷达 UI + RLM 风控**——产品层,最后做。

> 每阶段独立可上线、独立验收;A 完成即免费拿到闭盘价,B 完成即能回答"泊松到底该不该修",C 完成即上线产品 + 风控。
