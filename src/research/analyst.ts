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
// 推理主力 gpt-5.5(网关实测支持 json_object;当前未定价=零成本;env 可覆盖回退)
const MODEL = process.env.RESEARCH_LLM_MODEL ?? 'gpt-5.5';

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
  leagueName = 'EPL',
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
  const text = `联赛策略研究现状(联赛 ${leagueName},市场 1X2/亚盘/大小球主盘,均样本外):
最近若干轮:
${epochLines}
${gauntlet}
已探索的参数维度前缀:${explored || '—'}
背景已知:英超主盘已跨市场证否(CLV 显著负);marketWeight/shrinkEloScale/kellyFraction 对 CLV/精度惰性。软联赛(英冠/苏超/土超等)是当前假设主战场。`;
  return { epoch, text };
}

export interface AnalystReport {
  at: number;
  epoch: number;
  text: string;
  model: string;
}

/** 平台公开常数(闸门/检验阈值):分析员合法输出会引用但简报不含,一律入白名单。 */
const PLATFORM_CONSTANTS = [
  1.28, 0.53, 0.005, 0.95, 0.05, 0.1, 0.002, 0.25, 2500, 100, 150,
];

/**
 * 报告数字审计(仪器债修复,2026-07-09):t1 曾出现分析员幻觉 CLV-t=2.31(台账实为
 * 0.33)。核对报告中「像指标的数值」(≥2 位小数)是否能在简报里找到对应(含 ×100
 * 百分比换算,及 0.1% 相对容差)。返回核对不到的数值列表 —— 仅作警示追加,不拦截报告。
 * 细节(评审校验实测定形):
 *  · 只查 ≥2 位小数:整数与一位小数(「2-3 个假设」「G0–G7」)误伤率太高,不核对;
 *  · 负号前瞻:紧跟数字/点后的 '-' 是区间连字符(「0.33-0.55」),不是负号 —— 否则
 *    忠实引用的区间右端会被切成伪负数误标;
 *  · 不做 ÷100 反向换算:报告两位小数 ×100 撞简报任意小整数(epoch 号/代数)的
 *    概率太高,会把真幻觉白名单化(0.07 撞「G7」的 7)。
 */
export function auditReportNumbers(brief: string, report: string): string[] {
  const briefNums = (brief.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .concat(PLATFORM_CONSTANTS);
  const suspects = report.match(/(?<![\d.])-?\d+\.\d{2,}/g) ?? [];
  const bad: string[] = [];
  for (const s of Array.from(new Set(suspects))) {
    const r = Number(s);
    const ok = briefNums.some(
      (b) =>
        Math.abs(r - b) <= Math.max(5e-3, Math.abs(b) * 1e-3) ||
        Math.abs(r - b * 100) <= 0.05, // 简报 0.551 → 报告 55.10(%)
    );
    if (!ok) bad.push(s);
  }
  return bad.slice(0, 5);
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
    // 数字审计:核对不到的指标数值追加警示(不拦截 —— 分析员只写诊断,决策仍看台账)
    const bad = auditReportNumbers(brief.text, content);
    const text = bad.length
      ? `${content}\n\n> ⚠️ 数字核对:${bad.join(
          '、',
        )} 未能在数据简报中核对到,可能为模型幻觉,请以台账数字为准。`
      : content;
    return { at: Date.now(), epoch: brief.epoch, text, model: MODEL };
  } catch {
    return null;
  }
}
