/**
 * Phase 10 · 合成注入实验(平台生死判据):
 * 在真实联赛数据集的**副本**上,对确定性伪随机子集的 1X2 开盘主胜价注入已知抬升
 * (默认 +2.5%,闭盘不动)→ 构造精确已知的 CLV edge(CLV=成交/闭盘−1,注入即 +liftPct)。
 * 用修复后的仪器(两段式选参 + Welch 改进裁决)跑完整进化 campaign:
 *  · 注入组:管线必须检出(冠军 G1 clvPass)—— 检不出 = 搜索层判死刑;
 *  · 空白对照组:管线必须不误报(clvPass 恒 false)—— 误报 = 仪器修成了触发狂。
 * 本文件只有纯函数(不落盘、不碰 store、不污染任何联赛命名空间);campaign 由
 * __tests__/syntheticCampaign.test.ts(SYNTH_CAMPAIGN=1 显式触发)驱动。
 */
import type { EngineDataset, MatchOddsView } from './engine';

export interface InjectOpts {
  rate?: number; // 注入场次比例(默认 0.4)
  liftPct?: number; // 开盘主胜价抬升幅度(默认 0.025 = +2.5% CLV)
  seed?: string; // 子集选择种子(默认 'synth-v1';同种子同数据 → 同子集)
}

export interface InjectResult {
  dataset: EngineDataset; // 深拷贝副本(原数据集不被触碰)
  injected: string[]; // 被注入的 matchKey(升序,审计/验收用)
  rate: number;
  liftPct: number;
}

/**
 * djb2 + murmur3 fmix32 终混 → [0,1) 确定性伪随机(无 Math.random)。
 * 终混必须有:裸 djb2 对尾部单字符差异(如种子 s1→s2)只有 ±1 的哈希差,
 * 几乎不会翻越 rate 阈值 → 不同种子选出同一子集。
 */
const unitHash = (s: string): number => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

/**
 * 注入已知 edge:对 odds 里**有 1X2 开盘价**的比赛,按 unitHash(matchKey|seed)<rate
 * 选子集,开盘 h/d/a **三向同抬** ×(1+liftPct)(4 位小数);闭盘/其它市场/赛果全部不动。
 * 为何三向:只抬单边会精准招募模型最高估该侧的比赛(边际注=逆向选择最重的注,
 * 实测基线 CLV ≈ −3% 把 +2.5% 吃掉大半);三向同抬让引擎按自身模型自然选侧,
 * 注入场任何 value 注都带 +liftPct 的外生 CLV 位移 —— 干净、可检出。
 * 无开盘价的比赛不注入(引擎会回退闭盘下注 → CLV 为 null,对检出无贡献)。
 */
export function injectEdge(
  dataset: EngineDataset,
  opts?: InjectOpts,
): InjectResult {
  const rate = opts?.rate ?? 0.4;
  const liftPct = opts?.liftPct ?? 0.025;
  const seed = opts?.seed ?? 'synth-v1';
  const injected: string[] = [];
  const odds: Record<string, MatchOddsView> = {};
  for (const [key, mv] of Object.entries(dataset.odds)) {
    const open = mv.x2?.open;
    if (open && unitHash(`${key}|${seed}`) < rate) {
      injected.push(key);
      odds[key] = {
        ...mv,
        x2: {
          ...mv.x2!,
          open: {
            h: +(open.h * (1 + liftPct)).toFixed(4),
            d: +(open.d * (1 + liftPct)).toFixed(4),
            a: +(open.a * (1 + liftPct)).toFixed(4),
          },
        },
      };
    } else {
      odds[key] = mv;
    }
  }
  injected.sort();
  return {
    dataset: {
      ...dataset,
      allHist: [...dataset.allHist],
      allRes: [...dataset.allRes],
      odds,
    },
    injected,
    rate,
    liftPct,
  };
}

/**
 * 构造性零假设对照组:全部 1X2 开盘价改写为 闭盘 ×(1+零均值种子噪声 ±noisePct),
 * h/d/a 独立扰动 → 任何注的真 CLV = 纯噪声、均值恒 0。
 * 为何不用真实数据当对照:真实开/闭盘差里可能存在真 CLV 结构(如高 minEv 1X2 角落,
 * 旧仪器失明从未探过),「必须无检出」的断言对真实数据不成立;对照必须按构造为 null。
 */
export function makeNullControl(
  dataset: EngineDataset,
  opts?: { noisePct?: number; seed?: string },
): EngineDataset {
  const noise = opts?.noisePct ?? 0.01;
  const seed = opts?.seed ?? 'null-v1';
  const odds: Record<string, MatchOddsView> = {};
  for (const [key, mv] of Object.entries(dataset.odds)) {
    const close = mv.x2?.close;
    if (mv.x2?.open && close) {
      const jitter = (sel: string) =>
        1 + (unitHash(`${key}|${sel}|${seed}`) * 2 - 1) * noise;
      odds[key] = {
        ...mv,
        x2: {
          ...mv.x2,
          open: {
            h: +(close.h * jitter('h')).toFixed(4),
            d: +(close.d * jitter('d')).toFixed(4),
            a: +(close.a * jitter('a')).toFixed(4),
          },
        },
      };
    } else {
      odds[key] = mv;
    }
  }
  return {
    ...dataset,
    allHist: [...dataset.allHist],
    allRes: [...dataset.allRes],
    odds,
  };
}
