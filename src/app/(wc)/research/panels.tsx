/**
 * 研究观测台:独立卡片组件(从 page.tsx 抽出控文件规模)。
 *  · PooledPanel —— ⑥ 跨联赛池化功效检验(家族级 G2);判定阈值随 PooledStore 下发,
 *    UI 不二次硬编码(与 screenPooled 单一事实源)。
 *  · ForwardPanel —— ⑤ 前向实测(自动下注)表。
 */
'use client';

import Card from 'components/card';
import { MdCheckCircle, MdCancel } from 'react-icons/md';
import type { PooledStore } from 'research/pooled';
import type { ForwardSummaryRow } from 'research/forward';

const fmt = (n: number | undefined, d = 4) =>
  n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(d);
const signed = (n: number, d = 4) => `${n >= 0 ? '+' : ''}${fmt(n, d)}`;

function Screen({ ok }: { ok: boolean }) {
  return ok ? (
    <MdCheckCircle className="inline text-green-600 dark:text-green-400" />
  ) : (
    <MdCancel className="inline text-red-500 dark:text-red-400" />
  );
}

const TH = 'font-normal text-[11px] text-gray-400';
const numTd = 'text-right tabular-nums font-mono';

/** ⑥ 跨联赛池化功效检验(单联赛 G2 功效结构性不可达 → 合并 9 联赛才有判定力)。 */
export function PooledPanel({
  pooled,
  t,
}: {
  pooled: PooledStore;
  t: (k: string) => string;
}) {
  const th = pooled.thresholds;
  const hint = t('research.pooledHint')
    .replace('{n}', String(th?.minN ?? '—'))
    .replace('{t}', String(th?.minT ?? '—'))
    .replace('{avg}', th ? `${(th.minAvg * 100).toFixed(1)}%` : '—')
    .replace('{pos}', th ? `${(th.minPos * 100).toFixed(0)}%` : '—');
  return (
    <Card extra="p-4">
      <h2 className="mb-0.5 text-sm font-bold text-navy-700 dark:text-white">
        {t('research.pooledT')}
      </h2>
      <p className="mb-2 text-[10px] leading-snug text-gray-400">{hint}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className={TH}>
            <th className="text-left">{t('research.pooledConfig')}</th>
            <th className={numTd}>{t('research.pooledN')}</th>
            <th className={numTd}>CLV</th>
            <th className={numTd}>t</th>
            <th className={numTd}>CI95</th>
            <th className="text-center">{t('research.pooledPass')}</th>
          </tr>
        </thead>
        <tbody>
          {pooled.configs.map((c) => (
            <tr
              key={c.key}
              className="border-t border-gray-100 text-gray-600 dark:border-white/5 dark:text-gray-300"
            >
              <td className="py-1 text-left text-[10px] leading-tight">
                {c.label}
              </td>
              <td className={numTd}>
                {c.result.n}
                {c.screen.nPass || th == null ? '' : `/${th.minN}`}
              </td>
              <td className={numTd}>{signed(c.result.avgClv * 100, 2)}%</td>
              <td className={numTd}>{fmt(c.result.tStat, 2)}</td>
              <td className={`${numTd} text-[10px]`}>
                [{signed(c.result.ci95[0] * 100, 2)}%,
                {signed(c.result.ci95[1] * 100, 2)}%]
              </td>
              <td className="text-center">
                <Screen ok={c.screen.overall} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** ⑤ 前向实测(自动下注)表。 */
export function ForwardPanel({
  forward,
  t,
}: {
  forward: ForwardSummaryRow[];
  t: (k: string) => string;
}) {
  return (
    <Card extra="p-4">
      <h2 className="mb-1 text-sm font-bold text-navy-700 dark:text-white">
        {t('research.forwardT')}
      </h2>
      <p className="mb-2 text-[10px] leading-snug text-gray-400">
        {t('research.forwardHint')}
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className={TH}>
            <th className="text-left">{t('research.colWinner')}</th>
            <th className={numTd}>{t('research.fwdSince')}</th>
            <th className={numTd}>{t('research.fwdBets')}</th>
            <th className={numTd}>{t('research.fwdRoi')}</th>
            <th className={numTd}>{t('research.fwdPnl')}</th>
            <th className={numTd}>{t('research.colClvT')}</th>
            <th className="text-center">{t('research.fwdG7')}</th>
          </tr>
        </thead>
        <tbody>
          {forward.map((f) => {
            const g7ok = f.n >= 150 && f.clvT > 2;
            return (
              <tr
                key={f.configHash}
                className="border-t border-gray-100 text-gray-600 dark:border-white/5 dark:text-gray-300"
              >
                <td className="py-1 text-left">{f.label}</td>
                <td className={numTd}>{f.since}</td>
                <td className={numTd}>{f.n}</td>
                <td
                  className={`${numTd} font-semibold ${
                    f.n === 0
                      ? 'text-gray-400'
                      : f.roi > 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-500 dark:text-red-400'
                  }`}
                >
                  {f.n ? signed(f.roi) : '—'}
                </td>
                <td className={numTd}>{f.n ? signed(f.pnl, 0) : '—'}</td>
                <td className={numTd}>{f.clvN > 1 ? fmt(f.clvT, 2) : '—'}</td>
                <td className="text-center">
                  {g7ok ? (
                    <Screen ok={true} />
                  ) : (
                    <span className="font-mono text-[10px] text-gray-400">
                      {f.n}/150
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {forward.every((f) => f.n === 0) && (
        <div className="mt-2 text-center text-[11px] text-gray-400">
          {t('research.fwdNoBets')}
        </div>
      )}
    </Card>
  );
}
