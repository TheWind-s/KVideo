'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  actualTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 主题切换入口已下线，全站恒定亮色
  const [theme] = useState<Theme>('light');
  const [actualTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // 覆盖老用户残留的 dark/system 偏好，直接摘掉 dark 类。
    // 不使用 View Transition：整页快照在部分 Chromium/WebView 版本上
    // 会露出黑色快照间隙（偶发全黑）。
    document.documentElement.classList.remove('dark');
    try {
      localStorage.setItem('theme', 'light');
    } catch {
      // 隐私模式等场景忽略写入失败
    }
  }, []);

  // 保留兼容签名：无论调用方传什么，都保持亮色
  const setTheme = () => {};

  return (
    <ThemeContext.Provider value={{ theme, setTheme, actualTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
