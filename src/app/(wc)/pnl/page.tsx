'use client';

/**
 * 盈亏台(Phase 9):他平台投注单识别 + 自动结算后的每人盈亏展示与管理改账。
 *  · 总览:各投注人净盈亏排行。
 *  · 明细:逐单(串关各腿、状态、盈亏);管理员解锁后可改归属/手动判定/重新结算。
 */
import { useEffect, useState } from 'react';
import {
  MdSavings,
  MdCheckCircle,
  MdCancel,
  MdRemoveCircleOutline,
  MdHelpOutline,
  MdSchedule,
  MdImage,
  MdRefresh,
  MdLock,
} from 'react-icons/md';
import Card from 'components/card';
import PageHeading from 'components/worldcup/PageHeading';
import { usePnl } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { BetSlip, BetLeg, BetStatus, Bettor } from 'lib/bets/types';

const money = (x: number) => Math.round(x).toLocaleString();
const signMoney = (x: number) => `${x >= 0 ? '+' : '−'}${money(Math.abs(x))}`;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const posCls = (x: number) =>
  x > 0
    ? 'text-green-600 dark:text-green-400'
    : x < 0
    ? 'text-red-500 dark:text-red-400'
    : 'text-gray-400';

const UNASSIGNED = '__unassigned__';

type T = (k: string) => string;

function statusMeta(t: T, status: BetStatus) {
  switch (status) {
    case 'won':
      return {
        label: t('pnl.stWon'),
        cls: 'bg-green-500/15 text-green-600 dark:text-green-400',
        Icon: MdCheckCircle,
      };
    case 'lost':
      return {
        label: t('pnl.stLost'),
        cls: 'bg-red-500/15 text-red-500 dark:text-red-400',
        Icon: MdCancel,
      };
    case 'void':
      return {
        label: t('pnl.stVoid'),
        cls: 'bg-gray-400/15 text-gray-500 dark:text-gray-400',
        Icon: MdRemoveCircleOutline,
      };
    case 'unmatched':
    case 'needs_review':
      return {
        label:
          status === 'unmatched' ? t('pnl.stUnmatched') : t('pnl.stReview'),
        cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        Icon: MdHelpOutline,
      };
    default:
      return {
        label: t('pnl.stPending'),
        cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
        Icon: MdSchedule,
      };
  }
}

/** 单腿盘口/选项标签(复用 trade.* / odds.* 文案)。 */
function legLabel(t: T, leg: BetLeg): string {
  const sel = leg.selection;
  if (leg.market === '1X2')
    return sel === 'home'
      ? t('trade.selHome')
      : sel === 'draw'
      ? t('trade.selDraw')
      : t('trade.selAway');
  if (leg.market === 'OU')
    return `${sel === 'Over' ? t('trade.over') : t('trade.under')} ${
      leg.line ?? ''
    }`;
  if (leg.market === 'BTTS')
    return `${t('trade.btts')} ${
      sel === 'Yes' ? t('trade.yes') : t('trade.no')
    }`;
  if (leg.market === 'DC') return `${t('trade.dc')} ${sel}`;
  if (leg.market === 'DNB')
    return `${t('trade.dnb')} ${
      sel === 'home' ? t('odds.home') : t('odds.away')
    }`;
  const side = sel === 'home' ? t('trade.ahHome') : t('trade.ahAway');
  const p = leg.line ?? 0;
  return `${side} ${p > 0 ? '+' : ''}${p}`;
}

/** 单腿结果小标(颜色 + 字符)。 */
function legResultMark(result?: string): { ch: string; cls: string } {
  switch (result) {
    case 'won':
      return { ch: '✓', cls: 'text-green-600 dark:text-green-400' };
    case 'lost':
      return { ch: '✕', cls: 'text-red-500 dark:text-red-400' };
    case 'void':
      return { ch: '∅', cls: 'text-gray-400' };
    case 'half_won':
      return { ch: '½✓', cls: 'text-green-600 dark:text-green-400' };
    case 'half_lost':
      return { ch: '½✕', cls: 'text-red-500 dark:text-red-400' };
    case 'unmatched':
      return { ch: '?', cls: 'text-amber-600 dark:text-amber-400' };
    default:
      return { ch: '·', cls: 'text-gray-400' };
  }
}

function bettorName(t: T, bettors: Bettor[], id: string | null): string {
  if (!id) return t('pnl.unassigned');
  return bettors.find((b) => b.id === id)?.name ?? t('pnl.unassigned');
}

