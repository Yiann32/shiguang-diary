/** 入口：启动界面 + 注册 Service Worker（离线可用、可安装）。 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});
  let started = false;
  let appApi = null;

  function fatal(error) {
    console.error('[diary] 启动失败', error);
    if (document.querySelector('.fatal')) return;
    const banner = document.createElement('div');
    banner.className = 'fatal';
    banner.textContent = `界面初始化失败：${(error && error.message) || error}。刷新页面试一次，或查看浏览器控制台。`;
    document.body.append(banner);
  }

  function boot() {
    try {
      appApi = Diary.app.start();
      started = true;
    } catch (error) {
      fatal(error);
    }
  }

  window.addEventListener('error', (event) => {
    if (!started) fatal(event.error || event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[diary] 未处理的 Promise', event.reason);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // 原生 App 里的返回键 / 侧滑返回：交给界面处理，能"收起编辑器"就先收起，
  // 只有真的在列表页时才退出。走 Capacitor 的 backButton 事件（小米等机型的
  // 手势返回不会经过 WebView 历史，所以必须用这个原生通道）。
  (function bindNativeBackButton(attempt) {
    const capacitor = root.Capacitor;
    const nativeApp = capacitor && capacitor.Plugins && capacitor.Plugins.App;
    if (nativeApp && typeof nativeApp.addListener === 'function') {
      nativeApp.addListener('backButton', () => {
        if (appApi && appApi.handleBack()) return;
        if (typeof nativeApp.exitApp === 'function') nativeApp.exitApp();
      });
      return;
    }
    // 桥接可能比脚本稍晚就绪，最多重试 20 次（约 2 秒）
    if (capacitor && (attempt || 0) < 20) setTimeout(() => bindNativeBackButton((attempt || 0) + 1), 100);
  })(0);

  // Capacitor 打包的原生 App 不需要 Service Worker：网页文件本来就在安装包里，
  // 留着反而可能在升级后命中旧缓存。file:// 下也跳过（其余功能正常）。
  const isNativeApp = Boolean(
    root.Capacitor &&
      (typeof root.Capacitor.isNativePlatform !== 'function' || root.Capacitor.isNativePlatform()),
  );
  if (!isNativeApp && 'serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js')
        .catch((error) => console.warn('[diary] Service Worker 注册失败', error));
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
