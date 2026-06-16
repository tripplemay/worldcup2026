/** 两队中间的 VS 徽章(圆角小底 + VS 字样,替代纯文字,全站统一)。 */
export default function VsBadge() {
  return (
    <span className="shrink-0 select-none rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold tracking-wider text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
      VS
    </span>
  );
}
