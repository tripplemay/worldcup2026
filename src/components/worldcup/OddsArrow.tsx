import type { OutcomeChange } from 'lib/odds/changes';

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}`;

/**
 * 赔率变动箭头:↑绿 / ↓红;withDelta 时附带带符号幅度(如 ↑+0.05)。
 * 无变化(ch 为空)渲染 null。
 */
export default function OddsArrow({
  ch,
  withDelta,
}: {
  ch?: OutcomeChange;
  withDelta?: boolean;
}) {
  if (!ch) return null;
  const up = ch.dir === 'up';
  return (
    <span className={`ml-0.5 ${up ? 'text-green-500' : 'text-red-500'}`}>
      {up ? '↑' : '↓'}
      {withDelta && <span className="text-[10px]">{signed(ch.delta)}</span>}
    </span>
  );
}
