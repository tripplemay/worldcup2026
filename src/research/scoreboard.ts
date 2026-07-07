/**
 * Phase 10 · 人话成绩单(scoreboard)—— 观测台顶部的直观区域。
 *
 * 回答三个人类问题:①预测得准不准(命中率 vs 市场)②下注下得怎么样(样本外注数/胜率/ROI)
 * ③钱变成了多少(虚拟 1 万本金 → X;前向实测收益)。外加最重要的一句话:**现在能不能下注**
 * (由 G0–G7 关卡判定,逐关进度可视)。每轮 research/run 顺手计算落盘,面板只读。
 * 统计口径:一律【样本外验证窗】(锁定 holdout 之前的 val 段)—— 不用样本内数字骗人。
 */
import { runStrategy } from './engine';
import { runAccuracy } from './accuracy';
import { partitionWithLockedHoldout, toStrategyParams } from './evolve';
import type { EvolutionState } from './evolve';
import { forwardSummary } from './forward';
import type { ForwardStore } from './forward';
import type { HoldoutManifest, PromotionEntry } from './governance';
import type { EngineDataset } from './engine';
import type { KernelStore } from './recalibrate';
import type { MatchLogRow } from './accuracy';

export interface Scoreboard {
  at: number;
  status: EvolutionState['status'];
  generation: number;
  insufficientPower: boolean;
  incumbentLabel: string | null;
  // 真钱建议(人话结论的判定源)
  passedAll: boolean;
  blockedAt: string | null;
  gates: { id: string; status: 'pass' | 'fail' | 'skip' }[];
  // ① 预测
  accuracy: {
    oursHit: number;
    marketHit: number;
    gapBrier: number;
    n: number;
  } | null;
  // ①b 轴C 预测精度(双场景,tuned 内核在样本外 val 窗实算;kernel 未刷新时 null)
  axisC: {
    blendHit: number; // 有赔率场景:开盘锚融合命中率
    closeHit: number; // 闭盘去水命中率(天花板,同子集)
    gapBlendClose: number; // ≤0 = 融合追平/超越闭盘
    gapBlendOpen: number; // <0 = 模型携带开盘之外的正交信息
    eceBlend: number | null; // 融合校准(ECE,越小越好)
    blendN: number;
    marketWeight: number; // tuned 融合权重(<0.9 = 模型有非零最优权重)
    oursGapTuned: number; // 无赔率场景:tuned 市场无关内核 vs 闭盘 gap(val)
    // 比分级(泊松矩阵 vs 真实比分;score-tuned 内核在 val 窗实算)
    score?: {
      logLossBaseline: number; // 基线内核 val 比分 LL
      logLossTuned: number; // 重校准后 val 比分 LL(越小越好)
      mlsHit: number; // 最可能比分命中率
      marginBias: number; // 净胜球偏差(>0 = 低估主队)
      dispersionRatio: number; // 方差比(>1 = 真实比泊松更散)
      n: number;
    };
  } | null;
  // ①c 逐场对照(val 窗最近 80 场,新→旧;直观看逐场预测 vs 赛果)
  axisCLog: MatchLogRow[] | null;
  // ② 下注(样本外模拟)
  betting: {
    n: number;
    winRate: number;
    record: string;
    roi: number;
    pnl: number;
    clvAvg: number;
  } | null;
  // ③ 收益(虚拟本金复利 + 前向实测)
  money: { start: number; end: number } | null;
  forward: { n: number; pnl: number; roi: number; clvT: number } | null;
  window: { from: string; to: string } | null; // 样本外窗(诚实标注口径)
}

