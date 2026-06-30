/**
 * 赛事长期盘结算。首期只自动结算 2026 世界杯冠军盘;
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

export async function resolveOutrightLeg(
  leg: OutrightBetLeg,
): Promise<OutrightResolution> {
  if (
    leg.market !== 'OUTRIGHT_WINNER' ||
    !isWorldCup2026Competition(leg.competition)
  )
    return { result: 'unsupported' };

  try {
    const [standings, matches] = await Promise.all([
      espnProvider.getStandings(),
      espnProvider.getBracket(),
    ]);
    const winner = buildKnockoutBracket({ standings, matches }).champion?.name;
    if (!winner) return { result: 'pending' };
    return {
      result: isSameChampion(leg.selection, winner) ? 'won' : 'lost',
      winner,
    };
  } catch {
    // 外部数据暂时失败时保持 pending,下轮重试,绝不误结。
    return { result: 'pending' };
  }
}
