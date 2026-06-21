export const meta = {
  name: 'league-generalization-analysis',
  description:
    '跨联赛校准泛化分析:逐联赛解读扫描结果→对抗验证每条泛化结论→综合出 Phase 2 每联赛配置',
  phases: [{ title: 'Analyze' }, { title: 'Verify' }, { title: 'Synthesize' }],
};

// per-league 摘要内嵌(避免 args 跨 VM 边界限制)。来源:scripts/league-digest.mjs。
const sweeps = {"epl-2025":{"name":"EPL(基线)","n":378,"withOdds":378,"mismatch":95,"perModelBrier":{"poisson-xg":0.625,"poisson-goals":0.636,"elo":0.629,"market":0.609},"ensembleBrier":0.615,"ensembleHit":0.471,"r1_poissonXg":[{"s":0,"favBiasMis":-0.149,"brier":0.625},{"s":100,"favBiasMis":-0.049,"brier":0.623},{"s":150,"favBiasMis":-0.054,"brier":0.622},{"s":200,"favBiasMis":-0.059,"brier":0.621},{"s":300,"favBiasMis":-0.076,"brier":0.62}],"r1_elo_favBiasMis":0.041,"hfa":[{"elo":0,"brier":0.62,"hit":0.481},{"elo":45,"brier":0.615,"hit":0.479},{"elo":65,"brier":0.615,"hit":0.471},{"elo":85,"brier":0.615,"hit":0.479}],"goals":[{"gs":0.6,"meanPred":2.82,"meanActual":2.75,"over25Pred":0.531,"over25Actual":0.55,"over25Hit":0.516},{"gs":0.8,"meanPred":2.89,"meanActual":2.75,"over25Pred":0.546,"over25Actual":0.55,"over25Hit":0.542},{"gs":1,"meanPred":2.97,"meanActual":2.75,"over25Pred":0.56,"over25Actual":0.55,"over25Hit":0.537}],"draw":{"actual":0.275,"pred":0.255,"picked":0.005}},"laliga":{"name":"La Liga","n":376,"withOdds":376,"mismatch":73,"perModelBrier":{"poisson-xg":0.609,"poisson-goals":0.615,"elo":0.585,"market":0.571},"ensembleBrier":0.581,"ensembleHit":0.524,"r1_poissonXg":[{"s":0,"favBiasMis":-0.167,"brier":0.609},{"s":100,"favBiasMis":-0.061,"brier":0.603},{"s":150,"favBiasMis":-0.061,"brier":0.602},{"s":200,"favBiasMis":-0.065,"brier":0.602},{"s":300,"favBiasMis":-0.073,"brier":0.601}],"r1_elo_favBiasMis":0.075,"hfa":[{"elo":0,"brier":0.597,"hit":0.495},{"elo":45,"brier":0.585,"hit":0.505},{"elo":65,"brier":0.581,"hit":0.524},{"elo":85,"brier":0.578,"hit":0.527}],"goals":[{"gs":0.6,"meanPred":2.73,"meanActual":2.7,"over25Pred":0.509,"over25Actual":0.5,"over25Hit":0.551},{"gs":0.8,"meanPred":2.78,"meanActual":2.7,"over25Pred":0.518,"over25Actual":0.5,"over25Hit":0.532},{"gs":1,"meanPred":2.83,"meanActual":2.7,"over25Pred":0.525,"over25Actual":0.5,"over25Hit":0.524}],"draw":{"actual":0.245,"pred":0.258,"picked":0.019}},"bundesliga":{"name":"Bundesliga","n":297,"withOdds":297,"mismatch":71,"perModelBrier":{"poisson-xg":0.598,"poisson-goals":0.607,"elo":0.569,"market":0.557},"ensembleBrier":0.565,"ensembleHit":0.566,"r1_poissonXg":[{"s":0,"favBiasMis":-0.141,"brier":0.598},{"s":100,"favBiasMis":-0.03,"brier":0.586},{"s":150,"favBiasMis":-0.032,"brier":0.585},{"s":200,"favBiasMis":-0.036,"brier":0.585},{"s":300,"favBiasMis":-0.049,"brier":0.587}],"r1_elo_favBiasMis":0.084,"hfa":[{"elo":0,"brier":0.574,"hit":0.552},{"elo":45,"brier":0.567,"hit":0.562},{"elo":65,"brier":0.565,"hit":0.566},{"elo":85,"brier":0.565,"hit":0.576}],"goals":[{"gs":0.6,"meanPred":3.05,"meanActual":3.23,"over25Pred":0.581,"over25Actual":0.633,"over25Hit":0.582},{"gs":0.8,"meanPred":3.04,"meanActual":3.23,"over25Pred":0.577,"over25Actual":0.633,"over25Hit":0.586},{"gs":1,"meanPred":3.04,"meanActual":3.23,"over25Pred":0.572,"over25Actual":0.633,"over25Hit":0.582}],"draw":{"actual":0.246,"pred":0.238,"picked":0}},"seriea":{"name":"Serie A","n":370,"withOdds":370,"mismatch":112,"perModelBrier":{"poisson-xg":0.627,"poisson-goals":0.632,"elo":0.615,"market":0.581},"ensembleBrier":0.598,"ensembleHit":0.522,"r1_poissonXg":[{"s":0,"favBiasMis":-0.168,"brier":0.627},{"s":100,"favBiasMis":-0.067,"brier":0.63},{"s":150,"favBiasMis":-0.068,"brier":0.628},{"s":200,"favBiasMis":-0.071,"brier":0.627},{"s":300,"favBiasMis":-0.085,"brier":0.624}],"r1_elo_favBiasMis":0.072,"hfa":[{"elo":0,"brier":0.593,"hit":0.527},{"elo":45,"brier":0.595,"hit":0.522},{"elo":65,"brier":0.598,"hit":0.522},{"elo":85,"brier":0.601,"hit":0.516}],"goals":[{"gs":0.6,"meanPred":2.49,"meanActual":2.44,"over25Pred":0.452,"over25Actual":0.465,"over25Hit":0.522},{"gs":0.8,"meanPred":2.49,"meanActual":2.44,"over25Pred":0.45,"over25Actual":0.465,"over25Hit":0.508},{"gs":1,"meanPred":2.49,"meanActual":2.44,"over25Pred":0.448,"over25Actual":0.465,"over25Hit":0.505}],"draw":{"actual":0.257,"pred":0.258,"picked":0.011}},"ligue1":{"name":"Ligue 1","n":297,"withOdds":296,"mismatch":74,"perModelBrier":{"poisson-xg":0.623,"poisson-goals":0.638,"elo":0.607,"market":0.583},"ensembleBrier":0.596,"ensembleHit":0.492,"r1_poissonXg":[{"s":0,"favBiasMis":-0.178,"brier":0.623},{"s":100,"favBiasMis":-0.079,"brier":0.621},{"s":150,"favBiasMis":-0.08,"brier":0.62},{"s":200,"favBiasMis":-0.084,"brier":0.619},{"s":300,"favBiasMis":-0.098,"brier":0.618}],"r1_elo_favBiasMis":0.054,"hfa":[{"elo":0,"brier":0.604,"hit":0.502},{"elo":45,"brier":0.597,"hit":0.488},{"elo":65,"brier":0.596,"hit":0.492},{"elo":85,"brier":0.596,"hit":0.498}],"goals":[{"gs":0.6,"meanPred":2.86,"meanActual":2.87,"over25Pred":0.539,"over25Actual":0.539,"over25Hit":0.562},{"gs":0.8,"meanPred":2.86,"meanActual":2.87,"over25Pred":0.536,"over25Actual":0.539,"over25Hit":0.562},{"gs":1,"meanPred":2.85,"meanActual":2.87,"over25Pred":0.532,"over25Actual":0.539,"over25Hit":0.572}],"draw":{"actual":0.246,"pred":0.25,"picked":0.013}}};

