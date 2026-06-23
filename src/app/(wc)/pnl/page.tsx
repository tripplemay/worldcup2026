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

/**
 * 比赛时间 → 北京时间(UTC+8)。完整时间戳显示 MM/DD HH:mm;
 * 仅日期(YYYY-MM-DD,识别兜底)只显示 MM/DD,不臆造时分。无效/缺失返回空串。
 */
function fmtKickoff(iso?: string): string {
  if (!iso) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }),
  });
}

type T = (k: string) => string;

function statusMeta(t: T, status: BetStatus) {
  switch (status) {
    case 'won':
      return {
        label: t('pnl.stWon'),
        cls: 'bg-green-500/15 text-green-600 dark:text-green-400',
        bar: 'border-green-500',
        Icon: MdCheckCircle,
      };
    case 'lost':
      return {
        label: t('pnl.stLost'),
        cls: 'bg-red-500/15 text-red-500 dark:text-red-400',
        bar: 'border-red-500',
        Icon: MdCancel,
      };
    case 'void':
      return {
        label: t('pnl.stVoid'),
        cls: 'bg-gray-400/15 text-gray-500 dark:text-gray-400',
        bar: 'border-gray-400',
        Icon: MdRemoveCircleOutline,
      };
    case 'unmatched':
    case 'needs_review':
      return {
        label:
          status === 'unmatched' ? t('pnl.stUnmatched') : t('pnl.stReview'),
        cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        bar: 'border-amber-500',
        Icon: MdHelpOutline,
      };
    default:
      return {
        label: t('pnl.stPending'),
        cls: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
        bar: 'border-blue-500',
        Icon: MdSchedule,
      };
  }
}

const SUPPORTED_MARKETS = ['1X2', 'OU', 'AH', 'BTTS', 'DC', 'DNB'];

