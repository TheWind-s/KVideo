/**
 * 洋芋影视 App 原生桥 —— 仅 WebView 环境存在
 */
interface KVideoAndroidBridge {
  getAppVersionCode?: () => number;
  getAppVersionName?: () => string;
  downloadUpdate?: (url: string) => void;
  shareText?: (text: string) => void;
}

declare global {
  interface Window {
    KVideoAndroid?: KVideoAndroidBridge;
  }
}

export {};
