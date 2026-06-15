# 需求说明书：基于 Elo 积分的轻量化宏观预测引擎 (Phase 2 修正版)

## 1. 模块概述 (Module Overview)

鉴于国家队比赛面临严重的“小样本陷阱 (Small Sample Size Problem)”，本模块旨在用具有坚实统计学基础的“Elo 隐含概率公式”替代高维机器学习模型（如 XGBoost）。

该模块将作为系统的第二引擎（宏观环境引擎），通过评估对阵双方在整个足球工业体系中的绝对实力差（Elo 积分差），直接通过对数函数推导出理论胜平负概率。该基准概率将与微观的泊松分布（Poisson）概率进行线性融合，得出最终的赛事公平赔率。

## 2. 数据依赖与摄取 (Data Dependencies & Ingestion)

### 2.1 数据库结构更新

在现有的 `teams` 表中，必须新增用于存储 Elo 积分的字段：

- `current_elo` (Integer): 球队当前的 Elo 积分（如 1850）。
    
- `elo_updated_at` (Timestamp): 积分最后更新时间。
    

### 2.2 数据源与爬虫任务 (Cron Job)

- **数据源**: 建议从开源 API 或公开数据源（如 `eloratings.net` 的公开接口或 CSV 抓取）获取每日更新的国家队 Elo 积分。
    
- **执行频率**: 每天凌晨（如 UTC 00:00）执行一次批量更新任务，刷新 `teams` 表中的 `current_elo` 字段。
    

## 3. 核心算法逻辑：从积分到概率 (Core Algorithm & Math)

开发 Agent 需在后端的预测服务（如 `prediction_service.py`）中实现以下数学计算逻辑。

### 第一步：计算“预期得分率” (Expected Score, $E$)

假设主队 A 的积分为 $R_A$，客队 B 的积分为 $R_B$。$H$ 为主场优势积分（在世界杯通常为中立场地 $H=0$，若遇到美、加、墨三国主场比赛，可设定 $H=100$）。

- **主队 A 的预期得分率 ($E_A$)**:
    
    $$E_A = \frac{1}{1 + 10^{(R_B - R_A - H) / 400}}$$
    
- **客队 B 的预期得分率 ($E_B$)**:
    
    $$E_B = \frac{1}{1 + 10^{(R_A - R_B + H) / 400}}$$
    
    _(注：$E_A + E_B$ 必然等于 1.0)_
    

### 第二步：动态平局概率估算 (Draw Probability Estimation)

由于足球比赛存在平局，而 $E_A$ 是胜率和平局得分的混合体 ($E_A = P_{win} + 0.5 \times P_{draw}$)，系统需要先估算平局概率。

- **平局概率公式 (经验法则估算法)**:
    
    两队实力越接近（Elo 差值越小），平局概率越高。可以使用以下线性衰减公式计算本场基础平局概率：
    
    $$P_{draw} = 0.29 - \left( 0.0003 \times |R_A - R_B| \right)$$
    
    _限制条件 (Bounds Check):_ 确保算出的 $P_{draw}$ 被限制在 `0.15` 到 `0.33` 之间，防止极端情况导致概率失真。
    

### 第三步：胜平负概率拆解 (1X2 Probability Conversion)

剥离平局后，计算纯粹的胜负概率：

- **主胜概率 ($P_{home\_win}$)** = $E_A - (0.5 \times P_{draw})$
    
- **客胜概率 ($P_{away\_win}$)** = $E_B - (0.5 \times P_{draw})$
    
- _(系统校验)_：必须确保 $P_{home\_win} + P_{draw} + P_{away\_win} == 1.0$
    

## 4. 多模型融合逻辑 (Ensemble / Stacking)

在提供单场预测的 API 接口中，合并第一引擎（泊松分布）和第二引擎（Elo 公式）的结果。

1. **引擎 1 (Poisson)**: 产出 `[P1_home, P1_draw, P1_away]`
    
2. **引擎 2 (Elo)**: 产出 `[P2_home, P2_draw, P2_away]`
    
3. **加权融合 (Weighted Average)**:
    
    设定全局权重参数（支持在配置文件 `config.py` 中修改）。
    
    - `WEIGHT_POISSON = 0.50`
        
    - `WEIGHT_ELO = 0.50`
        
4. **最终融合概率 (Final Probabilities)**:
    
    `P_final_home = (P1_home * 0.50) + (P2_home * 0.50)`
    
5. **推导公平赔率 (Fair Odds)**:
    
    `Fair_Odds_Home = 1 / P_final_home`
    

## 5. API 接口规范扩展 (API Endpoints Updates)

改造现有的预测 API，使其输出双引擎独立结果及融合结果。

**`GET /api/v1/predictions/{match_id}`**

_响应体 (JSON Response) 示例：_

JSON

```
{
  "match_id": "uuid-1234",
  "match_info": {"home": "Belgium", "away": "Egypt", "neutral_ground": true},
  "predictions": {
    "poisson_engine": {
      "probabilities": {"home": 0.45, "draw": 0.25, "away": 0.30},
      "fair_odds": {"home": 2.22, "draw": 4.00, "away": 3.33}
    },
    "elo_engine": {
      "rating_home": 1950,
      "rating_away": 1600,
      "probabilities": {"home": 0.77, "draw": 0.18, "away": 0.05},
      "fair_odds": {"home": 1.30, "draw": 5.55, "away": 20.00}
    },
    "ensemble_final": {
      "weights": {"poisson": 0.5, "elo": 0.5},
      "probabilities": {"home": 0.61, "draw": 0.215, "away": 0.175},
      "fair_odds": {"home": 1.64, "draw": 4.65, "away": 5.71}
    }
  }
}
```