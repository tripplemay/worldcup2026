/**
 * Phase 10 · P4:LLM 研究分析员(经 AIGC 网关,OpenAI 兼容 HTTP)。
 *
 * 定位铁律(脊柱 §6.2):LLM 只当【分析员】—— 读结果、写诊断、提下一步假设(测哪个市场/分段/参数)。
 * **不进优化环、不碰 holdout、不算指标、不定晋级、不声称 edge**。晋级仍由确定性 G0–G7 闸门判。
 * buildAnalystBrief 纯函数(可测);analyzeResearch 为网络调用,未配 AIGC_API_KEY 时返回 null。
 */
import type { EpochResult } from './search';
import type { PromotionEntry } from './governance';

const BASE = process.env.AIGC_BASE ?? 'https://aigc.guangai.ai/v1';
const MODEL = process.env.RESEARCH_LLM_MODEL ?? 'qwen3.5-flash';

export function hasAnalyst(): boolean {
  return !!process.env.AIGC_API_KEY;
}

export interface AnalystBrief {
  epoch: number;
  text: string;
}

const f = (n: number | undefined, d = 4) =>
  n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(d);

/** 把研究状态摘成给 LLM 的事实简报(纯函数,确定性)。 */
export function buildAnalystBrief(
  timeline: EpochResult[],
  ledger: PromotionEntry[],
): AnalystBrief {
  const last = timeline[timeline.length - 1];
  const epoch = last?.epoch ?? 0;
  const recent = timeline.slice(-6);
  const epochLines = recent
    .map(
      (e) =>
        `- epoch ${e.epoch}(网格${e.gridSize}/累计N${
          e.cumulativeTrials
        }):冠军 ${e.winner.label},OOS gap ${f(e.winner.oosGap)},CLV-t ${f(
          e.winner.oosClvT,
          2,
        )},PBO ${f(e.pbo, 3)},DSR ${f(e.dsr.dsr, 3)},三筛 ${
          e.screen.overall ? '过' : '未过'
        }`,
    )
    .join('\n');
  const lastLedger = ledger[ledger.length - 1];
  const gauntlet = lastLedger
    ? `最近全 gauntlet:候选 ${lastLedger.label},卡在 ${
        lastLedger.verdict.blockedAt ?? '全过'
      };证据 CLV n=${lastLedger.evidence.clv.n} avg=${f(
        lastLedger.evidence.clv.avgClv,
      )} t=${f(lastLedger.evidence.clv.t, 2)};DSR ${f(
        lastLedger.evidence.roi.dsr,
        3,
      )} SPA-p ${f(lastLedger.evidence.roi.spaP, 3)} ROI-CI下界 ${f(
        lastLedger.evidence.roi.ciLower,
      )};跨赛季正占比 ${f(
        lastLedger.evidence.robust.subperiodsPositiveFrac,
        2,
      )};历史回撤 ${f(
        lastLedger.evidence.drawdown.historicalMaxDD,
        3,
      )} MC95 ${f(lastLedger.evidence.drawdown.mc95DD, 3)} 破产 ${
        lastLedger.evidence.drawdown.ruinPath ? '有' : '无'
      }`
    : '尚无全 gauntlet 记录';
  const explored = Array.from(
    new Set(
      recent.flatMap((e) =>
        e.configs.map((c) => c.label.replace(/[\d.\-]+$/, '')),
      ),
    ),
  ).join('、');
  const text = `联赛策略研究现状(联赛 EPL,市场 1X2 主盘,均样本外):
最近若干轮:
${epochLines}
${gauntlet}
已探索的参数维度前缀:${explored || '—'}
背景已知:EPL 1X2 主盘对锐利闭盘线大概率无 edge(gap-to-market ~0.02 压不动);marketWeight/shrinkEloScale/kellyFraction 对 CLV/精度惰性。引擎已留亚盘/大小球口但尚未喂候选。`;
  return { epoch, text };
}

export interface AnalystReport {
  at: number;
  epoch: number;
  text: string;
  model: string;
}

const SYSTEM = `你是足球策略研究平台的分析员。只做三件事:①读结果 ②写简短诊断 ③提 2-3 个具体、可执行的下一步搜索假设(测哪个市场/分段/时机/参数)。
铁律:你不下注、不决定晋级、绝不声称已找到 edge(晋级由确定性 G0–G7 闸门判);不建议在 holdout 上调参。
诚实:若现状是"无 edge 的干净证否",直说,并把假设指向更可能有 edge 的方向(如亚盘/大小球市场、更软联赛、特定分段)。
输出:纯中文,简洁 markdown,先一段诊断,再"下一步假设"要点列表。不超过 250 字。`;

const PROPOSER_SYSTEM = `你是参数搜索的提议器。只输出 JSON(无其它文字):{"proposals":[{"goalShrink":数,"dcRho":数,"minEv":数,"minProb":数,"maxEv":数,"rationale":"一句话"}]}。最多 4 组;数值必须在给定区间内;不要输出任何其它字段。`;

/**
 * 提议者 LLM 调用(进化闭环):输入 buildProposerBrief 产的简报(只含 L1/L2 粗化信息),
 * 返回原始响应文本(验证/夹紧/去重由 evolve.validateProposals 负责)。失败/未配 key → null。
 * 15s 超时(单次 run 内会按代多次调用,墙钟护栏在编排器)。
 */
export async function proposeConfigs(brief: string): Promise<string | null> {
  const key = process.env.AIGC_API_KEY;
  if (!key) return null;
  try {
    const payload: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 500,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PROPOSER_SYSTEM },
        { role: 'user', content: brief },
      ],
    };
    if (/qwen/i.test(MODEL)) payload.enable_thinking = false;
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

/** 调 LLM 产出研究诊断报告;未配 key / 失败返回 null(不影响搜索)。 */
export async function analyzeResearch(
  brief: AnalystBrief,
): Promise<AnalystReport | null> {
  const key = process.env.AIGC_API_KEY;
  if (!key) return null;
  try {
    const payload: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 600,
      temperature: 0.4,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: brief.text },
      ],
    };
    if (/qwen/i.test(MODEL)) payload.enable_thinking = false;
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    return { at: Date.now(), epoch: brief.epoch, text: content, model: MODEL };
  } catch {
    return null;
  }
}
