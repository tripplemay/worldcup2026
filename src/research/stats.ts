/**
 * Phase 10 · P3b:多重检验校正统计(纯函数)。
 *
 * 搜 N 个配置后,"最好那个"要过的门槛:
 *   · DSR(Deflated Sharpe Ratio):校"挑最大值"偏差 + 收益偏度/峰度(下注收益强正偏厚尾)。
 *   · PBO(Probability of Backtest Overfitting)· CSCV:判"我们这套挑选流程"是否系统性过拟合。
 * (SPA/Reality Check 见 stats bootstrap,后续补。)
 * 参考:Bailey & López de Prado。全部确定性(无 Date/随机),可单测。
 */

// ── 基础数值 ────────────────────────────────────────────
const EULER = 0.5772156649015329; // Euler–Mascheroni γ

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
/** 中心矩 E[(x-μ)^k]。 */
function centralMoment(xs: number[], k: number, mu: number): number {
  return xs.length
    ? xs.reduce((s, x) => s + Math.pow(x - mu, k), 0) / xs.length
    : 0;
}

/** erf(z) 近似(A&S 7.1.26,精度 ~1e-7)。 */
function erf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return z >= 0 ? y : -y;
}

/** 标准正态 CDF Φ(x) = 0.5(1 + erf(x/√2))。 */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** 标准正态分位数 Φ⁻¹(p)(Acklam 算法,精度 ~1e-9)。 */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** 每观测夏普(mean/sd,总体 sd)。sd=0 返回 0。 */
export function sharpeRatio(returns: number[]): number {
  const mu = mean(returns);
  const sd = Math.sqrt(centralMoment(returns, 2, mu));
  return sd > 0 ? mu / sd : 0;
}

export interface DsrResult {
  sr: number; // 观测夏普
  sr0: number; // 零技能下 N 次试验的期望最大夏普(去膨胀基准)
  dsr: number; // P(真夏普>0 | 去膨胀 + 偏度/峰度修正)∈[0,1]
}

/**
 * Deflated Sharpe Ratio。
 * @param winnerReturns 冠军策略的每注收益序列
 * @param nTrials       累计试验数 N(含丢弃的;来自注册表)
 * @param sharpeVar     N 个候选夏普的横截面方差 Var({SR_n})
 */
export function deflatedSharpe(
  winnerReturns: number[],
  nTrials: number,
  sharpeVar: number,
): DsrResult {
  const T = winnerReturns.length;
  const mu = mean(winnerReturns);
  const m2 = centralMoment(winnerReturns, 2, mu);
  const sd = Math.sqrt(m2);
  const sr = sd > 0 ? mu / sd : 0;
  const g3 =
    m2 > 0 ? centralMoment(winnerReturns, 3, mu) / Math.pow(m2, 1.5) : 0;
  const g4 = m2 > 0 ? centralMoment(winnerReturns, 4, mu) / (m2 * m2) : 3;

  // 零技能期望最大夏普(N 次试验的最大值基准)
  let sr0 = 0;
  if (nTrials > 1 && sharpeVar > 0) {
    sr0 =
      Math.sqrt(sharpeVar) *
      ((1 - EULER) * normalInv(1 - 1 / nTrials) +
        EULER * normalInv(1 - 1 / (nTrials * Math.E)));
  }
  // 去膨胀概率(带偏度/峰度修正的分母)
  const denomVar = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr;
  const denom = Math.sqrt(Math.max(1e-12, denomVar));
  const dsr = T > 1 ? normalCdf(((sr - sr0) * Math.sqrt(T - 1)) / denom) : 0.5;
  return { sr: +sr.toFixed(4), sr0: +sr0.toFixed(4), dsr: +dsr.toFixed(4) };
}

// ── 组合生成 ────────────────────────────────────────────
/** 从 arr 中取 k 个的全部组合(索引/值数组)。 */
export function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= arr.length - k; i++) {
    for (const rest of combinations(arr.slice(i + 1), k - 1))
      yield [arr[i], ...rest];
  }
}

/**
 * PBO(回测过拟合概率)· 组合对称交叉验证 CSCV。
 * @param M   性能矩阵 M[t][k]:t 个时间块 × N 个配置,元素 = 该配置在该块的表现(**越大越好**)。
 * @param S   把 T 行切成的子块数(偶;默认 16;T<S 时下调为不超过 T 的最大偶数)。
 * @returns   PBO = "IS 冠军 OOS 落到中位数以下(logit λ≤0)" 的组合占比;<0.10 佳。
 */
export function pbo(M: number[][], S = 16): number {
  const T = M.length;
  if (T < 2) return 0;
  const N = M[0].length;
  let s = Math.min(S, T);
  if (s % 2 === 1) s -= 1; // 需偶数
  if (s < 2) return 0;
  // 把 T 行分成 s 个连续组,预聚合成组均值 groupMean[g][k]
  const groupMean: number[][] = [];
  for (let g = 0; g < s; g++) {
    const lo = Math.floor((g * T) / s);
    const hi = Math.floor(((g + 1) * T) / s);
    const gm = new Array(N).fill(0);
    for (let t = lo; t < hi; t++) for (let k = 0; k < N; k++) gm[k] += M[t][k];
    const cnt = hi - lo || 1;
    for (let k = 0; k < N; k++) gm[k] /= cnt;
    groupMean.push(gm);
  }
  const groups = Array.from({ length: s }, (_, i) => i);
  let leq0 = 0;
  let total = 0;
  for (const isGroups of combinations(groups, s / 2)) {
    const isSet = new Set(isGroups);
    const isPerf = new Array(N).fill(0);
    const oosPerf = new Array(N).fill(0);
    let isCnt = 0;
    let oosCnt = 0;
    for (let g = 0; g < s; g++) {
      const target = isSet.has(g) ? isPerf : oosPerf;
      if (isSet.has(g)) isCnt++;
      else oosCnt++;
      for (let k = 0; k < N; k++) target[k] += groupMean[g][k];
    }
    for (let k = 0; k < N; k++) {
      isPerf[k] /= isCnt;
      oosPerf[k] /= oosCnt;
    }
    // IS 冠军
    let nStar = 0;
    for (let k = 1; k < N; k++) if (isPerf[k] > isPerf[nStar]) nStar = k;
    // 其 OOS 相对秩(1=最差…N=最好)
    let rank = 0;
    for (let k = 0; k < N; k++) if (oosPerf[k] <= oosPerf[nStar]) rank++;
    const omega = rank / (N + 1);
    const lambda = Math.log(omega / (1 - omega));
    if (lambda <= 0) leq0++;
    total++;
  }
  return total ? +(leq0 / total).toFixed(4) : 0;
}

