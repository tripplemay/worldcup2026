# 需求说明书：自动化模拟交易与泊松投影引擎 (Phase 8)

## 1. 模块概述 (Module Overview)

本模块是系统的“交易执行层”。它包含两大核心组件：

1. **泊松投影引擎 (Poisson Projection)**：将基础比分矩阵降维映射到各种复杂的衍生盘口（大小球、亚盘等），实现同一场比赛多玩法的全覆盖。
    
2. **自动化模拟交易与账本 (Paper Trading)**：构建基于 JSON 静态文件的虚拟资金管线，通过智能盘口路由（Smart Router）自动挑选单场 EV 最高的玩法进行虚拟下注与赛后结算。验证策略的真实盈利能力。
    

## 2. 核心算法：泊松矩阵降维投影 (Poisson Projection)

系统必须能够计算所有主流盘口的概率，确保数学模型的自洽。

### 2.1 投影原理与规则

基于预测引擎输出的 $10 \times 10$ 泊松比分矩阵（x=主队进球，y=客队进球），执行“降维求和”：

- **胜平负 (1X2)**: 主胜(x>y), 平局(x==y), 客胜(x<y)。
    
- **大小球 (Over/Under 2.5)**: 大球(x+y > 2.5), 小球(x+y < 2.5)。
    
- **双方进球 (BTTS)**: 是(x>0 且 y>0)。
    
- **亚洲让分盘 (Asian Handicap, 如主队 -1.5)**: 主赢盘(x - y > 1.5)。
    

### 2.2 TypeScript 核心实现

开发 Agent 需在 `utils/poissonProjection.ts` 中实现矩阵降维方法：

```
type PoissonMatrix = number[][]; 

export interface MarketProbabilities {
  matchWinner: { home: number; draw: number; away: number };
  overUnder25: { over: number; under: number };
  btts: { yes: number; no: number };
  asianHandicap: Record<string, { homeCover: number; awayCover: number }>;
}

export function projectMarkets(matrix: PoissonMatrix): MarketProbabilities {
  let pHome = 0, pDraw = 0, pAway = 0;
  let pOver25 = 0, pUnder25 = 0, pBttsYes = 0, pBttsNo = 0;
  let ahHomeMinus15 = 0;

  for (let x = 0; x < matrix.length; x++) {
    for (let y = 0; y < matrix.length; y++) {
      const prob = matrix[x][y];
      // 1X2
      if (x > y) pHome += prob;
      else if (x === y) pDraw += prob;
      else pAway += prob;
      // Over/Under
      if (x + y > 2.5) pOver25 += prob;
      else pUnder25 += prob;
      // BTTS
      if (x > 0 && y > 0) pBttsYes += prob;
      else pBttsNo += prob;
      // AH -1.5
      if (x - y >= 2) ahHomeMinus15 += prob;
    }
  }

  return {
    matchWinner: { home: pHome, draw: pDraw, away: pAway },
    overUnder25: { over: pOver25, under: pUnder25 },
    btts: { yes: pBttsYes, no: pBttsNo },
    asianHandicap: { "-1.5": { homeCover: ahHomeMinus15, awayCover: 1 - ahHomeMinus15 } }
  };
}
```

## 3. 虚拟账本与数据结构 (Paper Ledger)

在后端静态存储目录中，新增两个 JSON 文件管理资金。必须注意通过 Node.js `fs.writeFileSync` 同步写入以防并发冲突。

### 3.1 `wallet.json` (账户总览)

```
{
  "initial_balance": 10000.0,
  "current_balance": 10540.2,
  "locked_balance": 200.0,
  "total_trades": 45,
  "win_rate": 0.58
}
```

### 3.2 `trade_logs.json` (交易流水)

```
[
  {
    "trade_id": "tr_1001",
    "match_id": "match_88",
    "date": "2026-06-12T15:00:00Z",
    "market_type": "OVER_UNDER",
    "selection": "Over 2.5",
    "market_odds": 1.95,
    "model_prob": 0.58,
    "ev": 0.131,
    "stake": 150.0,
    "status": "pending", 
    "result": null,
    "pnl": null
  }
]
```

## 4. 智能盘口路由 (Smart Market Router)

单场比赛只能下一个注。路由器的职责是在所有正 EV 选项中挑选最优解。

**决策算法步骤：**

1. **跨盘口扫描**：针对拉取到的 1X2、大小球、亚盘赔率，分别结合泊松投影概率，计算期望值 (`EV`) 和凯利比例 (`Kelly`)。
    
2. **方差过滤 (Variance Filter)**：强制过滤掉胜率极低的高赔率盘口（例：剔除 `model_prob < 0.30` 的选项），防止资金池剧烈回撤。
    
3. **风险调整排序**：将剩余的正 EV（`EV > 0.03`）候选项，按 `Kelly Fraction` 降序排列。
    
4. **互斥斩杀**：强制只取列表中的第一名（最优解）执行下注动作，抛弃同场比赛的其他选项。
    

## 5. 前向模拟交易管线 (Forward Paper Trading Pipeline)

