'use client';

import { useEffect, useMemo, useState } from 'react';
import { MdAutoGraph, MdRefresh } from 'react-icons/md';
import Card from 'components/card';
import Checkbox from 'components/checkbox';
import TeamBadge from 'components/worldcup/TeamBadge';
import { generateDryRunSlips, usePredictions } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import type { DryRunResponse } from 'lib/trade/dryRun';

const TOKEN_KEY = 'wc_admin_token';
const MAX_SELECTED = 8;
const DAYS = 14;
const WINDOW_MIN = DAYS * 24 * 60;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** 赛前预生成:用户手选比赛 → 只读 dry-run → 返回本机草稿单。 */
export default function PaperDryRunGenerator({
  onGenerated,
}: {
  onGenerated: (result: DryRunResponse) => void;
}) {
  const { t, tn } = useLocale();
  const { matches, isLoading } = usePredictions(DAYS);
  const upcoming = useMemo(
    () => matches.filter((m) => m.status === 'pre').slice(0, 12),
    [matches],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (saved) setToken(saved);
    } catch {
      /* localStorage 不可用时忽略 */
    }
  }, []);

  useEffect(() => {
    if (bootstrapped || !upcoming.length) return;
    setSelected(new Set(upcoming.slice(0, 3).map((m) => m.matchId)));
    setBootstrapped(true);
  }, [bootstrapped, upcoming]);

  const selectedIds = [...selected];
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  };

  async function generate() {
    const tok = token.trim();
    if (!tok || !selectedIds.length || busy) return;
    setBusy(true);
    setMsg('');
    try {
      const result = await generateDryRunSlips(
        { matchIds: selectedIds, days: DAYS, windowMin: WINDOW_MIN },
        tok,
      );
      try {
        localStorage.setItem(TOKEN_KEY, tok);
      } catch {
        /* ignore */
      }
      onGenerated(result);
      setMsg(
        `${t('trade.dryRunGenerated')} ${result.summary.generated} · ${t(
          'trade.dryRunSkipped',
        )} ${result.summary.skipped}`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('trade.dryRunFailed'));
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-navy-700 outline-none focus:border-brand-500 dark:border-white/10 dark:bg-navy-900 dark:text-white';
  const btnCls =
    'inline-flex items-center justify-center gap-1 rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white active:scale-95 disabled:opacity-50';

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1 font-bold text-navy-700 dark:text-white">
            <MdAutoGraph className="text-brand-500 dark:text-brand-400" />
            {t('trade.dryRunTitle')}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {t('trade.dryRunDesc')}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
          {t('trade.dryRunLocalOnly')}
        </span>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_auto] gap-2">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && generate()}
          placeholder={t('trade.dryRunToken')}
          className={inputCls}
        />
        <button
          onClick={generate}
          disabled={busy || !token.trim() || !selectedIds.length}
          className={btnCls}
        >
          <MdRefresh className={busy ? 'animate-spin' : ''} />
          {busy ? t('trade.dryRunGenerating') : t('trade.dryRunGenerate')}
        </button>
      </div>

      <div className="mb-2 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
        <span>
          {t('trade.dryRunSelected')} {selected.size}/{MAX_SELECTED}
        </span>
        <span>{t('trade.dryRunMax')}</span>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl bg-lightPrimary dark:bg-navy-700"
            />
          ))}
        </div>
      )}

      {!isLoading && !upcoming.length && (
        <div className="rounded-xl bg-lightPrimary px-3 py-4 text-center text-xs text-gray-400 dark:bg-navy-900">
          {t('trade.dryRunEmpty')}
        </div>
      )}

      {!isLoading && upcoming.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {upcoming.map((m) => {
            const checked = selected.has(m.matchId);
            const disabled = !checked && selected.size >= MAX_SELECTED;
            return (
              <div
                key={m.matchId}
                role="button"
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && toggle(m.matchId)}
                onKeyDown={(e) => {
                  if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    toggle(m.matchId);
                  }
                }}
                className={`flex w-full items-center gap-2 rounded-xl border p-2 text-left transition ${
                  checked
                    ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-500/10'
                    : 'border-gray-100 bg-lightPrimary dark:border-white/5 dark:bg-navy-900'
                } ${disabled ? 'opacity-50' : 'cursor-pointer active:scale-[0.99]'}`}
              >
                <Checkbox checked={checked} readOnly color="blue" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
                    <span>{fmt(m.commenceTime)}</span>
                    <span>{t('trade.dryRunNotPersisted')}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-[1fr_auto_1fr] items-center gap-1 text-xs font-semibold text-navy-700 dark:text-white">
                    <TeamBadge name={m.homeTeam} logo={m.homeLogo} />
                    <span className="text-[10px] text-gray-400">vs</span>
                    <TeamBadge
                      name={m.awayTeam}
                      logo={m.awayLogo}
                      reverse
                      className="justify-end"
                    />
                  </div>
                  <div className="mt-1 truncate text-[10px] text-gray-400">
                    {tn(m.homeTeam)} · {tn(m.awayTeam)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-300">
          {msg}
        </div>
      )}
    </Card>
  );
}