// ── 平稳自助 + SPA / Reality Check ──────────────────────
/** 种子 PRNG(mulberry32),供自助可复现(研究代码,非 Workflow 脚本)。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 平稳自助(Politis–Romano):以概率 1/L 起新块、否则续接,重采样 T 个索引(保块内自相关)。 */
export function stationaryBootstrapIndices(
  T: number,
  meanBlockLen: number,
  rng: () => number,
): number[] {
  const p = 1 / Math.max(1, meanBlockLen);
  const idx: number[] = [];
  let cur = Math.floor(rng() * T);
  for (let i = 0; i < T; i++) {
    if (i === 0 || rng() < p) cur = Math.floor(rng() * T);
    else cur = (cur + 1) % T;
    idx.push(cur);
  }
  return idx;
}

/**
 * 有效独立试验数 N_eff(相关配置聚类,协议 §2.4):行=配置的按块收益向量,
 * N_eff = N² / Σ|corr_ij|²(相关矩阵 Frobenius 范数比;克隆配置不重复计)。仅诊断/报告,DSR 分母仍用原始 N。
 */
export function nEff(perBlockRows: number[][]): number {
  const N = perBlockRows.length;
  if (N < 2) return N;
  const corr = (a: number[], b: number[]): number => {
    const n = Math.min(a.length, b.length);
    if (!n) return 0;
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < n; i++) {
      sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; sab += (a[i] - ma) * (b[i] - mb);
    }
    return sa > 0 && sb > 0 ? sab / Math.sqrt(sa * sb) : a === b ? 1 : 0;
  };
  let frob = 0;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const c = i === j ? 1 : corr(perBlockRows[i], perBlockRows[j]);
      frob += c * c;
    }
  return +(N * N / Math.max(1, frob)).toFixed(2);
}

export interface SpaResult {
  stat: number; // 检验统计量 V = max_k √T·f̄_k(可 studentize)
  p: number; // 平稳自助 p 值;<0.05 = 最佳策略确优于基准
}

/**
 * White's Reality Check / Hansen SPA(studentized 版,SPA_u:居中 + 除自助标准差)。
 * @param F   超额表现 F[k][t] = (基准loss − 策略k loss)_t(**越大越好**);N 策略 × T 观测。
 * @param opts B 自助次数、meanBlockLen 平均块长(默认 √T)、seed、studentize(默认 true)。
 * 原假设 H₀:所有候选中最好的对基准无更优预测力。SPA_c(剔除太差策略)为后续精化。
 */
export function spaTest(
  F: number[][],
  opts?: {
    B?: number;
    meanBlockLen?: number;
    seed?: number;
    studentize?: boolean;
    variant?: 'u' | 'c'; // 'c'=Hansen SPA_c:太差策略(studentized 均值 < -2)不进零分布最大值,防垃圾稀释
  },
): SpaResult {
  const N = F.length;
  const T = N ? F[0].length : 0;
  if (!N || !T) return { stat: 0, p: 1 };
  const B = opts?.B ?? 1000;
  const L = opts?.meanBlockLen ?? Math.max(2, Math.round(Math.sqrt(T)));
  const studentize = opts?.studentize ?? true;
  const rng = mulberry32(opts?.seed ?? 12345);
  const fbar = F.map((fk) => mean(fk));

  // 自助:每次重采样 → 各策略居中 Zstar = √T·(f̄* − f̄)
  const zStar: number[][] = Array.from({ length: N }, () => []);
  for (let b = 0; b < B; b++) {
    const idx = stationaryBootstrapIndices(T, L, rng);
    for (let k = 0; k < N; k++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += F[k][idx[t]];
      zStar[k].push(Math.sqrt(T) * (s / T - fbar[k]));
    }
  }
  const omega = zStar.map((z) => {
    const m = mean(z);
    return Math.sqrt(Math.max(1e-12, mean(z.map((x) => (x - m) * (x - m)))));
  });
  const denom = (k: number) => (studentize ? omega[k] : 1);
  const V = Math.max(...fbar.map((fb, k) => (Math.sqrt(T) * fb) / denom(k)));
  // SPA_c:剔除明显劣于基准的策略(studentized 均值 < -2)不进零分布
  const inNull = fbar.map((fb, k) =>
    opts?.variant === 'c' ? (Math.sqrt(T) * fb) / denom(k) >= -2 : true,
  );
  let ge = 0;
  for (let b = 0; b < B; b++) {
    let vstar = -Infinity;
    for (let k = 0; k < N; k++) {
      if (!inNull[k]) continue;
      const z = zStar[k][b] / denom(k);
      if (z > vstar) vstar = z;
    }
    if (vstar >= V) ge++;
  }
  return { stat: +V.toFixed(4), p: +(ge / B).toFixed(4) };
}
