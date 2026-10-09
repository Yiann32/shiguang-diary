/** 一点点 DOM 糖 + 图标 + 轻提示，避免到处写重复代码。 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => [...(scope || document).querySelectorAll(selector)];

  /** 细线条图标，风格参考用户给的截图（24×24、currentColor、stroke）。 */
  const ICONS = {
    book: '<path d="M5 4.5h9.5L19 9v10.5H5z"/><path d="M14 4.5V9h4.5"/><path d="M8.5 13h7M8.5 16.5h4.5"/>',
    calendar: '<path d="M4.5 6.5h15v13h-15z"/><path d="M4.5 10.5h15M8.5 4.5v3.5M15.5 4.5v3.5"/><path d="M9.5 13.5h5v3.5h-5z"/>',
    chart: '<path d="M4.5 19.5h15"/><path d="M7.5 19.5v-5M12 19.5V8M16.5 19.5v-8"/>',
    person: '<path d="M12 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M5 19.5c1.4-3.1 3.9-4.6 7-4.6s5.6 1.5 7 4.6"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    search: '<path d="M10.5 16.5a6 6 0 1 0 0-12 6 6 0 0 0 0 12z"/><path d="M15 15l4.5 4.5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
    chevronLeft: '<path d="M14.5 6l-6 6 6 6"/>',
    chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
    chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
    wallet: '<path d="M4 7.5h16v11H4z"/><path d="M4 10.5h16"/><path d="M15.5 14.2h2"/>',
    brush: '<path d="M5 4.5h9l4 4v11H5z"/><path d="M13.5 4.5V9H18"/><path d="M9.5 15.2l3.5-3.5 2 2-3.5 3.5-2.4.4z"/>',
    star: '<path d="M12 4.6l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10.3l5.4-.8z"/>',
    eye: '<path d="M2.8 12S6.4 6.6 12 6.6 21.2 12 21.2 12 17.6 17.4 12 17.4 2.8 12 2.8 12z"/><path d="M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"/>',
    trash: '<path d="M5 7h14M9.5 7V5h5v2"/><path d="M7 7l.9 12.5h8.2L17 7"/><path d="M10.5 10.5v5.5M13.5 10.5v5.5"/>',
    bulb: '<path d="M9.5 17.5h5M10.5 20.5h3"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1 1.2 1.1 2h5c.1-.8.4-1.5 1.1-2A6 6 0 0 0 12 3.5z"/>',
    image: '<path d="M4.5 5.5h15v13h-15z"/><path d="M9 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/><path d="M4.5 16l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5"/>',
    shuffle: '<path d="M4 7h3.5l9 10H20"/><path d="M16.5 4l3.5 3-3.5 3"/><path d="M4 17h3.5l2-2.2"/><path d="M16.5 14l3.5 3-3.5 3"/>',
    download: '<path d="M12 4.5v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19.5h14"/>',
    upload: '<path d="M12 15V5"/><path d="M8 8.5l4-4 4 4"/><path d="M5 19.5h14"/>',
    filter: '<path d="M4.5 7h15M7 12h10M10 17h4"/>',
    check: '<path d="M5.5 12.5l4 4 9-9"/>',
    tag: '<path d="M4.8 4.8h6.4l8 8-6.4 6.4-8-8z"/><path d="M8.6 8.6h.01"/>',
    lines: '<path d="M5 6.5h14M5 12h14M5 17.5h8"/>',
  };

  function icon(name, size = 22) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] || '';
    return svg;
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children || [])) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function debounce(fn, wait = 300) {
    let timer = null;
    const wrapped = (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, wait);
    };
    wrapped.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    wrapped.flush = (...args) => {
      wrapped.cancel();
      fn(...args);
    };
    return wrapped;
  }

  let toastTimer = null;
  let toastHideTimer = null;

  function toast(message, options) {
    const config = options || {};
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = config.tone || 'info';
    node.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    if (toastHideTimer) clearTimeout(toastHideTimer);
    // 用 Web Animations 直接驱动，避免个别 WebView 里 CSS transition 不触发
    if (typeof node.animate === 'function') {
      node.animate(
        [
          { opacity: 0, transform: 'translate(-50%, 26px) scale(0.88)' },
          { opacity: 1, transform: 'translate(-50%, 0) scale(1.02)', offset: 0.7 },
          { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
        ],
        { duration: 380, easing: 'cubic-bezier(0.2, 0.9, 0.25, 1.2)', fill: 'both' },
      );
    }
    toastTimer = setTimeout(() => {
      if (typeof node.animate === 'function') {
        const out = node.animate(
          [
            { opacity: 1, transform: 'translate(-50%, 0) scale(1)' },
            { opacity: 0, transform: 'translate(-50%, 14px) scale(0.96)' },
          ],
          { duration: 240, easing: 'ease-in', fill: 'both' },
        );
        out.onfinish = () => node.classList.remove('is-visible');
      } else {
        node.classList.remove('is-visible');
      }
    }, config.duration || 2600);
  }

  const isNativePlatform = () =>
    Boolean(
      root.Capacitor &&
        (typeof root.Capacitor.isNativePlatform !== 'function' || root.Capacitor.isNativePlatform()),
    );

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        resolve(text.slice(text.indexOf(',') + 1));
      };
      reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 导出文件。
   * 网页里直接 <a download>；原生 App 里 WebView 根本不处理 blob 下载
   * （Capacitor 没有设置 DownloadListener，点了等于没发生），
   * 所以改成「写进缓存目录 + 交给系统分享」，用户自己选保存到哪或发给谁。
   */
  async function downloadFile(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const plugins = (root.Capacitor && root.Capacitor.Plugins) || {};
    if (isNativePlatform() && plugins.Filesystem) {
      const data = await blobToBase64(blob);
      const saved = await plugins.Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
      if (plugins.Share) {
        try {
          await plugins.Share.share({ title: filename, files: [saved.uri], dialogTitle: filename });
        } catch (error) {
          // 用户在分享面板里点了取消：文件已经写好了，不算失败
        }
      }
      return { native: true, uri: saved.uri };
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { native: false };
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  Diary.ui = { $, $$, ICONS, closeDialog, debounce, downloadFile, el, icon, openDialog, toast };
})(typeof globalThis !== 'undefined' ? globalThis : this);
