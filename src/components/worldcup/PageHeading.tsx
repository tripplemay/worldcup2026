'use client';

import type { IconType } from 'react-icons';

/** 页面标题:Material 图标 + 文字(统一各页头部风格)。 */
export default function PageHeading({
  Icon,
  children,
}: {
  Icon: IconType;
  children: React.ReactNode;
}) {
  return (
    <h1 className="flex items-center gap-1.5 text-lg font-bold text-navy-700 dark:text-white">
      <Icon className="shrink-0 text-brand-500 dark:text-brand-400" />
      <span>{children}</span>
    </h1>
  );
}
