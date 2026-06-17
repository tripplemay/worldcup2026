'use client';

import { useLocale } from 'lib/i18n/context';
import { layoutXI } from 'lib/lineup/formation';
import type { RosterPlayer } from 'lib/espn/types';

export interface PitchSide {
  team: string;
  formation?: string;
  starters: RosterPlayer[];
}

/** 拉丁名取末单词作简称。 */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : name;
}
/** 中文名取「·」后末段(姓);无分隔则整名。 */
function shortZh(zh: string): string {
  const parts = zh.split('·');
  return parts[parts.length - 1];
}

function Spot({
  top,
  left,
  jersey,
  name,
  disc,
}: {
  top: number;
  left: number;
  jersey?: string;
  name: string;
  disc: string;
}) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      style={{ top: `${top}%`, left: `${left}%` }}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold tabular-nums text-white shadow-md ${disc}`}
      >
        {jersey ?? ''}
      </span>
      <span className="mt-0.5 max-w-[56px] truncate text-[9px] font-medium leading-tight text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]">
        {name}
      </span>
    </div>
  );
}

/** 可视化球场阵型图:主队在下(向上进攻)、客队在上(向下进攻);数据来自 ESPN。 */
export default function PitchFormation({
  home,
  away,
}: {
  home: PitchSide;
  away: PitchSide;
}) {
  const { tn, locale } = useLocale();
  const homeSpots = layoutXI(home.formation, home.starters);
  const awaySpots = layoutXI(away.formation, away.starters);
  if (!homeSpots.length && !awaySpots.length) return null;

  // 中文模式优先显示中文名(取姓),否则拉丁名末单词
  const disp = (s: { name: string; zh?: string }) =>
    locale === 'zh' && s.zh ? shortZh(s.zh) : shortName(s.name);

  const teamLabel = (s: PitchSide) => (
    <span className="flex items-center gap-1.5 truncate font-medium text-navy-700 dark:text-white">
      <span className="truncate">{tn(s.team)}</span>
      {s.formation && (
        <span className="shrink-0 font-normal text-gray-400">
          {s.formation}
        </span>
      )}
    </span>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1">
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
          {teamLabel(home)}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          {teamLabel(away)}
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
        </span>
      </div>

      <div className="relative w-full overflow-hidden rounded-2xl bg-gradient-to-b from-green-600 to-green-700 aspect-[3/4]">
        {/* 球场线条 */}
        <div className="absolute inset-2 rounded-lg border border-white/25" />
        <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-white/25" />
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" />
        <div className="absolute left-1/2 top-2 h-[13%] w-[44%] -translate-x-1/2 rounded-b-md border border-t-0 border-white/25" />
        <div className="absolute bottom-2 left-1/2 h-[13%] w-[44%] -translate-x-1/2 rounded-t-md border border-b-0 border-white/25" />

        {/* 主队(下半场,GK 在底,向上进攻):top 95% → 53% */}
        {homeSpots.map((s, i) => (
          <Spot
            key={`h${i}`}
            top={95 - s.adv * 42}
            left={s.x}
            jersey={s.jersey}
            name={disp(s)}
            disc="bg-brand-500"
          />
        ))}
        {/* 客队(上半场,GK 在顶,向下进攻,左右镜像):top 5% → 47% */}
        {awaySpots.map((s, i) => (
          <Spot
            key={`a${i}`}
            top={5 + s.adv * 42}
            left={100 - s.x}
            jersey={s.jersey}
            name={disp(s)}
            disc="bg-red-500"
          />
        ))}
      </div>
    </div>
  );
}
