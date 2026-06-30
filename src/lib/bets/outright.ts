/**
 * 赛事长期盘结算。支持 2026 世界杯冠军盘、冠亚军顺序盘;
 * 其他赛事返回 unsupported,由盈亏页人工处理。
 */
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import { buildKnockoutBracket } from 'lib/scenario/knockoutBracket';
import { toCanonicalName } from './cnTeams';
import type { LegResult, OutrightBetLeg } from './types';

export interface OutrightResolution {
  result: Extract<LegResult, 'won' | 'lost' | 'pending' | 'unsupported'>;
  winner?: string;
  runnerUp?: string;
}

/** 宽松识别中英文世界杯名称,但只允许 2026 届自动结算。 */
export function isWorldCup2026Competition(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  const isWorldCup = /世界杯/.test(s) || /(?:fifa\s*)?world\s*cup/.test(s);
  return isWorldCup && /2026/.test(s);
}

/** 冠军队名按现有中英文别名表统一后比较。 */
export function isSameChampion(selection: string, winner: string): boolean {
  return (
    normalizeTeam(toCanonicalName(selection)) ===
    normalizeTeam(toCanonicalName(winner))
  );
}

export interface ExactaSelection {
  winner: string;
  runnerUp: string;
}

/** 解析 "冠军 / 亚军" 顺序组合。 */
export function parseExactaSelection(
  selection: string,
): ExactaSelection | null {
  const parts = selection
    .split(/\s*(?:\/|／|>|＞|,|，)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return null;
  return { winner: parts[0], runnerUp: parts[1] };
}

export function isSameExacta(
  selection: string,
  winner: string,
  runnerUp: string,
): boolean {
  const pick = parseExactaSelection(selection);
  if (!pick) return false;
  return (
    isSameChampion(pick.winner, winner) &&
    isSameChampion(pick.runnerUp, runnerUp)
  );
}

function finalRunnerUp(
  bracket: ReturnType<typeof buildKnockoutBracket>,
): string | undefined {
  const final = bracket.nodes.find((n) => n.match === 104);
  if (!final?.decided || !bracket.champion?.norm) return undefined;
  const homeNorm = final.home.norm;
  const awayNorm = final.away.norm;
  if (homeNorm === bracket.champion.norm) return final.away.name;
  if (awayNorm === bracket.champion.norm) return final.home.name;
  return undefined;
}

export async function resolveOutrightLeg(
  leg: OutrightBetLeg,
): Promise<OutrightResolution> {
  if (
    !['OUTRIGHT_WINNER', 'OUTRIGHT_EXACTA'].includes(leg.market) ||
    !isWorldCup2026Competition(leg.competition)
  )
    return { result: 'unsupported' };

  try {
    const [standings, matches] = await Promise.all([
      espnProvider.getStandings(),
      espnProvider.getBracket(),
    ]);
    const bracket = buildKnockoutBracket({ standings, matches });
    const winner = bracket.champion?.name;
    if (!winner) return { result: 'pending' };
    if (leg.market === 'OUTRIGHT_EXACTA') {
      const runnerUp = finalRunnerUp(bracket);
      if (!runnerUp) return { result: 'pending', winner };
      return {
        result: isSameExacta(leg.selection, winner, runnerUp) ? 'won' : 'lost',
        winner,
        runnerUp,
      };
    }
    return {
      result: isSameChampion(leg.selection, winner) ? 'won' : 'lost',
      winner,
    };
  } catch {
    // 外部数据暂时失败时保持 pending,下轮重试,绝不误结。
    return { result: 'pending' };
  }
}
