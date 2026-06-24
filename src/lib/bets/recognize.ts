/**
 * Phase 9:他平台投注单识别(视觉 LLM,经 AIGC 网关,OpenAI 兼容 HTTP)。
 *
 * 输入一张投注单截图(base64),强制视觉模型输出严格 JSON,
 * 解析成 RecognizedSlip(部分 BetSlip;webhook 再补 id/归属/状态/时间)。
 * 金额(本金/可赢)一律以截图为准,系统只做「结果匹配」,不重算赔率。
 * 未配置 AIGC_API_KEY 时返回 null(功能禁用);网络/LLM 失败一律 return null,绝不抛。
 */
import type { BetLeg, RecognizedSlip } from './types';

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
{"stake":number,"potentialReturn":number,"currency":string|null,"platform":string|null,"legs":[{"homeName":string,"awayName":string,"league":string|null,"matchDate":string|null,"market":"1X2|OU|AH|BTTS|DC|DNB|CS|CS1H|CS2H|OTHER","selection":string,"line":number|null,"odds":number|null,"rawText":string|null}],"confidence":0到1的数}
规则:
- potentialReturn = 注单「可赢/可盈金额」一栏的数字 = 净盈利(不含本金)。**务必逐位看准这一栏**,不要与赔率或本金混淆。
- 赔率一律用小数赔率(decimal odds)。
- 全场标准盘口映射:1X2(胜平负)、OU(大小球)、AH(让球/亚盘)、BTTS(双方进球)、DC(双重机会)、DNB(胜平负去平)。
- 波胆/正确比分 → market 用:全场=CS、上半场=CS1H、下半场=CS2H;**selection 填「主-客」比分**(按所列主客顺序,如 "2-0");rawText 填中文描述(如 "下半场波胆 1-1")。
- **其它真不支持的盘口一律 market="OTHER"**(如:角球、罚牌、球员相关、特色组合、总进球单双 等);selection 填原文选项,rawText 填中文描述。
- 严禁把波胆/半场/其它盘口硬塞成 AH/OU/1X2 等并编造让分或盘线(line)。
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

/** 清洗单腿:队名缺失则返回 null(丢弃该腿)。 */
function cleanLeg(raw: unknown): BetLeg | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const homeName = toStr(o.homeName);
  const awayName = toStr(o.awayName);
  if (!homeName || !awayName) return null;

  // 市场码大小写归一后再匹配:模型偶尔输出小写/变体(cs/ou/1x2),不应因此误降为 OTHER
  const marketRaw = toStr(o.market)?.toUpperCase();
  // 命中可结算码(6 类 + 波胆 CS/CS1H/CS2H)才保留;其余一律 'OTHER'(角球/特色等)→ 转人工
  const market = marketRaw && MARKETS.includes(marketRaw) ? marketRaw : 'OTHER';

  const leg: BetLeg = {
    homeName,
    awayName,
    market,
    selection: toStr(o.selection) ?? '',
  };

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

  return leg;
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
  const key = process.env.AIGC_API_KEY;
  if (!key) return null;
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
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return parseRecognizedSlip(JSON.parse(content));
  } catch {
    return null;
  }
}
