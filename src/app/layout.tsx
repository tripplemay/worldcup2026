import React, { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import AppWrappers from './AppWrappers';
import PwaRegister from './pwa-register';
// import '@asseinfo/react-kanban/dist/styles.css';
// import '/public/styles/Plugins.css';

export const metadata: Metadata = {
  applicationName: '世界杯2026',
  title: '世界杯 2026 · 赛程赔率比分',
  description: '2026 FIFA 世界杯实时赔率、赛程、比分与积分榜',
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
    <html lang="zh-CN">
      <body className="dark" id={'root'}>
        <AppWrappers>{children}</AppWrappers>
        <PwaRegister />
      </body>
    </html>
  );
}
