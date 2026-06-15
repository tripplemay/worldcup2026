'use client';

import { useTn } from 'lib/i18n/context';

/** 队徽 + 队名(队名按语言本地化;logo 取 ESPN 暗色版国家队徽;缺失时占位圆)。 */
export default function TeamBadge({
  name,
  logo,
  reverse = false,
  className = '',
}: {
  name: string;
  logo?: string;
  reverse?: boolean;
  className?: string;
}) {
  const tn = useTn();
  return (
    <span
      className={`flex items-center gap-1.5 ${
        reverse ? 'flex-row-reverse' : ''
      } ${className}`}
    >
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 shrink-0 object-contain"
          loading="lazy"
        />
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-full bg-gray-200 dark:bg-navy-700" />
      )}
      <span className="truncate">{tn(name)}</span>
    </span>
  );
}
