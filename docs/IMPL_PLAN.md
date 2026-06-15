# 实现计划:比赛结果预测系统(多模型可插拔)

> 基于 `docs/需求说明书：2026 世界杯赛前赔率聚合与 +EV 预测系统.md`,经讨论后的落地方案。
> **范围调整**:只做「比赛结果预测」,**不做 EV / 套利**(EV 是预测之上的可选下一步,已砍)。

## 关键决策(已与用户确认)
- **技术栈**:在现有 Next.js / TypeScript 栈内扩展,**不另起 Python/FastAPI**。
- **存储**:JSON 文件(`WC_DATA_DIR`,默认本地 `.data/`,生产 `/opt/apps/worldcup-data/`,部署不丢)。数据量小,日后可升 SQLite。
- **多模型架构**:`PredictionModel` 接口 + 注册表;预测按 `(比赛, 模型)` 存,为未来引入 Elo / 市场隐含 / ML 等模型做**交叉预测**与命中率排行铺路。
- **预测页**:独立的第 5 个底部 Tab「🔮 预测」。
- **数据源**:纯 ESPN(免费,不耗 The Odds API 配额)。历史射门来自 `lastFiveGames`(每场 summary 给双方近 5 场 event ID)→ 逐场 boxscore 取 `射正/总射门`。
- **xG 公式**(spec 定义):`xG = 射正×0.30 + 射偏×0.05`,`射偏 = 总射门 − 射正`。
- **默认**:每队近 ~5–10 场(lastFiveGames 给 5,样本不足标「低置信」);中立场地不加主场优势;模型估算附免责提示。

## 数据流
```
ESPN boxscore(射正/射偏/进球) ──每场──▶ historical_matches(JSON)
        │  xG = 射正×0.3 + 射偏×0.05
        ▼
  EWMA(近若干场,指数加权)──▶ team_ratings(场均创造 xG / 场均丢失 xG)
        │
        ▼  泊松分布(λ主/μ客 → 进球矩阵 → 胜平负/比分/大小球/BTTS)
   MatchPrediction(每模型一份)──▶ 预测页 + 详情页预测卡
```

## 阶段
- **Phase 1 数据管道 + 模型框架**(本期)
  - `lib/db/store.ts` JSON 存储层
  - `lib/predict/types.ts` HistMatch / TeamRating
  - `lib/predict/model.ts` MatchPrediction / PredictionModel 接口 / 上下文
  - `lib/predict/registry.ts` 模型注册表
  - `lib/predict/history.ts` ESPN 历史摄取(射门→单场 xG)
  - `lib/predict/ratings.ts` EWMA 评分
  - `app/api/worldcup/engine` 触发摄取+重算(admin 口令保护,对应 spec 的 trigger-xg-calc)
  - dev 实测打印球队 xG 评分验证
- **Phase 2 首个模型 + 预测页**
  - `lib/predict/models/poisson-xg.ts` 实现 + 注册
  - `app/api/worldcup/predictions` 接口
  - 「🔮 预测」Tab(列表)+ 详情页「模型预测」卡(已为多模型交叉对比预留结构)
- **未来**:新模型实现接口并注册 → 交叉对比 + 命中率排行自然解锁;如需 EV,在预测之上加扫描器。

## 持久化文件(WC_DATA_DIR/predict/)
- `historical.json` → `{ [eventId]: HistMatch }`
- `ratings.json` → `{ [normTeam]: TeamRating }`
- `predictions.json` → `{ "<matchId>:<modelId>": MatchPrediction }`(Phase 2)
