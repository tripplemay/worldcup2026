/**
 * Phase 9:他平台投注单识别(视觉 LLM,经 AIGC 网关,OpenAI 兼容 HTTP)。
 *
 * 输入一张投注单截图(base64),强制视觉模型输出严格 JSON,
 * 解析成 RecognizedSlip(部分 BetSlip;webhook 再补 id/归属/状态/时间)。
 * 金额(本金/可赢)一律以截图为准,系统只做「结果匹配」,不重算赔率。
 * 未配置 AIGC_API_KEY 时返回 null(功能禁用);网络/LLM 失败一律 return null,绝不抛。
 */
import type {
  BetLeg,
  ComboPart,
  MatchBetLeg,
  OutrightBetLeg,
  RecognizedSlip,
} from './types';

const BASE = process.env.AIGC_BASE ?? 'https://aigc.guangai.ai/v1';
// 视觉模型:默认 qwen3.5-plus(与原 flash 同厂同网关、接受图文格式,且更准;
// doubao-pro 在网关上不接受多模态消息,勿用)。BETS_VISION_MODEL 可覆盖。
const MODEL = process.env.BETS_VISION_MODEL ?? 'qwen3.5-plus';

/** 可结算盘口码(全场 6 类 + 波胆 全场/上半场/下半场);其余 → OTHER 转人工。 */
const MARKETS: readonly string[] = [
  '1X2',
  'OU',
  'AH',
  'BTTS',
  'DC',
  'DNB',
  'CS',
  'CS1H',
  'CS2H',
];

const SYSTEM = `你是顶级体育博彩单据识别员。识别一张投注单截图,抽取成严格 JSON。
只输出 JSON,格式必须严格为:
{"stake":number,"potentialReturn":number,"currency":string|null,"platform":string|null,"legs":[{"kind":"match"|"outright","homeName":string|null,"awayName":string|null,"league":string|null,"matchDate":string|null,"competition":string|null,"settleAt":string|null,"market":"1X2|OU|AH|BTTS|DC|DNB|CS|CS1H|CS2H|COMBO|OUTRIGHT_WINNER|OTHER","selection":string,"line":number|null,"odds":number|null,"rawText":string|null,"parts":[{"market":string,"selection":string,"line":number|null}]|null,"live":boolean,"baseHome":number|null,"baseAway":number|null}],"confidence":0到1的数}
规则:
- potentialReturn = 注单「可赢/可盈金额」一栏的数字 = 净盈利(不含本金)。**务必逐位看准这一栏**,不要与赔率或本金混淆。
- 赔率一律用小数赔率(decimal odds)。
- **赛事冠军/夺冠长期盘**(如「世界杯2026 冠军 英格兰 @7.80」):kind="outright",market="OUTRIGHT_WINNER",competition 填赛事名,selection 填冠军球队,settleAt 填截图所示开赛/结算时间;homeName/awayName/matchDate 一律 null。不要虚构主客队。
- 具体比赛盘口:kind="match",按下述规则填写 homeName/awayName;competition/settleAt 一律 null。
- 全场标准盘口映射:1X2(胜平负)、OU(大小球)、AH(让球/亚盘)、BTTS(双方进球)、DC(双重机会)、DNB(胜平负去平)。
- 波胆/正确比分 → market 用:全场=CS、上半场=CS1H、下半场=CS2H;**selection 填「主-客」比分**(按所列主客顺序,如 "2-0");rawText 填中文描述(如 "下半场波胆 1-1")。
- **其它真不支持的盘口一律 market="OTHER"**(如:角球、罚牌、球员相关、总进球单双 等);selection 填原文选项,rawText 填中文描述。
- **同场组合盘**(一个选项里串了多个条件、需全部命中,如「和局 & 小2.5」「主胜 & 双方进球」「让球 & 大小」):market="COMBO",并在 parts 给各子盘 [{market,selection,line}](子 market 用上述标准码,selection/line 同上规则);例:「和局&小2.5」→ parts=[{"market":"1X2","selection":"draw","line":null},{"market":"OU","selection":"Under","line":2.5}];「主胜&双方进球」→ [{"market":"1X2","selection":"home"},{"market":"BTTS","selection":"Yes"}]。parts 至少 2 段;rawText 填中文描述。
- 严禁把波胆/半场/其它盘口硬塞成 AH/OU/1X2 等并编造让分或盘线(line)。
- **滚球/进行中(in-play)单**:截图带「滚球/进行中/Live」标记、或显示比赛实时比分时,**live=true**,并把「下注时所示的当前比分」按所列主客顺序填入 baseHome/baseAway(整数,如下注时 1:0 则 baseHome=1、baseAway=0);赛前单 live=false、baseHome/baseAway=null。若确为滚球但截图未显示当前比分,则 live=true 且 base 留 null。**这关乎滚球让球/大小按「剩余赛程」结算,务必逐位看准当前比分。**
- selection 归一化(标准 6 码时):1X2/AH/DNB 用 home 或 away(平局用 draw;AH 的 home/away 取所列让球一方);OU 用 Over 或 Under;BTTS 用 Yes 或 No;DC 用 1X、12 或 X2。
- 胜平负(1X2)三选务必分清:主胜=home、**和局/平局/平/和/Draw/X=draw**、客胜=away。「独赢」一般指 1X2 胜负;**严禁把「和局/平」误判成 home/away 独赢**——和局必须 selection=draw。
- **优先映射到上述标准盘口码**;只有确实无法归类(角球、罚牌、球员、特色组合、总进球单双 等)才用 OTHER,**不要因不确定就用 OTHER**(标准胜平负/大小/让球务必给出对应码)。
- 串关多关时:**逐关独立识别 market/selection/赔率,互不沿用**,每关都与截图逐项核对。
- 队名保留英文/截图原文。
- matchDate 若可见输出 ISO(或 YYYY-MM-DD),不可见用 null。
- 任何读不出的字段一律用 null。
- 只输出 JSON,不要任何解释文字。`;

