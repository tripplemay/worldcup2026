/**
 * 90 分钟比分快照 resolver —— trade 与 bets 两条结算链的统一取分口。
 *
 * 语义:
 *  · 快照已存在 → 直接返回(即使比赛还在加时/点球,90' 口径盘即可结算);
 *  · 无快照:比赛已「过 90'」(post,或进行中 period/状态名/加时事件任一信号)→
 *    拉 summary 重建 90' 比分 → write-once 落盘 → 返回;
 *  · 终场前捕获必须过事件完整性守卫(regulationScoreChecked.complete),不过则
 *    返回 pending —— 宁可退化为「等终场结算」也绝不落错值;
 *  · 终场(post)后按既有口径结算(重建值),complete=false 仅留痕供观测。
 *
 * 并发:进程内 Promise 串行链(同 bets/lock 范式)保护 read-check-write;
 * write-once 使 settleWatcher / 15min cron / 手动触发天然幂等。
 */
import { espnProvider } from 'lib/espn/espn';
import { normalizeTeam } from 'lib/match/normalize';
import {
  loadRegulationScores,
  saveRegulationScores,
  type RegulationScoreSnap,
  type RegulationScoreStore,
} from 'lib/db/store';
import {
  regulationScoreChecked,
  periodScores,
  pastRegulation,
  clockMinutes,
  type RegulationResult,
} from './regulation';
import type { MatchSummary } from 'lib/espn/types';

/** 状态名确认加时/点球/常规结束(过-90 的强信号,不含裸 period)。 */
const ET_STATUS_NAME =
  /EXTRA[_ ]?TIME|OVERTIME|SHOOTOUT|PENALT|END_OF_REGULATION|FULL[_ ]?TIME/i;

/**
 * 终场前即时冻结 90' 比分是否被「强信号」佐证(裸 period 单信号不够 —— 防上游抖动):
 * 已有加时/点球进球事件 / 时钟已过 90' / 状态名确认加时,任一成立即可。
 * 常规时间内(如 70')即便 period 被误报为加时,此处 clock<90 且无加时事件 → 不佐证 → 不冻结。
 */
function liveCorroborated(s: MatchSummary, r: RegulationResult): boolean {
  if (r.hasExtraTime) return true;
  if (clockMinutes(s.clock) >= 90) return true;
  if (s.statusName && ET_STATUS_NAME.test(s.statusName)) return true;
  return false;
}

let chain: Promise<unknown> = Promise.resolve();
function withSnapLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export interface RegulationResolution {
  status: 'matched' | 'pending';
  homeGoals?: number; // ESPN 赛事视角
  awayGoals?: number;
  homeNorm?: string;
  htHome?: number;
  htAway?: number;
}

/** 测试注入口(store/网络/时钟可换)。 */
export interface SnapshotDeps {
  load?: () => RegulationScoreStore;
  save?: (s: RegulationScoreStore) => void;
  fetchSummary?: (eventId: string) => Promise<MatchSummary | null>;
  now?: () => number;
}

const fromSnap = (s: RegulationScoreSnap): RegulationResolution => ({
  status: 'matched',
  homeGoals: s.homeGoals,
  awayGoals: s.awayGoals,
  homeNorm: s.homeTeamNorm,
  ...(s.htHome != null && s.htAway != null
    ? { htHome: s.htHome, htAway: s.htAway }
    : {}),
});

/**
 * 取一场比赛的 90' 比分(快照优先;可注入已拉好的 summary 省一次网络)。
 * 网络/解析失败一律 pending(由 45s 守望者与 15min cron 天然重试)。
 */
export async function resolveRegulationScore(
  eventId: string,
  preFetched?: MatchSummary | null,
  deps?: SnapshotDeps,
): Promise<RegulationResolution> {
  const load = deps?.load ?? loadRegulationScores;
  const save = deps?.save ?? saveRegulationScores;
  const now = deps?.now ?? Date.now;
  const hit = load()[eventId];
  if (hit) return fromSnap(hit);

  let s: MatchSummary | null = null;
  try {
    s =
      preFetched ??
      (await (
        deps?.fetchSummary ?? ((id: string) => espnProvider.getMatchSummary(id))
      )(eventId));
  } catch (e) {
    // 结算主链:ESPN 拉取失败要留痕(否则运维无法区分「未过90」与「ESPN 持续报错」)
    console.error(
      '[regulation] summary 拉取失败,本轮 pending 重试',
      eventId,
      e,
    );
    s = null;
  }
  if (!s || s.homeScore == null || s.awayScore == null)
    return { status: 'pending' };
  if (!pastRegulation(s, s.events)) return { status: 'pending' };

  const r = regulationScoreChecked(
    s.events,
    s.homeTeam,
    s.awayTeam,
    s.homeScore,
    s.awayScore,
  );
  const isPost = s.status === 'post';
  // 终场前即时捕获的两道守卫(缺一即退回等终场,绝不错结):
  //  ①事件必须完整对齐终分 —— ESPN header 比分常先于 keyEvents 更新,加时首球期间
  //    会出现「终分含加时球、事件未含」→ !eventsAccountForFinal → 拒绝冻结;
  //  ②过-90 需强信号佐证(加时事件/时钟≥90/状态名),防裸 period 抖动把中场比分冻成 90'。
  if (!isPost) {
    if (!r.eventsAccountForFinal) return { status: 'pending' };
    if (!liveCorroborated(s, r)) return { status: 'pending' };
  } else if (r.hasExtraTime && !r.eventsAccountForFinal) {
    // 终场后加时重建账不齐 → 事件缺漏,90' 重建不可信 → 推迟等补全(通常几分钟内)
    console.error('[regulation] 终场加时事件账不齐,推迟结算等补全', eventId);
    return { status: 'pending' };
  }

  // 半场比分:事件能完整还原 90' 总分才采信(否则半场波胆留人工)
  const ps = periodScores(s.events, s.homeTeam, s.awayTeam);
  const htOk = ps.ev90.h === r.home && ps.ev90.a === r.away;
  const snap: RegulationScoreSnap = {
    capturedAt: now(),
    homeGoals: r.home,
    awayGoals: r.away,
    homeTeamNorm: normalizeTeam(s.homeTeam),
    awayTeamNorm: normalizeTeam(s.awayTeam),
    ...(htOk ? { htHome: ps.ht.h, htAway: ps.ht.a } : {}),
    source: isPost ? 'post' : 'live',
    complete: r.eventsAccountForFinal,
  };
  const finalSnap = await withSnapLock(() => {
    const st = load();
    if (st[eventId]) return st[eventId]; // write-once:并发首写者胜
    save({ ...st, [eventId]: snap });
    return snap;
  });
  return fromSnap(finalSnap);
}
