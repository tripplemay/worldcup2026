'use client';

/**
 * 横向连通淘汰赛对阵树(带连线)。
 * 像素级布局来自 lib/scenario/bracketLayout(拓扑固定);已踢钉死、未定显占位。
 * 容器横向滚动浏览各轮;连线由半决赛负者指向季军赛(虚线)、决赛指向冠军。
 */
import { useEffect, useMemo, useRef } from 'react';
import { MdEmojiEvents } from 'react-icons/md';
import TeamBadge from 'components/worldcup/TeamBadge';
import { useLocale } from 'lib/i18n/context';
import { formatMatchTime } from 'lib/format/matchTime';
import {
  CARD_W,
  CARD_H,
  COL_W,
  CHAMP_COL,
  BOARD_W,
  BOARD_H,
  posByMatch,
  champPos,
  connectors,
  COLUMN_HEADERS,
} from 'lib/scenario/bracketLayout';
import type {
  BracketNode,
  BracketSide,
  BracketPlaceholder,
  KnockoutBracket,
} from 'lib/scenario/types';

const HEADER_H = 26;

/** 占位文案(队伍未定时)。 */
function placeholderLabel(
  ph: BracketPlaceholder,
  t: (k: string) => string,
): string {
  switch (ph.kind) {
    case 'W':
      return t('knockout.first').replace('{g}', ph.group);
    case 'R':
      return t('knockout.second').replace('{g}', ph.group);
    case 'T3':
      return t('knockout.bestThird');
    case 'WM':
      return t('knockout.winnerOf').replace('{m}', String(ph.match));
    case 'LM':
      return t('knockout.loserOf').replace('{m}', String(ph.match));
  }
}

function SideRow({
  side,
  decided,
  t,
}: {
  side: BracketSide;
  decided: boolean;
  t: (k: string) => string;
}) {
  if (!side.norm) {
    return (
      <div className="truncate py-0.5 text-[11px] italic text-gray-400 dark:text-gray-500">
        {side.placeholder ? placeholderLabel(side.placeholder, t) : '—'}
      </div>
    );
  }
  const win = side.winner;
  const dim = decided && !win;
  return (
    <div
      className={`flex items-center justify-between gap-1 py-0.5 ${
        win
          ? 'font-bold text-navy-800 dark:text-white'
          : dim
          ? 'text-gray-400 dark:text-gray-500'
          : 'text-navy-700 dark:text-gray-200'
      }`}
    >
      <TeamBadge
        name={side.name ?? side.norm}
        logo={side.logo}
        className="min-w-0 flex-1 text-[12px]"
      />
      {typeof side.score === 'number' && (
        <span className="shrink-0 tabular-nums text-[12px]">{side.score}</span>
      )}
    </div>
  );
}

function NodeCard({ node }: { node: BracketNode }) {
  const { t, locale } = useLocale();
  const pos = posByMatch.get(node.match)!;
  const isP3 = node.match === 103;

  let badge: { text: string; cls: string } | null = null;
  if (node.status === 'in') {
    badge = { text: t('knockout.live'), cls: 'text-red-500' };
  } else if (
    node.status === 'post' &&
    node.decided &&
    node.home.score === node.away.score
  ) {
    badge = { text: t('knockout.pens'), cls: 'text-amber-500' };
  } else if (node.status === 'pre' && node.commenceTime) {
    badge = {
      text: formatMatchTime(node.commenceTime, locale),
      cls: 'text-gray-400',
    };
  }

  return (
    <div
      className="absolute"
      style={{
        left: pos.x,
        top: HEADER_H + pos.y - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
      }}
    >
      {isP3 && (
        <div className="absolute -top-4 left-0 text-[10px] font-semibold text-gray-400">
          {t('knockout.third')}
        </div>
      )}
      <div className="flex h-full flex-col justify-center rounded-lg border border-gray-200 bg-white px-2 shadow-sm dark:border-white/10 dark:bg-navy-800">
        {badge && (
          <div className={`absolute right-1.5 top-0.5 text-[9px] ${badge.cls}`}>
            {badge.text}
          </div>
        )}
        <SideRow side={node.home} decided={node.decided} t={t} />
        <div className="my-0.5 h-px bg-gray-100 dark:bg-white/5" />
        <SideRow side={node.away} decided={node.decided} t={t} />
      </div>
    </div>
  );
}

function ChampionCard({
  champion,
}: {
  champion?: KnockoutBracket['champion'];
}) {
  const { t, tn } = useLocale();
  return (
    <div
      className="absolute"
      style={{
        left: champPos.x,
        top: HEADER_H + champPos.y - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
      }}
    >
      <div
        className={`flex h-full items-center gap-2 rounded-lg border px-2 shadow-sm ${
          champion
            ? 'border-amber-300 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-400/10'
            : 'border-dashed border-gray-200 bg-white dark:border-white/10 dark:bg-navy-800'
        }`}
      >
        <MdEmojiEvents
          className={`shrink-0 text-xl ${
            champion ? 'text-amber-500' : 'text-gray-300'
          }`}
        />
        <span
          className={`truncate text-[13px] font-bold ${
            champion ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400'
          }`}
        >
          {champion ? tn(champion.name) : t('knockout.champion')}
        </span>
      </div>
    </div>
  );
}

export default function BracketTree({ bracket }: { bracket: KnockoutBracket }) {
  const { t } = useLocale();

  // 「当前轮」= 仍有已踢/进行中场次的最靠后一列(随轮次推进才变,刷新不变)
  const maxLiveCol = useMemo(
    () =>
      bracket.nodes.reduce(
        (mx, n) =>
          n.status !== 'pre'
            ? Math.max(mx, posByMatch.get(n.match)?.col ?? 0)
            : mx,
        0,
      ),
    [bracket],
  );

  // 进页面自动横向滚到当前轮(仅当前轮变化时触发,避免每次轮询都滚动)
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && maxLiveCol > 1) {
      el.scrollTo({
        left: Math.max(0, (maxLiveCol - 1) * COL_W),
        behavior: 'smooth',
      });
    }
  }, [maxLiveCol]);

  return (
    <div ref={scrollRef} className="-mx-4 overflow-x-auto px-4 pb-4">
      <div
        className="relative"
        style={{ width: BOARD_W, height: BOARD_H + HEADER_H }}
      >
        {/* 列表头 */}
        {COLUMN_HEADERS.map((h) => (
          <div
            key={h.key}
            className="absolute text-[11px] font-bold text-brand-500 dark:text-brand-400"
            style={{ left: h.col * COL_W, top: 0, width: CARD_W }}
          >
            {t(`knockout.${h.key}`)}
          </div>
        ))}

        {/* 连接线 */}
        <svg
          className="pointer-events-none absolute left-0"
          style={{ top: HEADER_H }}
          width={BOARD_W}
          height={BOARD_H}
        >
          {connectors.map((c, i) => {
            const midX = (c.x1 + c.x2) / 2;
            return (
              <polyline
                key={i}
                points={`${c.x1},${c.y1} ${midX},${c.y1} ${midX},${c.y2} ${c.x2},${c.y2}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={c.dashed ? '4 3' : undefined}
                className="text-gray-300 dark:text-white/15"
              />
            );
          })}
        </svg>

        {/* 节点卡 */}
        {bracket.nodes.map((n) => (
          <NodeCard key={n.match} node={n} />
        ))}
        <ChampionCard champion={bracket.champion} />
      </div>
    </div>
  );
}
