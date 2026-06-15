import React, { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { DM_Sans } from 'next/font/google';
import AppWrappers from './AppWrappers';
import PwaRegister from './pwa-register';

// 自托管 DM Sans(latin),preload + swap;中文沿用系统字体(DM Sans 无中文字形)
const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-dm-sans',
});
// import '@asseinfo/react-kanban/dist/styles.css';
// import '/public/styles/Plugins.css';

export const metadata: Metadata = {
  applicationName: '世界杯2026',
  title: '世界杯 2026 · 赛程赔率比分',
  description: '2026 FIFA 世界杯实时赔率、比赛预测、赛程、比分与积分榜',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '世界杯2026',
  },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: '/icons/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#4318FF',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className={dmSans.variable}>
      <body className="dark" id={'root'}>
        <AppWrappers>{children}</AppWrappers>
        <PwaRegister />
      </body>
    </html>
  );
}
