/**
 * 洋芋影视 App 原生桥 —— 仅 WebView 环境存在
 */
interface KVideoAndroidBridge {
  getAppVersionCode?: () => number;
  getAppVersionName?: () => string;
  downloadUpdate?: (url: string) => void;
  shareText?: (text: string) => void;
  /**
   * 原生媒体通知栏：网页播放器上报状态
   * JSON: { isPlaying, title, artist, album, position(ms), duration(ms), canNext, canPrev }
   */
  mediaUpdate?: (json: string) => void;
  /** 原生媒体通知栏：离开播放页 / 停止播放时取消通知 */
  mediaStop?: () => void;
  /**
   * 原生屏幕方向控制（WebView 不支持 screen.orientation.lock）：
   * "landscape" → 视频全屏强制横屏（横左/横右跟随传感器，不倒立）；
   * "reset" → 退出全屏，交还系统设置
   */
  setOrientation?: (mode: 'landscape' | 'reset') => void;
}

declare global {
  interface Window {
    KVideoAndroid?: KVideoAndroidBridge;
    /** 原生媒体通知按钮 / 锁屏控件 / 耳机媒体键 → 网页统一命令入口 */
    __kvideoMediaCommand?: (cmd: string, arg?: number) => void;
  }
}

export {};
