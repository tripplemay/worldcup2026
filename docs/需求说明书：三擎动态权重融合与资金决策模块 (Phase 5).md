# 需求说明书：三擎动态权重融合与资金决策模块 (Phase 5)

## 1. 模块概述 (Module Overview)

本模块是量化预测系统的“中央大脑”（Arbitrator）。其核心任务是接收来自三大底层引擎（泊松分布微观模型、Elo隐含概率宏观模型、LLM情绪代理）的异构信号，通过“上下文感知的动态权重算法（Context-Aware Dynamic Stacking）”计算出最终的比赛真实概率（True Probability）。 随后，该模块将真实概率与市场赔率（Market Odds）进行对碰，计算出期望值（EV），并应用缩水凯利公式（Fractional Kelly）输出严格受风控约束的建议下注仓位。

## 2. 核心数据结构定义 (Type Definitions)

开发 Agent 需在 `types/betting.ts` 中严格定义以下接口，以确保数学运算的类型安全。

TypeScript

```
// 概率三项字典
export interface Probabilities {
  home: number;
  draw: number;
  away: number;
}

// 基础引擎输出
export interface EngineOutputs {
  poissonProbs: Probabilities;
  eloProbs: Probabilities;
  eloHome: number;
  eloAway: number;
}

// LLM 情报信号
export interface LlmIntelligence {
  score: number;       // 范围: -1.0 到 1.0 (正数利好主队，负数利空主队)
  confidence: number;  // 范围: 0.0 到 1.0 (LLM的置信度)
}

// 融合结果输出
export interface FusionResult {
  finalProbs: Probabilities;
  fairOdds: Probabilities;
  appliedWeights: { poisson: number; elo: number };
  modifierApplied: number;
}
```

## 3. 动态权重融合算法 (Dynamic Stacking Algorithm)

开发 Agent 需在 `utils/fusionEngine.ts` 中实现主函数 `fuseProbabilities(engines: EngineOutputs, llm: LlmIntelligence | null)`，包含以下计算生命周期：

### 3.1 全局基础超参数 (Hyperparameters)

- `BASE_WEIGHT_POISSON = 0.45`
    
- `BASE_WEIGHT_ELO = 0.55`
    
- `MAX_LLM_IMPACT = 0.08` (LLM 干预的最大概率阈值为 8%)
    

### 3.2 第一阶段：动态权重调度 (Context-Aware Weighting)

计算两队 Elo 积分的绝对差值 `eloDiff = abs(eloHome - eloAway)`。

- **规则 A (实力悬殊局)**: 若 `eloDiff > 250`
    
    - 宏观实力主导，战术作用减弱。
        
    - 覆盖权重：`Elo = 0.80`, `Poisson = 0.20`
        
- **规则 B (势均力敌局)**: 若 `eloDiff < 50`
    
    - 宏观实力失效，近期战术状态主导。
        
    - 覆盖权重：`Elo = 0.30`, `Poisson = 0.70`
        
- **规则 C (常规局)**: 若不满足上述条件，使用基础超参数权重。
    
- **合并基础概率**: 使用上述得出的权重，对泊松和 Elo 模型的 `home, draw, away` 概率进行线性加权求和，得出 `baseProbs`。
    

### 3.3 第二阶段：LLM 情报干预与比例分配 (Intelligence Modifier & Proportional Distribution)

如果传入了合法的 LLM 信号且 `confidence > 0.5`，执行以下修正逻辑：

1. **计算干预值**: `modifier = score * MAX_LLM_IMPACT * confidence`。
    
2. **施加主队**: `final_home = baseProbs.home + modifier`。
    
3. **比例补偿 (核心数学逻辑)**: 必须将主队增加（或扣除）的概率 `-modifier`，**按照平局和客队原本的概率比例**分摊给它们，以保证概率总量恒定。
    
    - `ratio_draw = baseProbs.draw / (baseProbs.draw + baseProbs.away)`
        
    - `ratio_away = baseProbs.away / (baseProbs.draw + baseProbs.away)`
        
    - `final_draw = baseProbs.draw + (-modifier * ratio_draw)`
        
    - `final_away = baseProbs.away + (-modifier * ratio_away)`
        

### 3.4 第三阶段：防除零边界校验与归一化 (Safety Normalization)

1. **设置下限**: `Math.max(0.001, p)`，确保任何选项的概率都不会小于 `0.1%`，防止后续计算公平赔率（`1/p`）时出现 `Infinity`。
    
2. **重归一化**: 将三个选项的概率分别除以三者之和，确保总和绝对等于 `1.0`。
    
3. **输出**: 返回 `FusionResult` 格式对象，其中包含最终概率及对应的公平赔率（`fairOdds = 1 / p`）。
    

## 4. 财务风控与凯利决策 (Financial & Risk Management)

开发 Agent 需在 `utils/bettingMath.ts` 中实现以下量化金融计算。

### 4.1 期望值计算 (Expected Value)

- **公式**: `EV = (True_Probability * Market_Decimal_Odds) - 1`
    
- **函数签名**: `calculateEV(trueProbability: number, marketDecimalOdds: number): number`
    

### 4.2 缩水凯利仓位限制 (Fractional Kelly & Hard Caps)

在体育博彩中由于模型天然存在残差，系统严禁使用“全凯利（Full Kelly）”，必须施加严格风控缩放。

- **基础公式**: `Kelly_Fraction = EV / (Market_Decimal_Odds - 1)`
    
- **风控规则 1 (无价值阻断)**: 如果 `EV <= 0`，函数必须立刻返回 `0`。
    
- **风控规则 2 (凯利乘数)**: 默认应用 `0.25` 的缩水乘数 (Quarter-Kelly)。即 `Adjusted_Kelly = Kelly_Fraction * 0.25`。
    
- **风控规则 3 (单笔硬顶)**: 无论计算结果多大，系统允许的最大单笔下注比例被强锁定在总资金池的 **5%**。即 `Final_Sizing = Math.min(Adjusted_Kelly, 0.05)`。
    
- **函数签名**: `calculateKellySizing(ev: number, marketOdds: number, multiplier: number = 0.25): number`
    

## 5. 给开发 Agent 的工作流指令 (Prompt for AI Agent)

> **"请作为高级 TypeScript 架构师执行以下任务："**
> 
> 1. 根据需求说明书的第 2 节，创建 `types/betting.ts` 文件并定义好所有 Interface。
>     
> 2. 根据第 3 节，创建 `utils/fusionEngine.ts` 文件。严格实现 `fuseProbabilities` 函数，特别注意代码中**3.3的比例补偿（Proportional Distribution）**以及**3.4的除零保护**必须有清晰的代码注释。
>     
> 3. 根据第 4 节，创建 `utils/bettingMath.ts` 文件，实现 `calculateEV` 和 `calculateKellySizing` 两个纯函数。请确保硬顶风控（最大 5%）被正确写入代码。
>     
> 4. 编写一个 Jest 测试文件 `__tests__/fusionEngine.test.ts`，传入一组测试数据（主客 Elo 悬殊的测试用例、引入负面 LLM 分数的测试用例），断言最终概率总和是否严格为 1。
>