/**
 * 模拟交易策略参数(可经 env 覆盖,集中便于调参)。
 */
const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean) =>
  v == null ? d : v === '1' || v.toLowerCase() === 'true';

export const INITIAL_BALANCE = num(process.env.PAPER_INITIAL_BALANCE, 10000);
export const MIN_EV = num(process.env.PAPER_MIN_EV, 0.03); // 正 EV 门槛
// EV 上限:高效市场真实边际极少 >15–20%,>30% 几乎必是模型错(R1 弱方幻觉等),非市场错 → 弃用,落 coverage
export const MAX_EV = num(process.env.PAPER_MAX_EV, 0.3);
export const MIN_PROB = num(process.env.PAPER_MIN_PROB, 0.3); // 方差过滤:剔除低胜率高赔率
export const KELLY_FRACTION = num(process.env.PAPER_KELLY_FRACTION, 0.25); // 四分之一凯利
export const MAX_STAKE_PCT = num(process.env.PAPER_MAX_STAKE_PCT, 0.05); // 单注上限(占当前余额),防早期梭哈
export const MIN_STAKE = num(process.env.PAPER_MIN_STAKE, 10); // 低于此不下注
// 每场覆盖注:无 +EV value 注时,对融合热门方下固定小注(占余额),保证每场有注、独立统计
export const COVERAGE_STAKE_PCT = num(
  process.env.PAPER_COVERAGE_STAKE_PCT,
  0.005,
);
export const BET_WINDOW_MIN = num(process.env.PAPER_BET_WINDOW_MIN, 75); // 开赛前多少分钟内下注
// 赔率源:apifootball(主,Pro 套餐 7500/天)→ 缺失回退 theoddsapi 缓存快照。
export const ODDS_SOURCE = (process.env.PAPER_ODDS_SOURCE ?? 'apifootball') as
  | 'apifootball'
  | 'theoddsapi';
// 赛前轻量拉取:为进入窗口的比赛拉一次盘口(解锁 O/U/亚盘);耗对应数据源配额。
export const PREMATCH_FETCH = bool(process.env.PAPER_PREMATCH_FETCH, true);
export const ODDS_TTL_MS = num(process.env.PAPER_ODDS_TTL_MS, 1_800_000); // 盘口快照 TTL(窗口内去重,默认 30min)