/** 由当前 incumbent 在【样本外 val 窗】实算成绩单(约 2-5s;每轮 run 一次)。 */
export async function buildScoreboard(
  dataset: EngineDataset,
  state: EvolutionState,
  manifest: HoldoutManifest,
  forward: ForwardStore | null,
  latestLedger: PromotionEntry | null,
  kernel?: KernelStore | null,
): Promise<Scoreboard> {
  const base: Scoreboard = {
    at: state.runId,
    status: state.status,
    generation: state.generation,
    insufficientPower: state.insufficientPower,
    incumbentLabel: state.incumbent?.label ?? null,
    passedAll: latestLedger?.verdict.passedAll ?? false,
    blockedAt: latestLedger?.verdict.blockedAt ?? null,
    gates: (latestLedger?.verdict.gates ?? []).map((g) => ({
      id: g.id,
      status: g.status,
    })),
    accuracy: null,
    axisC: null,
    axisCLog: null,
    betting: null,
    money: null,
    forward: null,
    window: null,
  };

  // 轴C 精度块(不依赖 incumbent:tuned 内核在 val 窗实算;kernel 缺失则留 null)
  const partition = partitionWithLockedHoldout(dataset, manifest.holdoutFrom);
  if (kernel) {
    try {
      const t = kernel.blend.tuned;
      const ab = await runAccuracy(dataset, {
        tuning: {
          goalShrink: t.goalShrink,
          dcRho: t.dcRho,
          shrinkEloScale: t.shrinkEloScale,
        },
        home: { eloBonus: t.eloBonus, goalMult: t.goalMult },
        marketWeight: t.marketWeight,
        from: partition.valFrom,
        to: partition.valTo,
        matchLog: true,
      });
      base.axisCLog = (ab.matchLog ?? []).slice(-80).reverse(); // 最近 80 场,新→旧
      base.axisC = {
        blendHit: ab.blend.hitRate,
        closeHit: ab.closeSub.hitRate, // 与 blend 严格同子集(全样本闭盘不可比)
        gapBlendClose: ab.gapBlendClose,
        gapBlendOpen: ab.gapBlendOpen,
        eceBlend: ab.calibration.blend,
        blendN: ab.blend.n,
        marketWeight: t.marketWeight,
        oursGapTuned: kernel.ours.valGapTuned,
      };
      // 比分级读数:score-tuned 内核单独在 val 窗实算(矩阵与市场无关,是模型独立价值域)
      if (kernel.score) {
        const ts = kernel.score.tuned;
        const asr = await runAccuracy(dataset, {
          tuning: {
            goalShrink: ts.goalShrink,
            dcRho: ts.dcRho,
            shrinkEloScale: ts.shrinkEloScale,
          },
          home: { eloBonus: ts.eloBonus, goalMult: ts.goalMult },
          marketWeight: ts.marketWeight,
          from: partition.valFrom,
          to: partition.valTo,
          matchLog: true,
        });
        if (asr.score)
          base.axisC = {
            ...base.axisC,
            score: {
              logLossBaseline: kernel.score.valGapBaseline,
              logLossTuned: kernel.score.valGapTuned,
              mlsHit: asr.score.mlsHit,
              marginBias: asr.score.marginBias,
              dispersionRatio: asr.score.dispersionRatio,
              n: asr.score.n,
            },
          };
        // 逐场表的「预测比分」与比分面板必须同内核(否则表内绿勾占比与 mlsHit 对不上):
        // 1X2 概率保持 blend-tuned 通道,仅 mls/mlsP 用 score-tuned 通道按场覆写
        if (asr.matchLog && base.axisCLog) {
          const byKey = new Map(
            asr.matchLog.map((r) => [`${r.date}|${r.home}|${r.away}`, r]),
          );
          base.axisCLog = base.axisCLog.map((r) => {
            const s = byKey.get(`${r.date}|${r.home}|${r.away}`);
            return s?.mls ? { ...r, mls: s.mls, mlsP: s.mlsP } : r;
          });
        }
      }
    } catch {
      /* 轴C 失败不阻断成绩单其余部分 */
    }
  }
  if (!state.incumbent) return base;

  const sp = toStrategyParams(state.incumbent.evo);
  // 样本外窗(val 段;止于锁定 holdout 之前)—— runStrategy 的 from/to 已保证不触 L3
  const s = await runStrategy(dataset, {
    ...sp,
    from: partition.valFrom,
    to: partition.valTo,
  });
  const a = await runAccuracy(dataset, {
    tuning: sp.tuning,
    home: sp.home,
    marketWeight: sp.marketWeight,
    from: partition.valFrom,
    to: partition.valTo,
  });
  const fwd = forwardSummary(forward).find(
    (f) => f.configHash === state.incumbent!.configHash,
  );
  return {
    ...base,
    accuracy: {
      oursHit: a.ours.hitRate,
      marketHit: a.market.hitRate,
      gapBrier: a.gapBrier,
      n: a.n,
    },
    betting: {
      n: s.value.bets,
      winRate: s.value.winRate,
      record: s.value.record,
      roi: s.value.roi,
      pnl: s.value.pnl,
      clvAvg: s.clv.avgClv,
    },
    money: { start: s.bankrollStart, end: s.bankrollEnd },
    forward: fwd
      ? { n: fwd.n, pnl: fwd.pnl, roi: fwd.roi, clvT: fwd.clvT }
      : null,
    window: { from: partition.valFrom, to: partition.valTo },
  };
}