const USER = '识别这张投注单截图,按系统要求输出严格 JSON。';

/** 是否已配置视觉识别(AIGC key)。 */
export function hasVision(): boolean {
  return !!process.env.AIGC_API_KEY;
}

/** 把任意值转成有限数;失败返回 undefined。 */
function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 把任意值转成非空 trim 字符串;失败返回 undefined。 */
function toStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

/** 解析同场组合盘各子盘;任一子盘 market 非标准码、或不足 2 段 → undefined(整组退 OTHER)。 */
function parseComboParts(raw: unknown): ComboPart[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ComboPart[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') return undefined;
    const o = it as Record<string, unknown>;
    const m = toStr(o.market)?.toUpperCase();
    if (!m || !MARKETS.includes(m)) return undefined; // 子盘不支持 → 整组不可自动结算
    const part: ComboPart = { market: m, selection: toStr(o.selection) ?? '' };
    if (m === 'AH' || m === 'OU') {
      const line = toNum(o.line);
      if (line !== undefined) part.line = line;
    }
    out.push(part);
  }
  return out.length >= 2 ? out : undefined;
}

/** 清洗单腿:队名缺失则返回 null(丢弃该腿)。 */
function cleanMatchLeg(o: Record<string, unknown>): MatchBetLeg | null {
  const homeName = toStr(o.homeName);
  const awayName = toStr(o.awayName);
  if (!homeName || !awayName) return null;

  // 市场码大小写归一后再匹配:模型偶尔输出小写/变体(cs/ou/1x2),不应因此误降为 OTHER
  const marketRaw = toStr(o.market)?.toUpperCase();
  // 标准码保留;COMBO 解析各子盘(子盘须全部为标准码且≥2,否则退 OTHER);其余 'OTHER' 转人工
  let market: string;
  let parts: ComboPart[] | undefined;
  if (marketRaw === 'COMBO') {
    parts = parseComboParts(o.parts);
    market = parts ? 'COMBO' : 'OTHER';
  } else {
    market = marketRaw && MARKETS.includes(marketRaw) ? marketRaw : 'OTHER';
  }

  const leg: MatchBetLeg = {
    kind: 'match',
    homeName,
    awayName,
    market,
    selection: toStr(o.selection) ?? '',
  };
  if (parts) leg.parts = parts;

  const league = toStr(o.league);
  if (league !== undefined) leg.league = league;
  const matchDate = toStr(o.matchDate);
  if (matchDate !== undefined) leg.matchDate = matchDate;
  const odds = toNum(o.odds);
  if (odds !== undefined) leg.odds = odds;
  const rawText = toStr(o.rawText);
  if (rawText !== undefined) leg.rawText = rawText;
  // 盘线只对 AH/OU 有意义;其余(波胆/OTHER 等)不带 line,避免误导
  if (market === 'AH' || market === 'OU') {
    const line = toNum(o.line);
    if (line !== undefined) leg.line = line;
  }

  // 滚球(剩余赛程口径):live 标记 + 下注时比分基线(整数、非负,二者齐全才保留)
  if (o.live === true || o.live === 'true') leg.live = true;
  const bh = toNum(o.baseHome);
  const ba = toNum(o.baseAway);
  if (
    bh !== undefined &&
    ba !== undefined &&
    bh >= 0 &&
    ba >= 0 &&
    Number.isInteger(bh) &&
    Number.isInteger(ba)
  ) {
    leg.baseHome = bh;
    leg.baseAway = ba;
  }

  return leg;
}

/** 清洗赛事冠军长期盘;不要求也不接受虚构主客队。 */
function cleanOutrightLeg(o: Record<string, unknown>): OutrightBetLeg | null {
  const competition = toStr(o.competition) ?? toStr(o.league);
  const selection = toStr(o.selection);
  if (!competition || !selection) return null;
  const leg: OutrightBetLeg = {
    kind: 'outright',
    competition,
    market: 'OUTRIGHT_WINNER',
    selection,
  };
  const settleAt = toStr(o.settleAt) ?? toStr(o.matchDate);
  if (settleAt !== undefined) leg.settleAt = settleAt;
  const odds = toNum(o.odds);
  if (odds !== undefined) leg.odds = odds;
  const rawText = toStr(o.rawText);
  if (rawText !== undefined) leg.rawText = rawText;
  return leg;
}

