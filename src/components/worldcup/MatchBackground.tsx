'use client';

import type { IconType } from 'react-icons';
import {
  MdStadium,
  MdLocationOn,
  MdGroups,
  MdWbSunny,
  MdCloudQueue,
  MdCloud,
  MdFilterDrama,
  MdWaterDrop,
  MdAcUnit,
  MdThunderstorm,
} from 'react-icons/md';
import Card from 'components/card';
import { useStandings, useWinnerOdds, useWeather } from 'lib/hooks/useWorldCup';
import { useLocale } from 'lib/i18n/context';
import { getFifaRank } from 'lib/data/fifaRanking';
import { findVenue } from 'lib/data/venues';
import { weatherCondition } from 'lib/weather/openmeteo';
import { normalizeTeam } from 'lib/match/normalize';
import type { MatchSummary } from 'lib/espn/types';

// 国旗保留 emoji(Material 无国旗)
const COUNTRY_FLAG: Record<string, string> = {
  USA: '🇺🇸',
  Mexico: '🇲🇽',
  Canada: '🇨🇦',
};

/** 天气状况 → Material 图标。 */
const WEATHER_ICON: Record<string, IconType> = {
  clear: MdWbSunny,
  partlyCloudy: MdCloudQueue,
  cloudy: MdCloud,
  fog: MdFilterDrama,
  rain: MdWaterDrop,
  snow: MdAcUnit,
  thunder: MdThunderstorm,
};

/** 在积分榜里找某队的小组 + 排名。 */
function groupPos(
  groups: ReturnType<typeof useStandings>['groups'],
  team: string,
): { group: string; rank: number } | undefined {
  const key = normalizeTeam(team);
  for (const g of groups) {
    const row = g.rows.find((r) => normalizeTeam(r.team) === key);
    if (row) return { group: g.group, rank: row.rank };
  }
  return undefined;
}

function titleOdds(
  outrights: { team: string; price: number }[],
  team: string,
): number | undefined {
  const key = normalizeTeam(team);
  return outrights.find((o) => normalizeTeam(o.team) === key)?.price;
}

function MetaCol({
  team,
  rank,
  pos,
  odds,
}: {
  team: string;
  rank?: number;
  pos?: { group: string; rank: number };
  odds?: number;
}) {
  const { t, tn } = useLocale();
  const Line = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium tabular-nums text-navy-700 dark:text-white">
        {value}
      </span>
    </div>
  );
  return (
    <div className="flex-1 space-y-1 text-xs">
      <div className="mb-1 truncate font-semibold text-brand-500 dark:text-brand-400">
        {tn(team)}
      </div>
      <Line label={t('bg.fifaRank')} value={rank ? `#${rank}` : '—'} />
      <Line
        label={t('bg.groupPos')}
        value={pos ? `${pos.group} · ${pos.rank}` : '—'}
      />
      <Line label={t('bg.titleOdds')} value={odds ? odds.toFixed(1) : '—'} />
    </div>
  );
}

/** 球队对比:FIFA排名 / 小组排名 / 夺冠赔率。 */
export function MatchTeamMeta({ summary }: { summary: MatchSummary }) {
  const { t } = useLocale();
  const { groups } = useStandings();
  const { winner } = useWinnerOdds();
  const outrights = winner?.outrights ?? [];

  return (
    <Card extra="mb-3 p-4">
      <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
        {t('bg.teamMeta')}
      </div>
      <div className="flex gap-4">
        <MetaCol
          team={summary.homeTeam}
          rank={getFifaRank(summary.homeTeam)}
          pos={groupPos(groups, summary.homeTeam)}
          odds={titleOdds(outrights, summary.homeTeam)}
        />
        <div className="w-px bg-gray-100 dark:bg-white/10" />
        <MetaCol
          team={summary.awayTeam}
          rank={getFifaRank(summary.awayTeam)}
          pos={groupPos(groups, summary.awayTeam)}
          odds={titleOdds(outrights, summary.awayTeam)}
        />
      </div>
    </Card>
  );
}

/** 场馆 · 天气:球场 / 城市+承办国 / 容量 / 当日天气。 */
export function MatchVenueWeather({ summary }: { summary: MatchSummary }) {
  const { locale, t } = useLocale();
  const { weather } = useWeather(
    summary.venue,
    summary.city,
    summary.commenceTime,
  );
  const venue = findVenue(summary.venue, summary.city);

  return (
    <>
      <Card extra="mb-3 p-4">
        <div className="mb-2 text-sm font-bold text-navy-700 dark:text-white">
          {t('bg.venueWeather')}
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <MdStadium className="shrink-0 text-gray-400" />
            <span className="flex-1 text-right font-medium text-navy-700 dark:text-white">
              {summary.venue ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <MdLocationOn className="shrink-0 text-gray-400" />
            <span className="flex-1 text-right text-navy-700 dark:text-white">
              {summary.city ?? venue?.city ?? '—'}
              {venue && (
                <>
                  {' '}
                  {COUNTRY_FLAG[venue.country]} {t(`country.${venue.country}`)}
                </>
              )}
            </span>
          </div>
          {venue && (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-gray-400">
                <MdGroups /> {t('bg.capacity')}
              </span>
              <span className="font-medium tabular-nums text-navy-700 dark:text-white">
                {venue.capacity.toLocaleString()}
              </span>
            </div>
          )}
          {weather &&
            (() => {
              const WIcon =
                WEATHER_ICON[weatherCondition(weather.code)] ?? MdCloud;
              return (
                <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-1.5 dark:border-white/5">
                  <span className="flex items-center gap-1 text-gray-400">
                    <WIcon /> {t(`weather.${weatherCondition(weather.code)}`)}
                  </span>
                  <span className="font-medium tabular-nums text-navy-700 dark:text-white">
                    {weather.tempMin != null && weather.tempMax != null
                      ? `${Math.round(weather.tempMin)}–${Math.round(
                          weather.tempMax,
                        )}°C`
                      : ''}
                    {weather.precipProb != null
                      ? ` · ${t('bg.precip')} ${weather.precipProb}%`
                      : ''}
                  </span>
                </div>
              );
            })()}
        </div>
        {!venue && (
          <div className="mt-1 text-[10px] text-gray-400">
            {locale === 'zh'
              ? '场馆/天气资料暂缺'
              : 'Venue/weather data unavailable'}
          </div>
        )}
      </Card>
    </>
  );
}
