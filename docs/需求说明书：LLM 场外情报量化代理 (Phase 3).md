# 需求说明书：LLM 场外情报量化代理 (Phase 3)

## 1. 模块概述 (Module Overview)

本模块旨在构建一个自动化的异步信息监听机制。系统将持续监控指定的信息源（RSS、Twitter、Reddit），抓取与当天比赛相关的最新情报。通过调用大语言模型（如 OpenAI GPT-4o-mini 或 DeepSeek API）对文本进行实体抽取与情感量化，最终输出一个数值化的“情报修正因子 (Sentiment Modifier)”，直接干预最终的赛事预测概率。

## 2. 核心架构：RAG 与量化流水线 (Pipeline)

### 2.1 监听层 (The "Sense" Layer)

不需要全网爬取，只需要精准盯防“高信噪比”的节点：

- **RSS 订阅源:** SkySports, BBC Sport, ESPN 的世界杯专栏。
    
- **社交媒体源:** 参赛国顶级体育记者名单（如罗马诺 Fabrizio Romano、各队官方跟队记者）。
    
- _(技术实现建议：使用 Python 的 `feedparser` 库处理 RSS，使用轻量级爬虫或第三方 API 抓取特定 Twitter 账号的最新 timeline。)_
    

### 2.2 LLM 分析层 (The "Think" Layer - 核心)

将抓取到的原始文本，通过严密的 Prompt Engineering，强迫 LLM 输出结构化的 JSON 数据。

**系统级 Prompt (System Prompt) 示例：**

> "你是一个顶级的量化体育分析师。你的任务是阅读关于足球比赛的实时新闻，并量化该新闻对特定球队胜率的影响。
> 
> 请提取新闻中的关键实体，并给出一个 `sentiment_score`（范围 -1.0 到 +1.0。-1.0 代表极其负面如核心重伤/内讧，+1.0 代表极其正面，0 代表中性或无关）。
> 
> 你必须且只能以 JSON 格式输出，格式如下：
> 
> `{"team_name": "球队标准英文名", "event_type": "injury/morale/weather/tactics", "sentiment_score": 数值, "confidence": 0-1的置信度, "reasoning": "简短的一句话理由"}`"

### 2.3 量化干预层 (The "Act" Layer)

LLM 吐出的 `sentiment_score` 不能直接用，必须经过数学转化，融入我们之前的双擎系统。这里有两种融合路径：

**路径 A：特征工程融合 (优雅但需要重新训练)**

将 `sentiment_score` 作为一个新的特征列，加入到 XGBoost 的特征矩阵 $X$ 中。让 XGBoost 自己去学习“负面新闻到底会降低多少胜率”。

- _优点：_ 纯粹的数据驱动，完全客观。
    
- _缺点：_ 依赖历史带有新闻情感标签的数据来训练，冷启动困难。
    

**路径 B：贝叶斯后验干预 (简单粗暴，立刻可用 - 推荐)**

直接将 LLM 的输出作为“外挂调整器”，暴力修改融合后的最终概率。

- **转换公式:** `Modifier = sentiment_score * Max_Impact_Factor` (例如设定一条新闻最多只能影响 8% 的胜率，即 `Max_Impact_Factor = 0.08`)
    
- 假设双模型融合后，比利时的胜率为 `45%`。
    
- 此时抓取到负面新闻，LLM 给出 `sentiment_score = -0.75`。
    
- `Modifier = -0.75 * 0.08 = -0.06` (降低 6% 胜率)
    
- **最终干预胜率:** `45% - 6% = 39%`。平局和客队胜率相应按比例瓜分这 6%。
    

## 3. API 接口与集成规范 (API & Integration)

后端 (FastAPI) 需要增加一个独立的情报微服务或后台任务（Background Task）。

### 3.1 实体映射器 (Entity Resolution)

这是大模型经常犯错的地方。LLM 可能会输出 `"team_name": "The Three Lions"`，系统必须有一个字典，将其强制映射回数据库的标准 ID (`team_id: 'ENG'`)，否则无法关联到具体比赛。

### 3.2 预测接口扩充 (`GET /api/v1/predictions/{match_id}`)

在之前的 JSON 结构中，增加 `news_sentiment` 节点：

JSON

```
{
  "match_id": "...",
  // ... 之前的 poisson 和 xgboost 数据 ...
  "news_sentiment": {
    "latest_news": "德布劳内因大腿肌肉紧绷缺席今日合练...",
    "llm_parsed": {
       "team": "Belgium",
       "event_type": "injury",
       "sentiment_score": -0.80,
       "confidence": 0.95
    },
    "modifier_applied": -0.064  // 扣减 6.4% 胜率
  },
  "final_adjusted_probabilities": {
    "home": 0.386,  // 45% - 6.4%
    "draw": 0.300,
    "away": 0.314
  }
}
```

## 4. 给开发 Agent 的执行步骤 (Agent Instructions)

1. **依赖安装:** `pip install openai feedparser pydantic`。
    
2. **构建 LLM 客户端:** 在 FastAPI 中创建一个 `intelligence_service.py`。使用 `pydantic` 定义 LLM 的输出 Schema，并调用大模型 API（需开启 `response_format={"type": "json_object"}`）。
    
3. **定时巡检任务:** 使用 `apscheduler` 或 FastAPI 的 `BackgroundTasks`，在距离比赛开赛前 12 小时内，每 15 分钟抓取一次目标球队的相关 RSS 新闻并送入 LLM。
    
4. **概率调整逻辑:** 编写代码，接收 `sentiment_score`，按照“路径 B”的数学逻辑，对最终的赛果概率数组进行加减调整，并确保调整后的胜平负概率总和仍为 1 (100%)。