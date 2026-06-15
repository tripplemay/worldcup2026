# 需求说明书：图神经网络 (GNN) 拓扑特征表征引擎 (Phase 4)

## 1. 模块概述 (Module Overview)

本模块旨在构建一个基于图神经网络（GNN）的**离线表征学习（Representation Learning）数据管道**。

鉴于传统统计模型难以跨洲际评估国家队的相对实力，本模块将抽取过去 4 年内全球所有国际 A 级赛事，构建全球足球交锋关系图（Graph）。使用 GNN 算法捕捉网络中的“消息传递”与拓扑结构，最终为每支国家队输出一个固定维度的**高维特征向量（Node Embeddings）**。

该向量将作为底层“地基数据”存入数据库，供下游的逻辑回归（Logistic Regression）或 XGBoost 预测引擎进行特征拼接与在线推理。

## 2. 图结构建模与数据定义 (Graph Construction)

在图网络中，我们需要定义节点（Nodes）和边（Edges）。

### 2.1 节点定义 (Nodes = 国家队)

- **节点集合**: 全球 200+ 支国际足联注册国家队。
    
- **节点初始特征 (Node Features, $X$)**:
    
    - `current_elo` (标准化后的 Elo 积分)
        
    - `total_market_value` (全队总身价，对数标准化)
        
    - `avg_xg_for` / `avg_xg_against` (近期场均创造/丢失 xG)
        

### 2.2 边定义 (Edges = 历史比赛)

- **连线规则**: 如果两支球队在过去 4 年内有过交手，则在它们之间建立一条双向边（Directed/Undirected Edge）。
    
- **边权重/特征 (Edge Weights/Features, $E$)**:
    
    - `goal_diff` / `xg_diff` (净胜球差或 xG 差值，决定了信息流动的方向和强度)
        
    - `match_weight` (赛事权重：世界杯正赛权重最高，友谊赛权重极低)
        
    - `recency_decay` (时间衰减因子：越近的比赛权重越大)
        

## 3. 核心算法与模型设计 (Core Algorithm - PyTorch Geometric)

开发 Agent 需使用 `torch` 和 `torch_geometric` (PyG) 库实现以下逻辑：

### 3.1 算法选型

建议优先使用 **GraphSAGE (Graph Sample and Aggregate)** 或 **GCN (Graph Convolutional Network)**。GraphSAGE 支持小批量的邻居采样，对动态变化的图网络具有极好的泛化能力。

### 3.2 网络架构定义

- **输入层**: 接收 Node Features ($N \times F_{in}$) 和 Edge Indices ($2 \times E$)。
    
- **消息传递层 (Message Passing Layers)**:
    
    - Layer 1: SAGEConv，将特征维度映射到 64 维，配合 ReLU 激活函数。
        
    - Layer 2: SAGEConv，进一步提纯并降维至 **32 维 (Embedding Dimension)**。
        
- **训练目标 (Loss Function)**:
    
    - 采用**自监督学习 (Self-Supervised Learning)** 中的链路预测（Link Prediction）或边回归（Edge Regression）。模型的目标是最小化预测的交锋结果（预测的边权重）与实际交锋结果之间的均方误差 (MSE)。
        
    - _注意：我们不需要它输出胜平负概率，只要训练 Loss 收敛，中间层产生的 32 维向量即为完美的球队表征。_
        

## 4. 数据持久化与批处理策略 (Persistence & Batch Job)

GNN 训练计算量较大，无需实时运行，应作为离线批处理任务（Offline Batch Job）。

### 4.1 数据库字段改造 (PostgreSQL)

在 `teams` 表中新增一个用于存储向量的字段：

- `gnn_embedding` (`FLOAT[]` 或使用 `pgvector` 扩展的 `VECTOR(32)`): 存储 GNN 输出的 32 维数组。
    
- `embedding_updated_at` (Timestamp): 向量最后更新时间。
    

### 4.2 离线调度 (Cron Job)

- **执行频率**: 每周运行一次，或在国际比赛日（FIFA Window）结束后触发运行。
    
- **流程**:
    
    1. 抓取最新的历史战绩构建 Graph。
        
    2. 运行 PyG 模型训练 100-200 个 Epochs。
        
    3. 提取所有节点的 Embedding 矩阵。
        
    4. 将 32 维向量 Upsert（更新写入）到 PostgreSQL 的 `teams.gnn_embedding` 字段中。
        

## 5. 在线推理与数据融合层 (Online Inference Integration)

当下游模型（如逻辑回归引擎）处理具体的单场比赛（如“比利时 vs 埃及”）时，必须执行以下数据融合步骤：

1. **提取地基特征**:
    
    - 从 DB 获取比利时 Embedding: `Vec_H = [0.12, -0.4, ..., 0.88]` (长度 32)
        
    - 从 DB 获取埃及 Embedding: `Vec_A = [0.05, 0.2, ..., -0.15]` (长度 32)
        
2. **向量计算 (Vector Operation)**:
    
    - 计算向量差值: `Vec_Diff = Vec_H - Vec_A` (长度依然为 32)
        
3. **特征拼接 (Feature Concatenation)**:
    
    - 将 `Vec_Diff` 与之前定义好的其他动态宏观特征（如：`rest_days_diff`, `llm_sentiment_score`）直接拼接（Concatenate）。
        
    - 形成一个最终的 $1 \times 34$ 维（假设加入 2 个外部特征）特征数组 $X_{final}$。
        
4. **分类器预测 (Classifier Forward Pass)**:
    
    - 将 $X_{final}$ 送入在包含 GNN 特征数据上训练好的 Logistic Regression 或 XGBoost 模型，直接输出经过拓扑校准的胜平负概率。
        

## 6. 给开发 Agent 的执行步骤 (Execution Steps for Agent)

1. **环境准备**: `pip install torch torch-geometric pandas psycopg2-binary`。如果数据库使用 `pgvector`，请指导执行相关的 SQL 扩展安装 `CREATE EXTENSION vector;`。
    
2. **图构建脚本 (`graph_builder.py`)**: 编写脚本，从 `historical_matches` 表中读取比赛记录，将其转换为 PyG 所需的 `Data(x, edge_index, edge_attr)` 格式。
    
3. **模型训练脚本 (`train_gnn.py`)**: 定义一个包含两层 `SAGEConv` 的 PyTorch 模型。编写训练循环（Training Loop），通过边回归任务最小化 Loss，并在训练结束后抽取模型最后一层输出的张量（Tensors）。
    
4. **落盘服务**: 将抽取的张量转化为 Python List，并批量 Update 回 PostgreSQL 的 `teams` 表。
    
5. **推理接口重构**: 在 FastAPI 的预测路由中，增加提取双方 `gnn_embedding` 并执行减法/拼接逻辑的代码，确保下游的逻辑回归分类器能够接收正确的特征维度。