/** 按 kind/冠军盘口分流清洗;旧模型未输出 kind 时仍按比赛腿兼容。 */
function cleanLeg(raw: unknown): BetLeg | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = toStr(o.kind)?.toLowerCase();
  const market = toStr(o.market)?.toUpperCase();
  if (
    kind === 'outright' ||
    ['OUTRIGHT_WINNER', 'OUTRIGHT', 'CHAMPION', 'WINNER'].includes(market ?? '')
  )
    return cleanOutrightLeg(o);
  return cleanMatchLeg(o);
}

/**
 * 纯函数:把识别原始 JSON 校验/清洗成 RecognizedSlip。
 * - stake / potentialReturn 必须为有限数(经 Number 强转),否则返回 null。
 * - legs 必须为清洗后非空数组,否则返回 null。
 * - confidence 钳到 [0,1];缺失/NaN 默认 0.5。
 * - 可选字段(currency/line/odds 等)null→undefined。
 */
export function parseRecognizedSlip(raw: unknown): RecognizedSlip | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const stake = toNum(o.stake);
  const potentialReturn = toNum(o.potentialReturn);
  if (stake === undefined || potentialReturn === undefined) return null;
  // 金额异常(负数)视为识别失败,避免脏数据入账
  if (stake < 0 || potentialReturn < 0) return null;

  const rawLegs = o.legs;
  if (!Array.isArray(rawLegs) || rawLegs.length === 0) return null;
  const legs = rawLegs.map(cleanLeg).filter((l): l is BetLeg => l !== null);
  if (legs.length === 0) return null;

  const confRaw = Number(o.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.max(0, Math.min(1, confRaw))
    : 0.5;

  const slip: RecognizedSlip = {
    stake,
    potentialReturn,
    legs,
    confidence,
  };
  const currency = toStr(o.currency);
  if (currency !== undefined) slip.currency = currency;
  const platform = toStr(o.platform);
  if (platform !== undefined) slip.platform = platform;

  return slip;
}

/**
 * 视觉识别一张投注单截图;未配置 key / 网络 / LLM 失败一律返回 null。
 * @param imageBase64 截图的 base64(不含 data: 前缀)
 * @param mime 图片 MIME(默认 image/jpeg)
 */
export async function recognizeBetSlip(
  imageBase64: string,
  mime = 'image/jpeg',
): Promise<RecognizedSlip | null> {
  const result = await recognizeBetSlipDetailed(imageBase64, mime);
  return result.ok ? result.slip : null;
}

export type RecognitionFailureCode =
  | 'not_configured'
  | 'provider_error'
  | 'timeout'
  | 'invalid_response'
  | 'invalid_slip';

export type RecognitionResult =
  | { ok: true; slip: RecognizedSlip }
  | { ok: false; code: RecognitionFailureCode };

/** 带失败分类的识别入口,供机器人返回准确提示。 */
export async function recognizeBetSlipDetailed(
  imageBase64: string,
  mime = 'image/jpeg',
): Promise<RecognitionResult> {
  const key = process.env.AIGC_API_KEY;
  if (!key) return { ok: false, code: 'not_configured' };
  try {
    const payload: Record<string, unknown> = {
      model: MODEL,
      max_tokens: 1500,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${imageBase64}` },
            },
          ],
        },
      ],
    };
    // qwen 是推理模型:关闭思考,避免烧大量 reasoning tokens
    if (/qwen/i.test(MODEL)) payload.enable_thinking = false;

    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(40_000),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error('[bets/recognize] 模型请求失败', res.status);
      return { ok: false, code: 'provider_error' };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { ok: false, code: 'invalid_response' };
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      console.error('[bets/recognize] 模型返回非 JSON');
      return { ok: false, code: 'invalid_response' };
    }
    const slip = parseRecognizedSlip(raw);
    return slip ? { ok: true, slip } : { ok: false, code: 'invalid_slip' };
  } catch (e) {
    const timeout =
      e instanceof Error &&
      (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.error(
      '[bets/recognize] 识别请求异常',
      timeout ? 'timeout' : e instanceof Error ? e.name : 'unknown',
    );
    return { ok: false, code: timeout ? 'timeout' : 'provider_error' };
  }
}

export function recognitionFailureMessage(
  code: RecognitionFailureCode,
): string {
  switch (code) {
    case 'not_configured':
      return '⚠️ 视觉模型未配置,请联系管理员。';
    case 'timeout':
      return '⚠️ 视觉模型响应超时,请稍后重试。';
    case 'invalid_slip':
      return '⚠️ 已读取图片,但注单字段不完整或盘口暂不支持。';
    case 'invalid_response':
      return '⚠️ 视觉模型返回格式异常,请重试。';
    default:
      return '⚠️ 视觉模型服务暂时不可用,请稍后重试。';
  }
}