export default function PnlPage() {
  const { t } = useLocale();
  const [authed, setAuthed] = useState<boolean | null>(null); // null=校验中
  const { bettors, slips, perUser, isLoading, error, mutate } = usePnl(
    authed === true,
  );
  const [view, setView] = useState<'overview' | 'detail'>('overview');
  const [filter, setFilter] = useState<string>('all'); // bettorId | UNASSIGNED | 'all'
  const [newBettor, setNewBettor] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewPw, setViewPw] = useState('');
  const [viewMsg, setViewMsg] = useState('');
  const [viewBusy, setViewBusy] = useState(false);

  useEffect(() => {
    // 记住过(localStorage)→ 直接进,避免每次重输;cookie 仍负责数据鉴权。
    const remembered = localStorage.getItem('pnl_view_ok') === '1';
    if (remembered) setAuthed(true);
    // 后台探测纠正:200=放行并记住;401=确已失效才退回密码页;网络错误不误踢。
    fetch('/api/worldcup/pnl', { cache: 'no-store' })
      .then((r) => {
        if (r.ok) {
          localStorage.setItem('pnl_view_ok', '1');
          setAuthed(true);
        } else if (r.status === 401) {
          localStorage.removeItem('pnl_view_ok');
          setAuthed(false);
        }
      })
      .catch(() => {
        if (!remembered) setAuthed(false);
      });
  }, []);

  async function viewEnter() {
    const pw = viewPw.trim();
    if (!pw || viewBusy) return;
    setViewBusy(true);
    setViewMsg('');
    try {
      const res = await fetch('/api/worldcup/pnl-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        setViewPw('');
        localStorage.setItem('pnl_view_ok', '1');
        setAuthed(true);
      } else {
        setViewMsg(t('pnl.viewWrong'));
      }
    } catch {
      setViewMsg(t('common.loadFailed'));
    } finally {
      setViewBusy(false);
    }
  }

  // 已过浏览密码即可管理(写接口按浏览 cookie 鉴权,无需再输管理口令)
  const admin = true;

  async function adminPost(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/worldcup/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) {
        setMsg(t('pnl.viewWrong'));
        return false;
      }
      if (!res.ok) {
        setMsg(t('common.loadFailed'));
        return false;
      }
      setMsg(t('pnl.saved'));
      await mutate();
      return true;
    } catch {
      setMsg(t('common.loadFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addBettorByName() {
    const name = newBettor.trim();
    if (!name || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/worldcup/bettors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.status === 401 || res.status === 403) {
        setMsg(t('pnl.viewWrong'));
        return;
      }
      if (!res.ok) {
        setMsg(t('common.loadFailed'));
        return;
      }
      setNewBettor('');
      setMsg(t('pnl.saved'));
      await mutate();
    } catch {
      setMsg(t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function removeBettorById(id: string) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(
        `/api/worldcup/bettors?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setMsg(
          res.status === 401 || res.status === 403
            ? t('pnl.viewWrong')
            : t('common.loadFailed'),
        );
        return;
      }
      setMsg(t('pnl.saved'));
      await mutate();
    } catch {
      setMsg(t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  const setOutcome = (s: BetSlip, status: BetStatus) => {
    const pnl =
      status === 'won'
        ? +(s.potentialReturn - s.stake)
        : status === 'lost'
        ? -s.stake
        : 0;
    void adminPost({ id: s.id, patch: { status, pnl } });
  };

  const sortedUsers = [...perUser].sort((a, b) => b.pnl - a.pnl);
  const visibleSlips = slips
    .filter((s) => {
      if (filter === 'all') return true;
      if (filter === UNASSIGNED) return !s.bettorId;
      return s.bettorId === filter;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const pillCls = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium ${
      on
        ? 'bg-brand-500 text-white'
        : 'bg-white text-gray-500 dark:bg-navy-800 dark:text-gray-400'
    }`;

  // 浏览密码门禁:未通过(或校验中)只渲染密码页,数据接口同样按 cookie 鉴权(双重保险)
  if (authed !== true) {
    return (
      <div>
        <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
          <PageHeading Icon={MdSavings}>{t('pnl.title')}</PageHeading>
        </header>
        <Card extra="mt-6 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-navy-700 dark:text-white">
            <MdLock className="text-brand-500 dark:text-brand-400" />
            {t('pnl.viewPrompt')}
          </div>
          {authed === null ? (
            <div className="h-10 animate-pulse rounded-lg bg-lightPrimary dark:bg-navy-900" />
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={viewPw}
                  onChange={(e) => setViewPw(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && viewEnter()}
                  placeholder={t('pnl.viewPlaceholder')}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-navy-700 outline-none focus:border-brand-500 dark:border-white/10 dark:bg-navy-900 dark:text-white"
                />
                <button
                  onClick={viewEnter}
                  disabled={viewBusy || !viewPw.trim()}
                  className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm text-white active:scale-95 disabled:opacity-50"
                >
                  {t('pnl.enter')}
                </button>
              </div>
              {viewMsg && (
                <div className="mt-2 text-xs text-red-500 dark:text-red-400">
                  {viewMsg}
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div>
      <header className="sticky top-0 z-30 -mx-4 mb-3 bg-lightPrimary/95 px-4 py-3 backdrop-blur dark:bg-navy-900/95">
        <div className="flex items-center justify-between gap-2 pr-24">
          <PageHeading Icon={MdSavings}>{t('pnl.title')}</PageHeading>
          <button
            onClick={() => void mutate()}
            className="shrink-0 rounded-full bg-gray-200/70 p-1.5 text-gray-600 active:scale-95 dark:bg-navy-700 dark:text-gray-300"
            aria-label={t('pnl.refresh')}
          >
            <MdRefresh className="text-base" />
          </button>
        </div>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
          {t('pnl.subtitle')}
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => setView('overview')}
            className={pillCls(view === 'overview')}
          >
            {t('pnl.overview')}
          </button>
          <button
            onClick={() => setView('detail')}
            className={pillCls(view === 'detail')}
          >
            {t('pnl.detail')}
          </button>
        </div>
      </header>

      {view === 'overview' ? (
        sortedUsers.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            {isLoading ? '…' : t('pnl.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedUsers.map((u) => (
              <button
                key={u.bettorId}
                onClick={() => {
                  setFilter(
                    u.bettorId === UNASSIGNED ? UNASSIGNED : u.bettorId,
                  );
                  setView('detail');
                }}
                className="block w-full text-left"
              >
                <Card extra="p-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className="text-sm font-semibold text-navy-700 dark:text-white">
                        {u.bettorId === UNASSIGNED
                          ? t('pnl.unassigned')
                          : u.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                        {t('pnl.bets')} {u.bets} · {t('pnl.settled')}{' '}
                        {u.settled} · {t('pnl.pending')} {u.pending}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-mono text-2xl font-extrabold ${posCls(
                          u.pnl,
                        )}`}
                      >
                        {signMoney(u.pnl)}
                      </div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t('pnl.staked')} {money(u.staked)} · {t('pnl.winRate')}{' '}
                        {u.settled ? pct(u.won / u.settled) : '—'}
                      </div>
                    </div>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-3">
          {/* 管理区(已过浏览密码即可操作)—— 始终显示,不被空/错误态遮挡 */}
          {error && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs text-amber-600 dark:text-amber-400">
              {t('common.loadFailed')}
            </div>
          )}
          <Card extra="p-3">
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-500 dark:text-gray-400">
                  {t('pnl.admin')}
                </span>
                <button
                  onClick={() => void adminPost({ action: 'resettle' })}
                  disabled={busy}
                  className="rounded-lg bg-brand-500 px-2.5 py-1 text-white active:scale-95 disabled:opacity-50"
                >
                  {t('pnl.resettle')}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBettor}
                  onChange={(e) => setNewBettor(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBettorByName()}
                  placeholder={t('pnl.bettorNamePh')}
                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-navy-700 outline-none focus:border-brand-500 dark:border-white/10 dark:bg-navy-900 dark:text-white"
                />
                <button
                  onClick={addBettorByName}
                  disabled={busy || !newBettor.trim()}
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-white active:scale-95 disabled:opacity-50"
                >
                  {t('pnl.addBettor')}
                </button>
              </div>
              {bettors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {bettors.map((b) => (
                    <span
                      key={b.id}
                      className="flex items-center gap-1 rounded-full bg-lightPrimary px-2 py-0.5 text-[11px] text-navy-700 dark:bg-navy-700 dark:text-gray-200"
                    >
                      {b.name}
                      <button
                        onClick={() => removeBettorById(b.id)}
                        disabled={busy}
                        aria-label="remove"
                        className="text-gray-400 active:scale-90 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {msg && (
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                {msg}
              </div>
            )}
          </Card>

          {/* 投注人筛选 */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={pillCls(filter === 'all')}
            >
              {t('pnl.all')}
            </button>
            {bettors.map((b) => (
              <button
                key={b.id}
                onClick={() => setFilter(b.id)}
                className={pillCls(filter === b.id)}
              >
                {b.name}
              </button>
            ))}
            <button
              onClick={() => setFilter(UNASSIGNED)}
              className={pillCls(filter === UNASSIGNED)}
            >
              {t('pnl.unassigned')}
            </button>
          </div>

          {/* 注单列表:加载/空 内联,不遮挡上方管理区 */}
          {isLoading && slips.length === 0 ? (
            <div className="h-16 animate-pulse rounded-[20px] bg-white dark:bg-navy-800" />
          ) : visibleSlips.length === 0 ? (
            <div className="py-10 text-center text-gray-400">
              {t('pnl.empty')}
            </div>
          ) : (
            visibleSlips.map((s) => {
              const sm = statusMeta(t, s.status);
              return (
                <Card key={s.id} extra="p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sm.cls}`}
                      >
                        <sm.Icon className="mr-0.5 inline align-[-2px] text-sm" />
                        {sm.label}
                      </span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {s.legs.length > 1
                          ? `${t('pnl.parlay')}×${s.legs.length}`
                          : t('pnl.single')}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-navy-700 dark:text-white">
                      {bettorName(t, bettors, s.bettorId)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {s.legs.map((leg, i) => {
                      const mk = legResultMark(leg.result);
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0 flex-1 truncate text-navy-700 dark:text-gray-200">
                            {leg.homeName} vs {leg.awayName}
                            <span className="ml-1 text-gray-400">
                              · {legLabel(t, leg)}
                              {leg.odds != null ? ` @${leg.odds}` : ''}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {leg.homeGoals != null && leg.awayGoals != null && (
                              <span className="font-mono text-gray-500 dark:text-gray-400">
                                {leg.homeGoals}-{leg.awayGoals}
                              </span>
                            )}
                            <span className={`font-bold ${mk.cls}`}>
                              {mk.ch}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 flex items-end justify-between border-t border-gray-100 pt-2 dark:border-white/5">
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t('pnl.staked')} {s.currency ? `${s.currency} ` : ''}
                      {money(s.stake)} · {t('pnl.payout')}{' '}
                      {money(s.potentialReturn)} · {t('pnl.conf')}{' '}
                      {Math.round(s.confidence * 100)}%
                    </div>
                    <div
                      className={`font-mono text-base font-bold ${posCls(
                        s.pnl ?? 0,
                      )}`}
                    >
                      {s.pnl != null ? signMoney(s.pnl) : '—'}
                    </div>
                  </div>

                  {s.note && (
                    <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                      {s.note}
                    </div>
                  )}

                  {admin && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 dark:border-white/5">
                      <select
                        value={s.bettorId ?? ''}
                        onChange={(e) => {
                          if (!e.target.value) return;
                          void adminPost({
                            id: s.id,
                            action: 'assign',
                            bettorId: e.target.value,
                          });
                        }}
                        disabled={busy}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-navy-700 dark:border-white/10 dark:bg-navy-900 dark:text-white"
                      >
                        <option value="">{t('pnl.reassign')}…</option>
                        {bettors.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setOutcome(s, 'won')}
                        disabled={busy}
                        className="rounded-lg bg-green-500/15 px-2 py-1 text-xs text-green-700 active:scale-95 disabled:opacity-50 dark:text-green-400"
                      >
                        {t('pnl.setWon')}
                      </button>
                      <button
                        onClick={() => setOutcome(s, 'lost')}
                        disabled={busy}
                        className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-600 active:scale-95 disabled:opacity-50 dark:text-red-400"
                      >
                        {t('pnl.setLost')}
                      </button>
                      <button
                        onClick={() => setOutcome(s, 'void')}
                        disabled={busy}
                        className="rounded-lg bg-gray-200 px-2 py-1 text-xs text-gray-600 active:scale-95 disabled:opacity-50 dark:bg-navy-700 dark:text-gray-300"
                      >
                        {t('pnl.setVoid')}
                      </button>
                      {s.imageRef && (
                        <a
                          href={`/api/worldcup/bet-image?file=${encodeURIComponent(
                            s.imageRef,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto flex items-center gap-0.5 text-xs text-brand-500 dark:text-brand-400"
                        >
                          <MdImage className="text-sm" />
                          {t('pnl.viewImage')}
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
