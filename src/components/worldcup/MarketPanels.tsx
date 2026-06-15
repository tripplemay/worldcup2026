'use client';

import { useT, useTn } from 'lib/i18n/context';
import type {
  GroupMarkets,
  AggOuLine,
  AggAhLine,
  BookThreeWay,
  BookTotalsLine,
  PlayerPick,
  PlayerOuPick,
} from 'lib/odds/types';

const fmt = (v?: number) => (v != null ? v.toFixed(2) : '—');
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return (
    <th className={`py-1 font-normal ${left ? 'text-left' : 'text-center'}`}>
      {children}
    </th>
  );
}

/** 赔率单元格:价 + 下方小字博彩商名。 */
function Price({ price, book }: { price?: number; book?: string }) {
  if (price == null) return <span className="text-gray-300">—</span>;
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className="font-medium tabular-nums text-navy-700 dark:text-white">
        {fmt(price)}
      </span>
      {book && <span className="text-[9px] text-gray-400">{book}</span>}
    </span>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex items-baseline gap-1">
        <span className="text-xs font-semibold text-navy-700 dark:text-white">
          {title}
        </span>
        {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  const t = useT();
  return (
    <div className="py-4 text-center text-xs text-gray-400">
      {t('detail.noData')}
    </div>
  );
}

const rowCls = 'border-t border-gray-100 dark:border-white/5';
const bookCls = 'py-1.5 text-gray-600 dark:text-gray-300';

// ── 上半场 ──────────────────────────────────────────────
function ThreeWayTable({ rows }: { rows?: BookThreeWay[] }) {
  const t = useT();
  if (!rows?.length) return <Empty />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('odds.book')}</Th>
          <Th>{t('odds.home')}</Th>
          <Th>{t('odds.draw')}</Th>
          <Th>{t('odds.away')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.key} className={rowCls}>
            <td className={bookCls}>{b.title}</td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">
              {fmt(b.home)}
            </td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">
              {fmt(b.draw)}
            </td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">
              {fmt(b.away)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BookTotalsTable({ rows }: { rows?: BookTotalsLine[] }) {
  const t = useT();
  if (!rows?.length) return <Empty />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('odds.book')}</Th>
          <Th>{t('detail.over')}</Th>
          <Th>{t('detail.under')}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.key} className={rowCls}>
            <td className={bookCls}>{b.title}</td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">
              {b.over != null ? `${b.overPoint} @${fmt(b.over)}` : '—'}
            </td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">
              {b.under != null ? `${b.underPoint} @${fmt(b.under)}` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 角球 / 红黄牌(聚合最优)─────────────────────────────
function OuLines({ lines }: { lines?: AggOuLine[] }) {
  const t = useT();
  if (!lines?.length) return <Empty />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('detail.line')}</Th>
          <Th>{t('detail.over')}</Th>
          <Th>{t('detail.under')}</Th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.point} className={rowCls}>
            <td className="py-1.5 tabular-nums text-gray-600 dark:text-gray-300">
              {l.point}
            </td>
            <td className="text-center">
              <Price price={l.over?.price} book={l.over?.book} />
            </td>
            <td className="text-center">
              <Price price={l.under?.price} book={l.under?.book} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AhLines({ lines }: { lines?: AggAhLine[] }) {
  const t = useT();
  const tn = useTn();
  if (!lines?.length) return <Empty />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] text-gray-400">
          <Th left>{t('detail.team')}</Th>
          <Th>{t('detail.handicapCol')}</Th>
          <Th>{t('detail.priceCol')}</Th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={`${l.team}-${l.point}-${i}`} className={rowCls}>
            <td className={bookCls}>{tn(l.team)}</td>
            <td className="text-center tabular-nums text-navy-700 dark:text-white">
              {sign(l.point)}
            </td>
            <td className="text-center">
              <Price price={l.best.price} book={l.best.book} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 球员盘 ──────────────────────────────────────────────
const CAP = 20;

function PlayerYesList({ items }: { items?: PlayerPick[] }) {
  const t = useT();
  if (!items?.length) return <Empty />;
  const extra = items.length - CAP;
  return (
    <>
      <table className="w-full text-sm">
        <tbody>
          {items.slice(0, CAP).map((p, i) => (
            <tr key={`${p.player}-${i}`} className={rowCls}>
              <td className={bookCls}>{p.player}</td>
              <td className="py-1.5 text-right">
                <Price price={p.best.price} book={p.best.book} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {extra > 0 && (
        <div className="mt-1 text-center text-[10px] text-gray-400">
          + {extra} {t('detail.more')}
        </div>
      )}
    </>
  );
}

function PlayerOverList({ items }: { items?: PlayerOuPick[] }) {
  const t = useT();
  if (!items?.length) return <Empty />;
  const extra = items.length - CAP;
  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-gray-400">
            <Th left>{t('detail.player')}</Th>
            <Th>{t('detail.line')}</Th>
            <Th>{t('detail.over')}</Th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, CAP).map((p, i) => (
            <tr key={`${p.player}-${p.point}-${i}`} className={rowCls}>
              <td className={bookCls}>{p.player}</td>
              <td className="text-center tabular-nums text-gray-600 dark:text-gray-300">
                {p.point}
              </td>
              <td className="text-center">
                <Price price={p.best.price} book={p.best.book} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {extra > 0 && (
        <div className="mt-1 text-center text-[10px] text-gray-400">
          + {extra} {t('detail.more')}
        </div>
      )}
    </>
  );
}

/** 富盘口分组面板:按 group 渲染上半场 / 角球 / 红黄牌 / 球员。各表取各家最优价。 */
export default function GroupPanel({ markets }: { markets: GroupMarkets }) {
  const t = useT();
  const hint = t('detail.bestHint');
  switch (markets.group) {
    case 'firsthalf':
      return (
        <>
          <Section title={t('detail.firstHalfResult')}>
            <ThreeWayTable rows={markets.h1ThreeWay} />
          </Section>
          <Section title={t('detail.firstHalfTotals')}>
            <BookTotalsTable rows={markets.h1Totals} />
          </Section>
        </>
      );
    case 'corners':
      return (
        <>
          <Section title={t('detail.cornersTotals')} hint={hint}>
            <OuLines lines={markets.cornersTotals} />
          </Section>
          <Section title={t('detail.cornersHandicap')} hint={hint}>
            <AhLines lines={markets.cornersSpreads} />
          </Section>
        </>
      );
    case 'cards':
      return (
        <>
          <Section title={t('detail.cardsTotals')} hint={hint}>
            <OuLines lines={markets.cardsTotals} />
          </Section>
          <Section title={t('detail.cardsHandicap')} hint={hint}>
            <AhLines lines={markets.cardsSpreads} />
          </Section>
        </>
      );
    case 'players':
      return (
        <>
          <Section title={t('detail.goalScorer')} hint={hint}>
            <PlayerYesList items={markets.goalScorers} />
          </Section>
          <Section title={t('detail.shotsOnTarget')} hint={hint}>
            <PlayerOverList items={markets.shots} />
          </Section>
          <Section title={t('detail.toBeBooked')} hint={hint}>
            <PlayerYesList items={markets.cardPlayers} />
          </Section>
        </>
      );
    default:
      return null;
  }
}
