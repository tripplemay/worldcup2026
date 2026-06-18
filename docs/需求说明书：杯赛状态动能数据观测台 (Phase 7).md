# 需求说明书：杯赛状态动能数据观测台 (Phase 7)

## 1. 模块概述 (Module Overview)

本模块旨在为量化研究员提供一个直接观测“杯赛短期状态动能 (TMI)”**及其底层裸数据的监控页面。 系统放弃在前端进行复杂的动态权重计算，改为由后端使用一套默认的基准权重（固化在环境变量或配置文件中）统一计算 TMI 分数。前端的核心职责是提供一个具备极高数据密度、支持多维列排序与过滤的**高级数据表格（Data Table），帮助研究员直接评估 API 数据的准确性、各球队的真实状态排名，以及底层因子（xG、体能、Elo变化）对总分的贡献度。

## 2. 后端计算与 API 规范 (Backend & API Spec)

### 2.1 固定基准权重 (Static Base Weights)

在后端的 `utils/tmiEngine.ts` 中，将之前的动态权重固化为系统常量：

- `WEIGHT_ELO = 0.40`
    
- `WEIGHT_XG = 0.60`
    
- `FATIGUE_THRESHOLD = 0.60`
    
- `PENALTY_MULTIPLIER = 2.0`
    

### 2.2 观测台专属 API 接口 (`GET /api/v1/tmi-observability`)

开发一个专用于该数据看板的 API 路由，返回所有参赛球队的 TMI 详情。

- **响应结构 (JSON)**: 必须同时返回“原始特征裸数据”和“归一化后的得分”，以供前端核对。
    

JSON

```
{
  "last_updated": "2026-06-18T10:00:00Z",
  "teams": [
    {
      "team_id": "FRA",
      "team_name": "法国",
      "raw_stats": {
        "matches_played": 3,
        "shadow_elo_diff": 45.5,
        "xg_momentum_per_match": 1.25,
        "core_minutes_played": 2850
      },
      "normalized_scores": {
        "mental_score": 0.455,
        "tactical_score": 0.833,
        "fatigue_penalty": 0.0
      },
      "tmi_total_score": 0.682
    }
    // ... 其他所有球队
  ]
}
```

## 3. 前端观测台 UI/UX 规范 (Data Dashboard Spec)

在 Next.js 工程中创建独立页面 `app/dashboard/tmi-observability/page.tsx`。

### 3.1 核心组件：高密度数据表 (Data Table)

必须使用支持复杂交互的表格组件（强烈建议使用 `@tanstack/react-table` 配合 `shadcn/ui`）。表格需具备以下核心能力：

- **默认排序**：按 `tmi_total_score` 降序排列。
    
- **全列支持排序 (Sorting)**：允许研究员点击表头，按“裸数据 xG 差”、“体能消耗”、“影子 Elo 增量”单独进行升降序排列，用于寻找单项极值。
    
- **行高亮机制**：
    
    - TMI 总分 > 0.5 的球队，行背景或分数使用浅绿色高亮（状态火热）。
        
    - 体能惩罚 (`fatigue_penalty`) < -0.2 的球队，该单元格使用醒目红色底色警告（体能红线报警）。
        

### 3.2 数据列定义 (Table Columns)

表格需呈现极其硬核的金融数据风格（等宽字体对齐），包含以下列：

1. **排名/球队 (Rank & Team)**：带有国旗 Icon。
    
2. **TMI 总分 (TMI Score)**：核心指标，保留两位小数。
    
3. **影子 Elo 增量 ($\Delta$ Elo)**：展示 `shadow_elo_diff` 裸数据。
    
4. **场均 xG 净胜 (xG Diff/M)**：展示 `xg_momentum_per_match` 裸数据。
    
5. **核心总出场 (Minutes)**：展示 `core_minutes_played`，并附带一个小进度条表示疲劳阈值。
    
6. **因子贡献分布 (Factor Breakdown)**：使用小型的 `Sparkline` 或横向进度条，直观展示该队分数的构成（绿色部分为 Elo 和 xG 的正向贡献，红色部分为体能扣分），用于一眼看清高分是怎么来的。
    

## 4. 给开发 Agent 的执行指令 (Agent Instructions)

> **"请作为高级全栈工程师，执行以下数据观测台的开发任务："**
> 
> 1. 在后端新建路由 `/api/v1/tmi-observability`，提取数据库中所有球队的杯赛统计数据，使用固定的常量权重计算 TMI 总分、各项因子得分及裸数据，组装成结构化 JSON 数组返回。
>     
> 2. 在 Next.js 中创建 `app/dashboard/tmi-observability/page.tsx` 页面。
>     
> 3. 更新全局 Sidebar 组件，加入带有 📊 图标的“TMI 数据观测台”导航项。
>     
> 4. 安装并使用 `@tanstack/react-table` 构建核心数据矩阵。确保“TMI总分”、“影子Elo增量”、“xG净胜”、“体能扣分”列均支持点击表头进行升降序切换。
>     
> 5. 为表格数据添加条件渲染样式：当体能扣分绝对值过大时，使用 `text-red-500` 或红底警示；数据列建议统一使用 `font-mono` 以确保数字对齐的专业感。
>

---

## 5. 实现纪要 (Implementation Addendum · v1)

