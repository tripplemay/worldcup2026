/**
 * CLV 真值靶校准报告(Phase B)。
 * 把闭盘价(开赛前最后一拍,去水 True_IP)当"最佳可得真值",逐场对比各模型的概率:
 *  - mae:三项平均绝对偏差;
 *  - favBias:模型在「闭盘热门方」上的概率 − 闭盘该项概率(<0 = 比闭盘更不自信)。
 * 错配子集(闭盘热门 ≥ 阈值)上的 favBias,直接量化"泊松错配欠自信"(R1)。
 * 干净对比 = 市场无关的 poisson 对闭盘;ensemble 含市场锚 0.2,自比偏循环,仅供参考。
 * 数据为前向积累:仅覆盖 Phase A 上线后开赛、且有预测存档的比赛。
 */
import { loadClosingOdds, loadPredictionLog, loadTrades } from 'lib/db/store';
import { trueIP3 } from 'lib/odds/trueIP';

const MISMATCH = 0.7; // 闭盘隐含热门方 ≥70% 视为强错配

export interface ClvModelStat {
  n: number;
  nMismatch: number;
  mae: number; // 三项平均绝对偏差 vs 闭盘
  favBias: number; // 闭盘热门项上的平均偏差(<0=比闭盘更保守/欠自信)
  favBiasMismatch: number; // 仅错配子集
}
export interface ClvReport {
  n: number;
  mismatchThreshold: number;
  nMismatch: number;
  perModel: Record<string, ClvModelStat>;
  rows: {
    matchId: string;
    teams: string;
    closeFav: number;
    mismatch: boolean;
    favBias: Record<string, number>;
  }[];
}

/** 模拟盘 CLV KPI:每笔注的下注赔率 vs 闭盘赔率(正=打败闭盘,edge 领先指标)。 */
export interface ClvKpi {
  n: number; // 可对比的注数(有闭盘 + 1X2/亚盘主线)
  posRate: number; // 正 CLV 占比
  avgClv: number; // 平均 CLV(下注赔率/闭盘赔率 − 1)
}
export function clvKpi(): ClvKpi {
  const closing = loadClosingOdds();
  let n = 0;
  let pos = 0;
  let sum = 0;
  for (const t of loadTrades()) {
    if ((t.tier ?? 'value') !== 'value') continue; // CLV 只衡量精选策略,不含 coverage
    const c = closing[t.matchId];
    if (!c) continue;
    let closeOdds: number | null | undefined;
    if (t.market === '1X2') {
      closeOdds =
        t.selection === 'home' ? c.h : t.selection === 'away' ? c.a : c.d;
    } else if (t.market === 'AH' && t.line === c.ahLine) {
      closeOdds = t.selection === 'home' ? c.ahH : c.ahA;
    } // OU:闭盘未抓任意线,跳过
    if (closeOdds == null || closeOdds <= 1) continue;
    const clv = t.odds / closeOdds - 1;
    n += 1;
    sum += clv;
    if (clv > 0) pos += 1;
  }
  return {
    n,
    posRate: n ? +(pos / n).toFixed(3) : 0,
    avgClv: n ? +(sum / n).toFixed(4) : 0,
  };
}

export function clvReport(): ClvReport {
  const closing = loadClosingOdds();
  const log = loadPredictionLog();
  const acc: Record<
    string,
    {
      n: number;
      nMis: number;
      absSum: number;
      favSum: number;
      favMisSum: number;
    }
  > = {};
  const rows: ClvReport['rows'] = [];
  let nMismatch = 0;

  for (const [id, c] of Object.entries(closing)) {
    const snap = log[id];
    if (!snap) continue;
    const close = trueIP3(c.h, c.d, c.a);
    if (!close) continue;
    const closeArr = { h: close.home, d: close.draw, a: close.away };
    const favKey = (['h', 'd', 'a'] as const).reduce((b, k) =>
      closeArr[k] > closeArr[b] ? k : b,
    );
    const mismatch = closeArr[favKey] >= MISMATCH;
    if (mismatch) nMismatch += 1;

    const models: Record<string, { h: number; d: number; a: number }> = {
      ensemble: { h: snap.pHome, d: snap.pDraw, a: snap.pAway },
      ...(snap.models ?? {}),
    };
    const favBiasRow: Record<string, number> = {};
    for (const [mid, p] of Object.entries(models)) {
      const ae =
        (Math.abs(p.h - close.home) +
          Math.abs(p.d - close.draw) +
          Math.abs(p.a - close.away)) /
        3;
      const favBias = p[favKey] - closeArr[favKey];
      const a = (acc[mid] ??= {
        n: 0,
        nMis: 0,
        absSum: 0,
        favSum: 0,
        favMisSum: 0,
      });
      a.n += 1;
      a.absSum += ae;
      a.favSum += favBias;
      if (mismatch) {
        a.nMis += 1;
        a.favMisSum += favBias;
      }
      favBiasRow[mid] = +favBias.toFixed(3);
    }
    rows.push({
      matchId: id,
      teams: `${snap.homeTeam}-${snap.awayTeam}`,
      closeFav: +closeArr[favKey].toFixed(2),
      mismatch,
      favBias: favBiasRow,
    });
  }

  const perModel: Record<string, ClvModelStat> = {};
  for (const [mid, a] of Object.entries(acc)) {
    perModel[mid] = {
      n: a.n,
      nMismatch: a.nMis,
      mae: +(a.absSum / a.n).toFixed(3),
      favBias: +(a.favSum / a.n).toFixed(3),
      favBiasMismatch: a.nMis ? +(a.favMisSum / a.nMis).toFixed(3) : 0,
    };
  }
  return {
    n: rows.length,
    mismatchThreshold: MISMATCH,
    nMismatch,
    perModel,
    rows: rows.slice(-50),
  };
}
