'use client';

import { useState } from 'react';
import { MdExpandMore } from 'react-icons/md';
import Card from 'components/card';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale } from 'lib/i18n/context';
import { formatPct, pctWidth } from 'lib/scenario/display';
import type { ThirdRaceRow } from 'lib/scenario/types';

const QUALIFY_LINE = 8; // 8 个最佳第三名出线名额

/** 出线概率分档配色:稳进/生死线/渺茫。 */
function barColor(p: number): string {
  if (p >= 0.85) return 'bg-emerald-500';
  if (p >= 0.35) return 'bg-amber-500';
  return 'bg-gray-300 dark:bg-navy-600';
}

/**
 * 最佳第三名出线竞争:12 组第三名争 8 个出线名额(qualifyProb,分母=全模拟),
 * 第 8/9 名间画「出线线」;展开看出线后按 FIFA Annex C 落到哪个头名槽位(slotProbs,分母=本组出线场次)。
 */
export default function ScenarioThirdRace({ rows }: { rows: ThirdRaceRow[] }) {
  const { t } = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;

  return (
    <Card extra="p-3">
      <p className="mb-2 text-[10px] leading-relaxed text-gray-400">
        {t('scenarios.thirdRaceHint')}
      </p>
      <ul className="divide-y divide-gray-100 dark:divide-white/5">
        {rows.map((r, i) => {
          const isOpen = open === r.group;
          const hasSlots = !!r.slotProbs?.length;
          return (
            <li key={r.group}>
              {i === QUALIFY_LINE && rows.length > QUALIFY_LINE && (
                <div className="my-1 flex items-center gap-2">
                  <span className="h-px flex-1 border-t border-dashed border-amber-400/70" />
                  <span className="shrink-0 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                    {t('scenarios.outLine')}
                  </span>
                  <span className="h-px flex-1 border-t border-dashed border-amber-400/70" />
                </div>
              )}
              <button
                onClick={() => hasSlots && setOpen(isOpen ? null : r.group)}
                aria-expanded={hasSlots ? isOpen : undefined}
                className="flex w-full items-center gap-2 py-2 text-left active:opacity-70"
              >
                <span className="w-5 shrink-0 rounded bg-gray-100 text-center text-[10px] font-semibold text-gray-500 dark:bg-navy-700 dark:text-gray-300">
                  {r.group}
                </span>
                <TeamBadge
                  name={r.name}
                  logo={r.logo}
                  className="min-w-0 flex-1 text-sm text-navy-700 dark:text-white"
                />
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
                  <span
                    className={`block h-full rounded-full ${barColor(
                      r.qualifyProb,
                    )}`}
                    style={{ width: pctWidth(r.qualifyProb) }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-gray-600 dark:text-gray-300">
                  {formatPct(r.qualifyProb)}
                </span>
                <MdExpandMore
                  className={`shrink-0 transition-transform ${
                    hasSlots ? 'text-gray-400' : 'text-transparent'
                  } ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isOpen && hasSlots && (
                <div className="mb-1.5 ml-7 space-y-1 rounded-lg bg-gray-50 p-2 dark:bg-navy-900/60">
                  <div className="text-[9px] text-gray-400">
                    {t('scenarios.slotDenom')}
                  </div>
                  {r.slotProbs!.map((sp) => {
                    const g = sp.slot.slice(1); // '1A' → 'A'
                    return (
                      <div
                        key={sp.slot}
                        className="flex items-center gap-2 text-[10px]"
                      >
                        <span className="w-[5.5rem] shrink-0 text-gray-500 dark:text-gray-400">
                          {t('scenarios.slotMeans')} {g}{' '}
                          {t('scenarios.groupWinner')}
                        </span>
                        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-navy-700">
                          <span
                            className="block h-full rounded-full bg-brand-500"
                            style={{ width: pctWidth(sp.prob) }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">
                          {formatPct(sp.prob)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 text-right text-[9px] text-gray-400">
        {t('scenarios.qualifyDenom')}
      </div>
    </Card>
  );
}