> **状态：已实现 (2026-06-18)。** 本节记录最终落地方案及其相对上文初稿的偏差与理由——上文初稿照通用后台模板书写，与本项目实际形态（移动端消费级 App）不符，落地时做了对齐。

### 5.1 与初稿的关键偏差

| 维度 | 初稿 | 实现 | 理由 |
|---|---|---|---|
| 定位/路由 | `app/dashboard/tmi-observability` + Sidebar | `(wc)/tmi` 移动端**卡片列表** + 预测页顶部入口 | 本项目无 Sidebar（`BottomTabBar` 5 tab），`app/dashboard`/`src/components/sidebar` 为模板死代码 |
| 表格组件 | 安装 `@tanstack/react-table` + shadcn | Tailwind 垂直卡片(每队一卡) | 移动端窄屏不适合多列 Data Grid；卡片更易「一眼看清分怎么来的」 |
| API | `GET /api/v1/tmi-observability` | `GET /api/worldcup/tmi` | 对齐项目现有 `/api/worldcup/*` 约定与 `ok/fail` 信封 |
| 生成机制 | 定时脚本产出静态 `tmi_scores.json` | **按请求实时算 + 5min 进程内缓存** | TMI 是对现有 JSON 的纯算术；复用现有 engine cron 刷新的数据，零新增 cron／静态文件 |
| 体能因子 | 累加单兵 `core_minutes_played` | **休息天数代理**：距上一场 ≤3 天才罚，`-((4−restDays)×0.2)` | 逐场拉阵容分钟对 JSON 管线与 API 配额过重；赛会制高密度赛程下「休息天数」足以反映体能劣势，**零新增 API** |
| 影子 Elo | 开赛前快照 `elo.json` → `baseline_elo.json` | **从 `results.json` 重放重建**：`selfElo(全部) − selfElo(开赛日前)` | 开赛(6/11)已过、快照时机已错失；自算 Elo 同一把尺重放可事后重算、精确隔离杯赛期间净变化（权威 eloratings.net 值无法回溯，故走自算线） |
| xG 动能 | （未明确口径） | **杯赛口径**(`historical` 中 date≥开赛日)；杯赛样本 <2 回退近期全局 EWMA(`ratings.json`)，UI 标注「近期」 | 真正反映「杯赛动能」；开赛初期小样本有兜底 |
| 归一化 | 仅给示例数字、无公式 | **硬编码、有符号 [−1,1]**（见 5.2） | 初稿未定义归一化函数 |
| 与预测关系 | （未强调） | 固定权重仅生成**「状态动能榜」**，**不进入胜率预测(ensemble)**；UI 打「状态观测」标签 | 与 Phase 5 动态权重融合解耦，避免被误用为投注信号 |
| 参赛队范围 | 所有参赛球队 | 仅含**开赛日后已登场**的球队 | 未登场即无动能 |

### 5.2 固定权重与归一化（最终公式）

```
WEIGHT_ELO = 0.40
WEIGHT_XG  = 0.60
开赛日 cutoff：env WC_START，默认 2026-06-11

mentalScore   = clamp(shadowEloDiff / 50,        -1, 1)   // 士气
tacticalScore = clamp(xgMomentumPerMatch / 1.5,  -1, 1)   // 战术
fatiguePenalty= restDays<=3 ? -((4 - restDays) * 0.2) : 0  // 体能(restDays 为 null 不罚)
total         = clamp(0.40*mentalScore + 0.60*tacticalScore + fatiguePenalty, -1, 1)
```

### 5.3 接口响应（实际）

`GET /api/worldcup/tmi` → `{ success, data }`，`data` 为：

```json
{
  "lastUpdated": "2026-06-18T00:00:00.000Z",
  "wcStart": "2026-06-11",
  "teams": [
    {
      "teamId": "france",
      "teamName": "France",
      "raw": { "matchesPlayed": 3, "shadowEloDiff": 45.5, "xgMomentumPerMatch": 1.25, "restDays": 3 },
      "normalized": { "mentalScore": 0.91, "tacticalScore": 0.833, "fatiguePenalty": -0.2 },
      "total": 0.66,
      "xgSource": "cup"
    }
  ]
}
```

### 5.4 UI（实际）

移动端卡片：**排名 + 国旗 + 队名** / 大号有符号 **TMI 总分**(总分 >0.5 绿色火热 + 火焰图标、<0 红色) / 三条**中线贡献条**(士气·战术·体能，正向右负向左) / `font-mono` **裸值行**(影子Elo、场均xG净胜、休息天数、杯赛场次)。顶部「状态观测」标签声明其独立性。

### 5.5 文件清单

- `src/lib/tmi/constants.ts` — 固定权重与标尺（纯常量，前后端共用）
- `src/lib/tmi/types.ts` — `TeamTmi` / `TmiSnapshot`
- `src/lib/tmi/engine.ts` — `computeTmi()`(纯函数) + `loadTmiSnapshot()`
- `src/lib/tmi/__tests__/engine.test.ts` — 11 项单测
- `src/app/api/worldcup/tmi/route.ts` — `GET` 接口
- `src/app/(wc)/tmi/page.tsx` — 卡片榜页面
- `src/lib/hooks/useWorldCup.ts` — `useTmi()`
- `src/app/(wc)/predict/page.tsx` — 预测页入口
- `src/lib/i18n/messages.ts` — `tmi.*` 双语文案
- `src/lib/predict/ratings.ts` — 导出 `computeElo`/`GameLike` 供复用