/** 单腿盘口/选项标签(复用 trade.* / odds.* 文案)。波胆/不支持盘口特殊展示。 */
function legLabel(t: T, leg: BetLeg): string {
  // 波胆(正确比分):全场 / 上半场 / 下半场
  if (leg.market === 'CS') return `${t('pnl.csFull')} ${leg.selection}`;
  if (leg.market === 'CS1H') return `${t('pnl.cs1h')} ${leg.selection}`;
  if (leg.market === 'CS2H') return `${t('pnl.cs2h')} ${leg.selection}`;
  // OTHER / 不支持盘口:显示识别到的中文描述或原文选项
  if (!SUPPORTED_MARKETS.includes(leg.market))
    return leg.rawText || leg.selection || leg.market;
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
  const [editId, setEditId] = useState<string | null>(null); // 展开编辑面板的注单
  const [editPnl, setEditPnl] = useState('');
  const [mgmtOpen, setMgmtOpen] = useState(false); // 顶部管理区折叠(默认收起)
  const [clearConfirm, setClearConfirm] = useState(false); // 清空全部二次确认
  const [delConfirmId, setDelConfirmId] = useState<string | null>(null); // 单删二次确认
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
    // 可盈 = 净盈利:赢 → +可盈;输 → −本金;走盘 → 0
    const pnl =
      status === 'won' ? s.potentialReturn : status === 'lost' ? -s.stake : 0;
    void adminPost({ id: s.id, patch: { status, pnl } });
  };

  // 管理员手填本单实际盈亏(应对各平台串关结算差异);正=赢、负=输、0=走盘
  async function saveManualPnl(s: BetSlip) {
    const v = Number(editPnl);
    if (editPnl.trim() === '' || !Number.isFinite(v)) {
      setMsg(t('pnl.pnlInvalid'));
      return;
    }
    const status: BetStatus = v > 0 ? 'won' : v < 0 ? 'lost' : 'void';
    const okk = await adminPost({ id: s.id, patch: { pnl: v, status } });
    if (okk) setEditId(null);
  }

  /** 删除单张注单 / 清空全部。 */
  async function delBets(query: string) {
    if (busy) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/worldcup/bets?${query}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setMsg(
          res.status === 401 || res.status === 403
            ? t('pnl.viewWrong')
            : t('common.loadFailed'),
        );
        return;
      }
      setMsg(t('pnl.saved'));
      setEditId(null);
      setClearConfirm(false);
      await mutate();
    } catch {
      setMsg(t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }

  // 排行榜:净盈亏降序,平手按注数;无下注者沉底
  const sortedUsers = [...perUser].sort(
    (a, b) => b.pnl - a.pnl || b.bets - a.bets || b.settled - a.settled,
  );
  const totals = perUser.reduce(
    (acc, u) => ({
      net: acc.net + u.pnl,
      staked: acc.staked + u.staked,
      bets: acc.bets + u.bets,
      settled: acc.settled + u.settled,
    }),
    { net: 0, staked: 0, bets: 0, settled: 0 },
  );
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
            {/* 总计 */}
            <Card extra="p-4">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[11px] text-gray-400">
                    {t('pnl.totalNet')}
                  </div>
                  <div
                    className={`font-mono text-2xl font-extrabold ${posCls(
                      totals.net,
                    )}`}
                  >
                    {signMoney(totals.net)}
                  </div>
                </div>
                <div className="text-right text-[11px] text-gray-500 dark:text-gray-400">
                  <div>
                    {t('pnl.players')} {perUser.length} · {t('pnl.bets')}{' '}
                    {totals.bets}
                  </div>
                  <div>
                    {t('pnl.staked')} {money(totals.staked)} ·{' '}
                    {t('pnl.settled')} {totals.settled}
                  </div>
                </div>
              </div>
            </Card>

            {/* 排行(全员,含 0 注)*/}
            {sortedUsers.map((u, i) => {
              const rank = i + 1;
              const medal =
                u.settled > 0 && rank <= 3
                  ? ['🥇', '🥈', '🥉'][rank - 1]
                  : null;
              return (
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
                    <div className="flex items-center gap-3">
                      <div className="w-7 shrink-0 text-center text-lg font-bold text-gray-400">
                        {medal ?? rank}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-navy-700 dark:text-white">
                          {u.bettorId === UNASSIGNED
                            ? t('pnl.unassigned')
                            : u.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                          {u.bets === 0
                            ? t('pnl.noBets')
                            : `${t('pnl.record')} ${u.won}-${u.lost}` +
                              (u.pending
                                ? ` · ${t('pnl.pending')} ${u.pending}`
                                : '') +
                              ` · ${t('pnl.staked')} ${money(u.staked)}`}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`font-mono text-xl font-extrabold ${posCls(
                            u.pnl,
                          )}`}
                        >
                          {u.settled > 0 ? signMoney(u.pnl) : '—'}
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400">
                          {u.settled > 0
                            ? `${t('pnl.roi')} ${
                                u.staked ? pct(u.pnl / u.staked) : '—'
                              }`
                            : `${t('pnl.winRate')} —`}
                        </div>
                      </div>
                    </div>
                  </Card>
                </button>
              );
            })}
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
          {/* 管理区:默认收起,点开加人 / 重结算 / 名册 */}
          <button
            onClick={() => setMgmtOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-xs text-gray-500 shadow-sm active:scale-[0.99] dark:bg-navy-800 dark:text-gray-400"
          >
            <span>⚙️ {t('pnl.manage')}</span>
            <span>{mgmtOpen ? '▴' : '▾'}</span>
          </button>
          {mgmtOpen && (
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
                {/* 危险操作:清空全部注单(二次确认)*/}
                <div className="border-t border-gray-100 pt-2 dark:border-white/5">
                  {clearConfirm ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-red-500 dark:text-red-400">
                        {t('pnl.confirmClear')}
                      </span>
                      <button
                        onClick={() => void delBets('all=1')}
                        disabled={busy}
                        className="rounded-lg bg-red-500 px-3 py-1 text-white active:scale-95 disabled:opacity-50"
                      >
                        {t('pnl.confirm')}
                      </button>
                      <button
                        onClick={() => setClearConfirm(false)}
                        className="rounded-lg bg-gray-200 px-3 py-1 text-gray-600 active:scale-95 dark:bg-navy-700 dark:text-gray-300"
                      >
                        {t('pnl.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setClearConfirm(true)}
                      disabled={busy || slips.length === 0}
                      className="text-red-500 active:scale-95 disabled:opacity-40 dark:text-red-400"
                    >
                      🗑 {t('pnl.clearAll')}({slips.length})
                    </button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* 操作反馈(管理区折叠时也可见)*/}
          {msg && (
            <div className="text-center text-xs text-gray-600 dark:text-gray-300">
              {msg}
            </div>
          )}

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
                <Card key={s.id} extra={`border-l-4 p-4 ${sm.bar}`}>
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
                      const when = fmtKickoff(leg.kickoff ?? leg.matchDate);
                      const tint =
                        leg.result === 'won' || leg.result === 'half_won'
                          ? 'bg-green-500/5'
                          : leg.result === 'lost' || leg.result === 'half_lost'
                          ? 'bg-red-500/5'
                          : '';
                      return (
                        <div
                          key={i}
                          className={`flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs ${tint}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-navy-700 dark:text-gray-200">
                              {leg.homeName} vs {leg.awayName}
                              <span className="ml-1 text-gray-400">
                                · {legLabel(t, leg)}
                                {leg.odds != null ? ` @${leg.odds}` : ''}
                              </span>
                            </div>
                            {when && (
                              <div className="mt-0.5 text-[10px] text-gray-400">
                                🕒 {when}
                              </div>
                            )}
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
                      {money(s.potentialReturn)}
                      {s.status === 'needs_review' || s.confidence < 0.6
                        ? ` · ${t('pnl.conf')} ${Math.round(
                            s.confidence * 100,
                          )}%`
                        : ''}
                    </div>
                    <div
                      className={`font-mono text-xl font-extrabold ${posCls(
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

                  {/* 编辑开关:默认只读,点开才显操作 */}
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => {
                        const open = editId === s.id;
                        setEditId(open ? null : s.id);
                        if (!open)
                          setEditPnl(s.pnl != null ? String(s.pnl) : '');
                      }}
                      className="rounded-lg px-2 py-1 text-xs text-gray-500 active:scale-95 dark:text-gray-400"
                    >
                      {editId === s.id
                        ? `▴ ${t('pnl.collapse')}`
                        : `✏️ ${t('pnl.edit')}`}
                    </button>
                  </div>

                  {/* 编辑面板 */}
                  {editId === s.id && (
                    <div className="mt-1 space-y-2 border-t border-gray-100 pt-2 dark:border-white/5">
                      {/* 归属 + 判定 */}
                      <div className="flex flex-wrap items-center gap-2">
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
                      </div>
                      {/* 实际盈亏(各平台串关规则不同时手填)*/}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] text-gray-400">
                          {t('pnl.editPnl')}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          value={editPnl}
                          onChange={(e) => setEditPnl(e.target.value)}
                          onKeyDown={(e) =>
                            e.key === 'Enter' && saveManualPnl(s)
                          }
                          placeholder={t('pnl.pnlPlaceholder')}
                          className="w-28 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-navy-700 outline-none focus:border-brand-500 dark:border-white/10 dark:bg-navy-900 dark:text-white"
                        />
                        <button
                          onClick={() => void saveManualPnl(s)}
                          disabled={busy || editPnl.trim() === ''}
                          className="rounded-lg bg-brand-500 px-3 py-1 text-xs text-white active:scale-95 disabled:opacity-50"
                        >
                          {t('pnl.save')}
                        </button>
                        <span className="w-full text-[11px] text-gray-400">
                          {t('pnl.pnlHint')}
                        </span>
                      </div>
                      {/* 原图缩略图(点击放大)*/}
                      {s.imageRef && (
                        <a
                          href={`/api/worldcup/bet-image?file=${encodeURIComponent(
                            s.imageRef,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/worldcup/bet-image?file=${encodeURIComponent(
                              s.imageRef,
                            )}`}
                            alt={t('pnl.viewImage')}
                            className="h-16 w-auto rounded-lg border border-gray-200 object-cover dark:border-white/10"
                          />
                        </a>
                      )}
                      {/* 删除此单(二次确认)*/}
                      <div className="flex items-center justify-end border-t border-gray-100 pt-2 dark:border-white/5">
                        {delConfirmId === s.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-red-500 dark:text-red-400">
                              {t('pnl.del')}?
                            </span>
                            <button
                              onClick={() => void delBets(`id=${s.id}`)}
                              disabled={busy}
                              className="rounded-lg bg-red-500 px-3 py-1 text-xs text-white active:scale-95 disabled:opacity-50"
                            >
                              {t('pnl.confirm')}
                            </button>
                            <button
                              onClick={() => setDelConfirmId(null)}
                              className="rounded-lg bg-gray-200 px-3 py-1 text-xs text-gray-600 active:scale-95 dark:bg-navy-700 dark:text-gray-300"
                            >
                              {t('pnl.cancel')}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDelConfirmId(s.id)}
                            disabled={busy}
                            className="text-xs text-red-500 active:scale-95 disabled:opacity-50 dark:text-red-400"
                          >
                            🗑 {t('pnl.del')}
                          </button>
                        )}
                      </div>
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
