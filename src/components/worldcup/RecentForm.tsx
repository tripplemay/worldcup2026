'use client';

import Card from 'components/card';
import { useLocale } from 'lib/i18n/context';
import type { RecentGame } from 'lib/espn/types';

const RES_CLS: Record<string, string> = {
  W: 'bg-green-500 text-white',
  D: 'bg-gray-400 text-white',
  L: 'bg-red-500 text-white',
  '': 'bg-gray-200 text-gray-500 dark:bg-navy-700',
};

function shortDate(iso: string, locale: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(
      locale === 'zh' ? 'zh-CN' : 'en-US',
      { month: 'numeric', day: 'numeric' },
    );
  } catch {
    return '';
  }
}

function Badge({ r }: { r: string }) {
  return (
    <span
      className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
        RES_CLS[r] ?? RES_CLS['']
      }`}
    >
      {r || '·'}
    </span>
  );
}

function TeamForm({ team, form }: { team: string; form: RecentGame[] }) {
  const { locale, t, tn } = useLocale();
  if (!form.length) return null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="truncate text-xs font-semibold text-brand-500 dark:text-brand-400">
          {tn(team)}
        </span>
        <span className="flex gap-1">
          {form.map((g, i) => (
            <Badge key={i} r={g.result} />
          ))}
        </span>
      </div>
      <div className="space-y-0.5">
        {form.map((g, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400"
          >
            <span className="w-9 tabular-nums">
              {shortDate(g.date, locale)}
            </span>
            <span
              className={`rounded px-1 text-[9px] font-medium ${
                g.home
                  ? 'bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-navy-700 dark:text-gray-400'
              }`}
            >
              {g.home ? t('bg.homeMark') : t('bg.awayMark')}
            </span>
            <span className="flex-1 truncate">{tn(g.opponent)}</span>
            <span className="tabular-nums font-medium text-navy-700 dark:text-white">
              {g.score}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 近期战绩:双方近 5 场 W·D·L + 比分/对手。 */
export default function RecentForm({
  homeTeam,
  awayTeam,
  homeForm,
  awayForm,
}: {
  homeTeam: string;
  awayTeam: string;
  homeForm: RecentGame[];
  awayForm: RecentGame[];
}) {
  const { t } = useLocale();
  if (!homeForm.length && !awayForm.length) return null;
  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('bg.recentForm')}
      </div>
      <div className="space-y-3">
        <TeamForm team={homeTeam} form={homeForm} />
        <TeamForm team={awayTeam} form={awayForm} />
      </div>
    </Card>
  );
}