基于 Cron Job 或 API 触发的定时管线。

### 5.1 赛前下单任务 (Pre-match Betting Cron)

- **时机**：距比赛开赛 1 小时。
    
- **逻辑**：
    
    1. 调用 The Odds API 获取本场最新各个盘口的实时赔率。
        
    2. 运行融合预测引擎与泊松投影，获取各盘口概率。
        
    3. 通过“智能盘口路由”选出最优解。
        
    4. 扣减 `wallet.json` 中的 `current_balance`（转入 `locked_balance`），按四分之一凯利或固定比例生成 `stake`。
        
    5. 往 `trade_logs.json` 写入一条 `status: "pending"` 的日志。
        

### 5.2 赛后结算任务 (Post-match Settlement Cron)

- **时机**：赛后状态变为 `FT`（与 TMI 更新脚本合并）。
    
- **逻辑**：
    
    1. 扫描 `trade_logs.json` 中所有的 `pending` 交易。
        
    2. 根据实际赛果和盘口类型（如加总双方进球数判断大球是否打出），判定交易 `result` 为 `won` 或 `lost`。
        
    3. 计算 `pnl` (赢则为 `stake * (odds - 1)`，输则为 `-stake`)。
        
    4. 解冻 `locked_balance`，将本金和利润更新回 `wallet.json` 的 `current_balance`。
        

## 6. 移动端 UI 呈现规范 (Mobile Dashboard)

在当前的移动端 JSON 架构下进行 UI 展现。

### 6.1 路由与导航集成

- 在 `(wc)` 路由组的 BottomTabBar 中，新增核心入口：**“💰 模拟盘 (Paper Trade)”**。
    

### 6.2 视图设计 (Tailwind CSS)

1. **资金仪表盘 (Header Panel)**：
    
    - 极简显示 `当前余额`（高亮），以及 `初始本金`。
        
    - 显示整体 `投资回报率 (ROI)` 和 `胜率`。
        
2. **流水卡片流 (Trade History Feed)**：
    
    - 以列表形式展示 `trade_logs.json` 数据。
        
    - **未结算 (Pending)** 卡片使用灰色/蓝色边框，标明“进行中”，显示预估可能赢取的金额。
        
    - **已结算 (Settled)** 卡片使用醒目的红绿色区分：赢单 (`+ PNL`) 翡翠绿，输单 (`- PNL`) 警示红。
        
    - 卡片内需清晰展示：赛事队名、玩法 (如 Over 2.5)、下单赔率 vs 模型胜率、EV。

---

## 7. 实现纪要 (Implementation Addendum · v1)

> 落地时相对初稿的口径与取舍,记录于此。

### 概率口径(关键)
- **市场无关**:EV 全程用不含市场项的模型概率,避免与市场「自我对碰」抹平 edge。
  - 衍生盘(大小球/BTTS/亚盘):由 **xG 泊松矩阵** 投影(`buildMatrix` 暴露归一化比分矩阵)。
  - 1X2:用**去掉市场项重新归一的 ensemble**(泊松+Elo)。
- 投影支持**任意** O/U / 亚盘线,整数盘含**走盘 push**。

### 路由与注金
- 过滤 `pWin < 0.30`(方差过滤)与 `EV ≤ 0.03` → 按 Kelly 降序 → **单场只取第一名**(互斥)。
- **四分之一凯利** × 当前余额,夹在 [最低 10, 余额 5% 上限] 之间(防早期梭哈)。

### 赔率来源
- 1X2 复用 `odds:matches`(h2h,通常已热)。
- 让球/大小球:**赛前轻量拉一次**(`ensureMatchMarkets`,与详情页同键 `odds:markets:{id}:handicap` 共享缓存,30min TTL 窗口内去重)。开关 `PAPER_PREMATCH_FETCH`(默认开),关掉即回到「只复用快照」。

### 结算口径(重要)
- **博彩通用 90 分钟**,无论小组赛/淘汰赛:**加时进球不计、点球大战不计**。
- 实现:无加时取 ESPN 终分;检测到加时进球(分钟 >90)时按进球事件重建 90' 比分(补时 `90'+X` 计入)。

### 工程
- 账本 `wallet.json` / `trade_logs.json` + **进程内互斥锁**防下单/结算并发;**幂等**(同场一注)。
- API:`POST /api/worldcup/trade/run`(先结算后下单,管理口令)、`GET /api/worldcup/trade`(账户+流水)。
- cron:每 **15min** 调 `/trade/run`;首注待比赛进入开赛前 75min 窗口。
- UI:第 6 个底部 tab **💰 模拟盘** + `(wc)/paper/page.tsx`。

### 文件
`lib/trade/{types,config,projection,ev,router,odds,ledger,prematch,settle}.ts`、`poissonCore.buildMatrix`、`api/worldcup/trade/{run,}/route.ts`、`(wc)/paper/page.tsx`、`useTrade`、`trade.*` 双语、`BottomTabBar`、deploy.yml cron;单测 `lib/trade/__tests__/trade.test.ts`(16 项,含 90' 结算)。