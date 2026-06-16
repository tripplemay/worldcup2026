'use client';

import { useState } from 'react';
import { useT } from 'lib/i18n/context';
import { useLiveMatchMarkets } from 'lib/hooks/useWorldCup';
import type { LiveMarket, LiveOddsRow } from 'lib/odds/types';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');

/** 价格字段 → 短标签(主/平/客/大/小/是/否;odds 无标签)。 */
function useSub() {
  const t = useT();
  return (k: string): string => {
    switch (k) {
      case 'home':
        return t('odds.home');
      case 'draw':
        return t('odds.draw');
      case 'away':
        return t('odds.away');
      case 'over':
        return t('liveMkt.over');
      case 'under':
        return t('liveMkt.under');
      case 'yes':
        return t('liveMkt.yes');
      case 'no':
        return t('liveMkt.no');
      default:
        return '';
    }
  };
}

const PRICE_KEYS = [
  'home',
  'draw',
  'away',
  'over',
  'under',
  'yes',
  'no',
  'odds',
] as const;

function priceCells(r: LiveOddsRow): { k: string; v: number }[] {
  const out: { k: string; v: number }[] = [];
  for (const k of PRICE_KEYS) {
    const v = r[k];
    if (v != null) out.push({ k, v });
  }
  return out;
}

/** 通用单行:左=标签/盘口线,右=各价格(带短标签;带 label 的单价不显短标签)。 */
function Row({ r }: { r: LiveOddsRow }) {
  const sub = useSub();
  const cells = priceCells(r);
  const line =
    r.hdp != null ? (r.hdp > 0 ? `+${r.hdp}` : `${r.hdp}`) : '';
  const labeledSingle = !!r.label && cells.length === 1;
  const left = r.label
    ? r.hdp != null && !r.label.includes(String(r.hdp))
      ? `${r.label} (${line})`
      : r.label
    : line;
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="min-w-0 truncate text-gray-500 dark:text-gray-400">
        {left || ' '}
      </span>
      <div className="flex shrink-0 flex-wrap justify-end gap-x-3 gap-y-0.5">
        {cells.map((c, i) => (
          <span key={i} className="tabular-nums">
            {!labeledSingle && sub(c.k) && (
              <span className="mr-0.5 text-[10px] text-gray-400">
                {sub(c.k)}
              </span>
            )}
            <span className="font-semibold text-navy-700 dark:text-white">
              {fmt(c.v)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** 单个市场块:行数多时默认折叠(点击展开),避免一次渲染上百行。 */
function MarketBlock({ m }: { m: LiveMarket }) {
  const [open, setOpen] = useState(m.rows.length <= 8);
  return (
    <div className="border-t border-gray-50 py-2 text-xs dark:border-white/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="font-medium text-navy-700 dark:text-white">
          {m.name}
        </span>
        <span className="ml-2 shrink-0 text-[10px] text-gray-400">
          {m.rows.length} {open ? '⌃' : '⌄'}
        </span>
      </button>
      {open && (
        <div className="mt-1">
          {m.rows.map((r, i) => (
            <Row key={i} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 单场全部市场:按标签分组的标签页 + 各市场块(数据按需取,0 额外配额)。 */
export default function LiveMarketsPanel({ matchId }: { matchId: string }) {
  const t = useT();
  const { markets, isLoading } = useLiveMatchMarkets(matchId);
  const [tab, setTab] = useState<string>('');

  if (isLoading && !markets) {
    return (
      <div className="py-4 text-center text-xs text-gray-400">
        {t('common.loading')}
      </div>
    );
  }
  const groups = markets?.groups ?? [];
  if (!groups.length) {
    return (
      <div className="py-4 text-center text-xs text-gray-400">
        {t('odds.noLive')}
      </div>
    );
  }
  const active = groups.find((g) => g.key === tab) ?? groups[0];

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1">
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() => setTab(g.key)}
            className={`rounded-md px-2 py-0.5 text-[11px] ${
              active.key === g.key
                ? 'bg-brand-500 text-white'
                : 'bg-lightPrimary text-gray-600 dark:bg-navy-700 dark:text-gray-300'
            }`}
          >
            {t(`oddsGroup.${g.key}`)}
          </button>
        ))}
      </div>
      <div className="mt-1">
        {active.markets.map((m) => (
          <MarketBlock key={m.name} m={m} />
        ))}
      </div>
    </div>
  );
}
