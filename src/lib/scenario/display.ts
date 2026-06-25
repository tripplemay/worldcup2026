/**
 * 「沙盘」推演 —— 前端展示口径与格式化纯函数(与 UI 解耦,便于单测)。
 *
 * 设计取舍:
 * - 旧 UI 用 Math.round 把 0.4% 之类抹成 0%,48 队列表里夺冠列几乎整列 0%,
 *   既丢失弱旅区分度又像 bug。这里对「绝对小但非零」的概率显示 "<1%"。
 * - 旧 UI 有用户级 QF/R32 口径切换,语义重叠(R32==出线)且与固定参照割裂;
 *   这里改为单一固定口径 DISPLAY_LENS(与后端 targetStage 默认一致),
 *   完整 6 阶段分布改由球队下钻面板呈现。
 */

import {
  STAGE_ORDER,
  type KnockoutRound,
  type Stage,
  type StageProbs,
  type TeamOutlook,
} from './types';

/**
 * 概率 → 百分比文案。
 * - p ≤ 0 → "0%"
 * - 0 < p 但四舍五入为 0(即 < 0.5%)→ "<1%"(保留「非零」信号,避免整列 0%)
 * - 其余 → 四舍五入取整,如 "15%"
 */
export function formatPct(p: number): string {
  if (!(p > 0)) return '0%';
  const r = Math.round(p * 100);
  return r === 0 ? '<1%' : `${r}%`;
}

/** 进度条宽度(CSS 百分比字符串),夹紧到 [0,1];NaN/Infinity 兜底为 0。 */
export function pctWidth(p: number): string {
  const w = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  return `${w * 100}%`;
}

/**
 * 固定展示口径:打进 8 强(整条晋级路径),与后端 targetStage 默认一致。
 * 取代旧的用户级 QF/R32 切换;完整 6 阶段在球队下钻面板里展示。
 */
export const DISPLAY_LENS: Stage = 'QF';

/** Stage → i18n 文案 key(含 OUT,杜绝拼接漏出裸 key)。 */
export const STAGE_LABEL_KEY: Record<Stage, string> = {
  OUT: 'scenarios.stOUT',
  R32: 'scenarios.stR32',
  R16: 'scenarios.stR16',
  QF: 'scenarios.stQF',
  SF: 'scenarios.stSF',
  FINAL: 'scenarios.stFINAL',
  CHAMPION: 'scenarios.stCHAMPION',
};

/**
 * 淘汰赛轮次 → i18n 文案 key(用于路径/对阵的「轮次」标签)。
 * 注意:R32 用专门的「32 强」而非 stR32(=出线,那是 lens 口径);P3 两队均达 4 强。
 */
export const KO_ROUND_LABEL_KEY: Record<KnockoutRound, string> = {
  R32: 'scenarios.r32Round',
  R16: 'scenarios.stR16',
  QF: 'scenarios.stQF',
  SF: 'scenarios.stSF',
  P3: 'scenarios.stSF',
  F: 'scenarios.stFINAL',
};

/** 一支队「最可能晋级路线」的一跳(给前端 chips 渲染)。 */
export interface RoadStep {
  round: KnockoutRound;
  norm: string;
  prob: number;
}

/**
 * 组装一支队的逐轮最可能对手路线:R32(topOpponent)→ R16/QF/SF/F(path)。
 * 每跳为该轮独立众数对手(分母=到达该轮),不保证同属一条真实模拟链。
 */
export function roadSteps(o: TeamOutlook): RoadStep[] {
  const out: RoadStep[] = [];
  if (o.topOpponent)
    out.push({
      round: 'R32',
      norm: o.topOpponent.norm,
      prob: o.topOpponent.prob,
    });
  for (const s of o.path ?? [])
    out.push({ round: s.round, norm: s.opponentNorm, prob: s.prob });
  return out;
}

/** 期望阶段索引(0..6 连续标量)→ 最近的离散阶段(用于「预期走多远」标尺标签)。 */
export function expStageStage(expStage: number): Stage {
  const max = STAGE_ORDER.length - 1; // 6 = CHAMPION
  if (!Number.isFinite(expStage)) return 'OUT'; // 防御 NaN/Infinity,避免 t(undefined) 崩溃
  const i = Math.max(0, Math.min(max, Math.round(expStage)));
  return STAGE_ORDER[i];
}

/** 「预期走多远」标尺进度(0..1):expStage / 最大阶段索引(6)。 */
export function expStageProgress(expStage: number): number {
  const max = STAGE_ORDER.length - 1;
  if (!Number.isFinite(expStage)) return 0;
  return Math.max(0, Math.min(1, expStage / max));
}

/** 晋级深度阶梯:6 档(出线→夺冠)的 i18n key + 取值函数(累积概率,单调递减成漏斗)。 */
export const DEPTH_STAGES: { key: string; pick: (p: StageProbs) => number }[] =
  [
    { key: 'scenarios.advance', pick: (p) => p.advance },
    { key: 'scenarios.stR16', pick: (p) => p.r16 },
    { key: 'scenarios.stQF', pick: (p) => p.qf },
    { key: 'scenarios.stSF', pick: (p) => p.sf },
    { key: 'scenarios.stFINAL', pick: (p) => p.final },
    { key: 'scenarios.stCHAMPION', pick: (p) => p.champion },
  ];
