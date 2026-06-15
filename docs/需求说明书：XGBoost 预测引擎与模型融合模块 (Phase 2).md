# 需求说明书：XGBoost 预测引擎与模型融合模块 (Phase 2)

## 1. 模块概述 (Module Overview)

本模块是 2026 世界杯赛前分析系统的“第二引擎”。系统已具备基于泊松分布（Poisson）的微观统计模型，现需引入基于 XGBoost 的机器学习判别式模型。XGBoost 将负责处理宏观环境数据（如 Elo 积分、身价、体能状态等），以捕捉赔率市场中的非线性特征与公众心理偏误。

最终，系统将通过 Stacking（堆叠）策略融合双模型输出，生成最终的“真实概率”与“公平赔率”，并送入 +EV 扫描器。

## 2. 特征工程规范 (Feature Engineering Specification)

在模型训练和实时推理前，必须构建标准化的特征矩阵 ($X$)。数据源需在原有的历史比赛数据库（`historical_matches`）基础上进行特征衍生。

### 2.1 核心特征字典 (Feature Dictionary)

针对多分类目标变量 `y` (0: 主胜, 1: 平局, 2: 客胜)，需构建以下特征向量：

|**特征名 (Feature Name)**|**数据类型**|**计算逻辑与说明 (Description)**|
|---|---|---|
|`elo_diff`|Float|**(核心基石)** 主队赛前 Elo 积分 - 客队赛前 Elo 积分。|
|`market_value_ratio`|Float|主队首发总身价 / (主队身价 + 客队身价)。取值 0~1 之间。|
|`xg_diff_last_5`|Float|主队近 5 场平均 xG 净胜值 - 客队近 5 场平均 xG 净胜值。|
|`rest_days_diff`|Integer|主队距离上场比赛的休息天数 - 客队休息天数。|
|`travel_dist_diff`|Float|(2026特供) 主队赛前跨赛区飞行距离 - 客队飞行距离 (可简化为经纬度直线距离差)。|
|`is_derby`|Boolean|0或1，是否为洲际德比（如均为欧洲球队或均为南美球队）。|
|`is_knockout`|Boolean|0或1，是否为淘汰赛阶段。|

## 3. 模型训练与校准规范 (Model Training & Calibration)

_严禁直接使用默认的分类器输出，必须进行概率校准，否则将产生大量虚假的套利信号。_

### 3.1 基础模型配置 (Base Model Hyperparameters)

- **算法**: `xgboost.XGBClassifier`
    
- **目标函数 (Objective)**: 强制使用 `multi:softprob`（输出三个类别的绝对概率，而非单一结果）。
    
- **评估指标 (Eval Metric)**: `mlogloss` (多分类对数损失)。
    
- **防过拟合策略**: 树深度 `max_depth` 限制为 3-5 之间；学习率 `learning_rate` 建议 0.05 以下。
    

### 3.2 概率校准流水线 (Probability Calibration Pipeline)

必须使用 `scikit-learn` 的 `CalibratedClassifierCV` 包裹 XGBoost 基础模型。

- **校准方法**: 优先使用 `method='isotonic'` (保序回归)。
    
- **验证策略**: `cv=5` (5 折交叉验证)。
    

### 3.3 模型持久化 (Model Persistence)

训练和校准完成后的完整 Pipeline，使用 `joblib` 序列化并保存为 `models/worldcup_xgb_calibrated_v1.joblib`，供 FastAPI 在生产环境加载。

## 4. 后端集成与推理服务 (Backend Integration & Inference)

FastAPI 后端需实现模型加载与在线推理逻辑。

### 4.1 内存加载策略 (Lifespan / Startup)

- 在 FastAPI 启动时（通过 `lifespan` event），将泊松模型参数和 XGBoost `.joblib` 模型一次性加载到内存中，避免每次 API 请求产生磁盘 I/O 延迟。
    

### 4.2 模型融合逻辑 (Model Ensembling / Stacking)

在进行单场比赛预测时，系统必须执行以下加权平均逻辑：

1. **泊松预测 (P_poisson)**: `[P_home_p, P_draw_p, P_away_p]`
    
2. **XGBoost 预测 (P_xgb)**: `[P_home_x, P_draw_x, P_away_x]`
    
3. **融合权重 (Weights)**: 设置系统全局常量（如 `W_POISSON = 0.45`, `W_XGB = 0.55`），支持在配置文件中热更新。
    
4. **最终概率 (P_final)**:
    
    `P_final_home = (P_home_p * W_POISSON) + (P_home_x * W_XGB)`
    
    _(平局和客胜同理)_
    
5. **公平赔率 (Fair Odds)**: `1 / P_final`
    

## 5. API 接口扩展 (API Endpoints Updates)

需要对第一阶段规划的预测接口进行字段扩充，以支持前端展示双模型分歧。

**`GET /api/v1/predictions/{match_id}`**

_响应体 (JSON Response) 必须包含以下结构：_

JSON

```
{
  "match_id": "match_uuid",
  "home_team": "Belgium",
  "away_team": "Egypt",
  "predictions": {
    "poisson": {
      "probabilities": {"home": 0.45, "draw": 0.25, "away": 0.30},
      "fair_odds": {"home": 2.22, "draw": 4.00, "away": 3.33}
    },
    "xgboost": {
      "probabilities": {"home": 0.52, "draw": 0.28, "away": 0.20},
      "fair_odds": {"home": 1.92, "draw": 3.57, "away": 5.00}
    },
    "ensemble_final": {
      "weights_applied": {"poisson": 0.4, "xgboost": 0.6},
      "probabilities": {"home": 0.492, "draw": 0.268, "away": 0.240},
      "fair_odds": {"home": 2.03, "draw": 3.73, "away": 4.16}
    }
  }
}
```

## 6. 开发与测试优先级 (Execution Steps for Agent)

1. **脚本开发**: 编写 `train_xgb_pipeline.py`。输入包含特征 `elo_diff` 等的 CSV/Dataframe，完成 XGBoost 训练、Isotonic 校准，并导出模型文件。
    
2. **后端改造**: 修改 FastAPI 主应用，引入 `joblib` 加载模型，实现上述的 Stacking 融合算法。
    
3. **接口联调**: 改造 `/api/v1/predictions/{match_id}` 接口输出格式，确保前端能够获取融合后的 `ensemble_final` 数据以计算 EV 警报。
    

**建议工作流指令：** 你可以直接对你的代码 Agent 说：_“请阅读这份 Spec 文档的第 2、3 节，使用 pandas, xgboost 和 scikit-learn，帮我编写一段名为 `train_xgb_pipeline.py` 的 Python 脚本，要求严格包含特征提取、 multi:softprob 设置和 CalibratedClassifierCV 概率校准步骤。”_