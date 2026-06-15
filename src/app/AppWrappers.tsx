'use client';
import React, { ReactNode } from 'react';
import 'styles/App.css';
import 'styles/index.css';

import { useState } from 'react';
import { ConfiguratorContext } from 'contexts/ConfiguratorContext';

// H3:去掉原 NoSSR 包裹,恢复 SSR 首屏(骨架/字体/底部 Tab 立即服务端绘制)。
// 主题写 document 的副作用已在 useEffect 内,仅客户端执行,SSR 安全。
export default function AppWrappers({ children }: { children: ReactNode }) {
  const [mini, setMini] = useState(false);
  const [contrast, setContrast] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [theme, setTheme] = useState<any>({
    '--background-100': '#FFFFFF',
    '--background-900': '#070f2e',
    '--shadow-100': 'rgba(112, 144, 176, 0.08)',
    '--color-50': '#E9E3FF',
    '--color-100': '#C0B8FE',
    '--color-200': '#A195FD',
    '--color-300': '#8171FC',
    '--color-400': '#7551FF',
    '--color-500': '#422AFB',
    '--color-600': '#3311DB',
    '--color-700': '#2111A5',
    '--color-800': '#190793',
    '--color-900': '#11047A',
  }); // When the theme state changes, this effect will update the CSS variables in the document's root element
  React.useEffect(() => {
    let color;
    for (color in theme) {
      document.documentElement.style.setProperty(color, theme[color]);
    }
    //eslint-disable-next-line
  }, [theme]);
  return (
    <ConfiguratorContext.Provider
      value={{
        mini,
        setMini,
        theme,
        setTheme,
        hovered,
        setHovered,
        contrast,
        setContrast,
      }}
    >
      {children}
    </ConfiguratorContext.Provider>
  );
}
