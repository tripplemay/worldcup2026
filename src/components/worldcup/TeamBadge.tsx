'use client';

import { useTn } from 'lib/i18n/context';

/**
 * 队徽 + 队名(队名按语言本地化;logo 取 ESPN 暗色版国家队徽;缺失时占位圆)。
 * - reverse:旧版镜像(flex-row-reverse),保留给对阵树/预测页等用法。
 * - nameFirst:队名在前、队徽在后(正常 flex),用于对阵卡把队名对齐到容器外侧边缘。
 */
export default function TeamBadge({
  name,
  logo,
  reverse = false,
  nameFirst = false,
  className = '',
}: {
  name: string;
  logo?: string;
  reverse?: boolean;
  nameFirst?: boolean;
  className?: string;
}) {
  const tn = useTn();
  const logoEl = logo ? (
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
  );
  const nameEl = <span className="truncate">{tn(name)}</span>;
  return (
    <span
      className={`flex items-center gap-1.5 ${
        reverse ? 'flex-row-reverse' : ''
      } ${className}`}
    >
      {nameFirst ? (
        <>
          {nameEl}
          {logoEl}
        </>
      ) : (
        <>
          {logoEl}
          {nameEl}
        </>
      )}
    </span>
  );
}