function digest(key) {
  return sweeps[key] ? { key, ...sweeps[key] } : null;
}

const EPL_BASELINE = `EPL(英超)已建立的基线结论(供对照):
- R1:poisson favBiasMismatch ~−0.149(shrink0)→ −0.049(shrink100),~100 最优;Elo 不欠自信(+0.041)。R1 是泊松专有结构缺陷。
- 市场最强:market 单模型 Brier 0.609 < 各模型 0.625-0.636 → 联赛应提高 market 权重。
- 主场优势:~65 Elo / ×1.12 进球乘子(WC 中立)。
- 大球:meanPred 2.82 vs actual 2.75,无过度预测 → 联赛可放开 G2(押大)。`;

const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['league', 'r1', 'market', 'hfa', 'goals', 'recommendedConfig', 'overallConfidence'],
  properties: {
    league: { type: 'string' },
    r1: {
      type: 'object', additionalProperties: false,
      required: ['generalizes', 'shrink0', 'shrinkBest', 'bestScale', 'brierCost', 'verdict'],
      properties: {
        generalizes: { type: 'boolean' },
        shrink0: { type: ['number', 'null'] },
        shrinkBest: { type: ['number', 'null'] },
        bestScale: { type: ['number', 'null'] },
        brierCost: { type: 'string' },
        verdict: { type: 'string' },
      },
    },
    market: {
      type: 'object', additionalProperties: false,
      required: ['strongest', 'marketBrier', 'bestNonMarketBrier', 'verdict'],
      properties: {
        strongest: { type: 'boolean' },
        marketBrier: { type: ['number', 'null'] },
        bestNonMarketBrier: { type: ['number', 'null'] },
        verdict: { type: 'string' },
      },
    },
    hfa: {
      type: 'object', additionalProperties: false,
      required: ['bestElo', 'helpsOrHurts', 'verdict'],
      properties: {
        bestElo: { type: ['number', 'null'] },
        helpsOrHurts: { type: 'string', enum: ['helps', 'hurts', 'neutral'] },
        verdict: { type: 'string' },
      },
    },
    goals: {
      type: 'object', additionalProperties: false,
      required: ['overPredicts', 'recommendG2Open', 'verdict'],
      properties: {
        overPredicts: { type: 'boolean' },
        recommendG2Open: { type: 'boolean' },
        verdict: { type: 'string' },
      },
    },
    recommendedConfig: {
      type: 'object', additionalProperties: false,
      required: ['shrinkEloScale', 'marketWeight', 'hfaElo', 'hfaMult', 'g2Open'],
      properties: {
        shrinkEloScale: { type: 'number' },
        marketWeight: { type: 'string' },
        hfaElo: { type: 'number' },
        hfaMult: { type: 'number' },
        g2Open: { type: 'boolean' },
      },
    },
    overallConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    caveats: { type: 'string' },
  },
};

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['claims', 'overallHolds'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['claim', 'holds', 'reason'],
        properties: {
          claim: { type: 'string' },
          holds: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
    overallHolds: { type: 'boolean' },
    correctionsNeeded: { type: 'string' },
  },
};

