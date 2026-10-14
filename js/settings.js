/** 界面偏好，存在 localStorage；失败时只保留在内存里。 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});
  const KEY = 'diary:settings';

  const DEFAULT_SETTINGS = {
    theme: 'auto',
    fontSize: 'md',
    preview: false,
    lastEntryId: null,
    tab: 'timeline',
    sort: 'desc',
    timelineFilter: 'all',
    calendarMode: 'diary',
    activeBookId: '',
    todoCollapsed: false,
    lastAccountId: '',
    // 资金压力的三个估算值（本机保存，不随账本、不进备份）
    pressure: { salary: 0, otherIncome: 0, otherExpense: 0 },
  };

  const FONT_SIZES = {
    sm: { label: '小', px: 15 },
    md: { label: '中', px: 16 },
    lg: { label: '大', px: 18 },
  };

  const THEMES = [
    { key: 'auto', label: '跟随系统' },
    { key: 'light', label: '浅色' },
    { key: 'dark', label: '深色' },
  ];

  const FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'today', label: '今天' },
    { key: 'week', label: '最近 7 天' },
    { key: 'pinned', label: '收藏' },
    { key: 'media', label: '有图片' },
  ];

  let cache = null;

  function loadSettings() {
    if (cache) return { ...cache };
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (error) {
      stored = {};
    }
    cache = { ...DEFAULT_SETTINGS, ...stored };
    return { ...cache };
  }

  function saveSettings(patch) {
    cache = { ...loadSettings(), ...(patch || {}) };
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (error) {
      /* 存不了就只留在内存 */
    }
    return { ...cache };
  }

  function applySettings(settings) {
    const element = document.documentElement;
    element.dataset.theme = settings.theme || 'auto';
    const size = FONT_SIZES[settings.fontSize] || FONT_SIZES.md;
    element.style.setProperty('--font-size', `${size.px}px`);
  }

  Diary.settings = { DEFAULT_SETTINGS, FILTERS, FONT_SIZES, THEMES, applySettings, loadSettings, saveSettings };
})(typeof globalThis !== 'undefined' ? globalThis : this);
