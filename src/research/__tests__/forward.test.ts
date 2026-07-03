/**
 * G7 前向管道单测:首跑立 watermark 不回填 / 新数据到达补记虚拟注 / summary 与 evidence 口径。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  updateForwardLog,
  forwardSummary,
  forwardEvidence,
} from '../forward';
import type { ForwardStore } from '../forward';
import { DEFAULT_EVO, toStrategyParams } from '../evolve';
import { configHash } from '../governance';
import type { EngineDataset, MatchOddsView } from '../engine';
import type { HistMatch, ResultMatch } from 'lib/predict/types';

const seed = (n: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'seed/leagues', n), 'utf8'));
const ds: EngineDataset = {
  allHist: Object.values(
    seed('league-epl-2025-historical.json') as Record<string, HistMatch>,
  ),
  allRes: Object.values(
    seed('league-epl-2025-results.json') as Record<string, ResultMatch>,
  ),
  odds: seed('league-epl-2025-oddsx.json') as Record<string, MatchOddsView>,
};
// 控时长:近 3 季
const SINCE = '2023-08-01';
ds.allRes = ds.allRes.filter((r) => r.date >= SINCE);
ds.allHist = ds.allHist.filter((h) => h.date >= SINCE);

const HASH = configHash(toStrategyParams(DEFAULT_EVO));
const tracked = [{ configHash: HASH, label: 'inc', evo: DEFAULT_EVO }];

describe('G7 前向管道', () => {
  it('首跑:只立 watermark,不回填历史(回填=冒充前向,禁止)', () => {
    const st = updateForwardLog(ds, null, tracked);
    expect(st.watermark).toBe('2026-05-24'); // 数据最新完赛日
    expect(st.byConfig[HASH]).toBeDefined(); // 首跑即注册追踪
    expect(st.byConfig[HASH].bets).toHaveLength(0); // 但零回填(不冒充前向)
  });

  it('watermark 之后新完赛 → 自动补记虚拟注;summary/evidence 口径一致', () => {
    // 人工把 watermark 拨回赛季末前:模拟"5 月比赛在追踪后才到达"
    const prior: ForwardStore = { watermark: '2026-04-30', byConfig: {} };
    const st = updateForwardLog(ds, prior, tracked);
    expect(st.watermark).toBe('2026-05-24');
    const tr = st.byConfig[HASH];
    expect(tr).toBeDefined();
    expect(tr.bets.length).toBeGreaterThan(0); // 5 月的完赛被记为前向注
    expect(tr.bets.every((b) => b.date.slice(0, 10) > '2026-04-30')).toBe(true);
    expect(tr.bets.every((b) => b.stake > 0)).toBe(true);
    const sum = forwardSummary(st);
    expect(sum).toHaveLength(1);
    expect(sum[0].n).toBe(tr.bets.length);
    expect(sum[0].staked).toBeGreaterThan(0);
    const ev = forwardEvidence(st, HASH);
    expect(ev?.liveBets).toBe(tr.bets.length);
    // 幂等:同数据重跑不重复记
    const again = updateForwardLog(ds, st, tracked);
    expect(again.byConfig[HASH].bets.length).toBe(tr.bets.length);
  });

  it('summary:空 store → 空数组', () => {
    expect(forwardSummary(null)).toEqual([]);
  });
});