phase('Analyze');
const keys = Object.keys(sweeps).filter((k) => k !== 'epl-2025');
log(`分析 ${keys.length} 个联赛(对照 EPL 基线)`);

const results = await pipeline(
  keys,
  (key) => {
    const d = digest(key);
    return agent(
      `你是足球预测模型校准分析师。下面是 ${d.name} 联赛 2025-26 赛季 walk-forward 回测扫描结果` +
        `(2023-24/2024-25 作 Elo/xG 热启动)。判断 EPL 已建立的「联赛配置」是否在本联赛同样成立,逐维度给结论 + 支撑数字。\n\n` +
        `${EPL_BASELINE}\n\n本联赛扫描数据(JSON):\n${JSON.stringify(d, null, 2)}\n\n` +
        `要点:\n` +
        `- R1:看 r1_poissonXg 的 favBiasMis 在 s=0 是否显著为负(欠自信),随 shrinkEloScale 是否趋 0;` +
        `r1_elo_favBiasMis 是否为正(佐证泊松专有)。注意 mismatch 子集样本量,太小降置信。给最优 shrinkEloScale。\n` +
        `- 市场:market 的 Brier 是否低于所有非市场模型(看 perModelBrier)。\n` +
        `- HFA:hfa 数组里哪个 elo 的 Brier 最低;HFA 是 helps/hurts/neutral。\n` +
        `- 大球:goals 里 meanPred 是否系统性高于 meanActual(过度预测);是否建议放开 G2。\n` +
        `给本联赛 Phase 2 推荐配置(shrinkEloScale/market 权重相对当前 0.2 的建议/hfaElo/hfaMult/g2Open)。只输出结构化结果。`,
      { label: `analyze:${key}`, phase: 'Analyze', schema: ANALYSIS_SCHEMA },
    );
  },
  (analysis, key) => {
    const d = digest(key);
    return agent(
      `你是怀疑论的校准审计员。下面是对 ${d.name} 的泛化结论 + 原始扫描数据。` +
        `逐条尝试「证伪」每个泛化判断(R1 是否真显著、样本是否够、市场是否真的最强、HFA 最优是否稳健、大球结论是否成立)。` +
        `对样本小(mismatch<30)或差异在噪声内(Brier 差 <0.005)的结论默认持保留。\n\n` +
        `结论:\n${JSON.stringify(analysis, null, 2)}\n\n原始数据:\n${JSON.stringify(d, null, 2)}\n\n只输出结构化验证。`,
      { label: `verify:${key}`, phase: 'Verify', schema: VERIFY_SCHEMA },
    ).then((verify) => ({ key, digest: d, analysis, verify }));
  },
);

phase('Synthesize');
const synthesis = await agent(
  `你是首席量化。基于以下各联赛的「原始扫描摘要 + 解读 + 对抗验证」,产出跨联赛泛化总判定与 Phase 2 每联赛配置表。\n\n` +
    `${EPL_BASELINE}\n\n各联赛(digest+analysis+verify):\n${JSON.stringify(results, null, 2)}\n\n` +
    `产出(Markdown 中文):\n` +
    `1. 泛化总判定:R1 修复 / 市场最强 / HFA / 放开大球——分别在几个联赛成立?哪些需要联赛专属覆盖(尤其意甲 HFA)?\n` +
    `2. 每联赛 Phase 2 推荐配置表(shrinkEloScale / market 权重 / hfaElo / hfaMult / G2)。\n` +
    `3. 反直觉/需注意点 + 置信度(注明哪些受单季样本限制)。\n` +
    `务必引用具体数字。`,
  { label: 'synthesize', phase: 'Synthesize' },
);

return { perLeague: results, synthesis };
