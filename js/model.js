/**
 * 纯逻辑层：不碰 DOM，也不碰存储，浏览器和 Node 都能直接跑。
 *
 * 注意：这里刻意没有用 ES Module。用 <script type="module"> 的页面在 file:// 下会被
 * 浏览器以 CORS 拦掉，导致「双击打开 index.html 后按钮全都没反应」。改成经典脚本 +
 * Diary 命名空间后，直接双击打开也能正常使用。
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_KEY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
  const DAY_MS = 86400000;
  const WEEKDAYS = '日一二三四五六';
  const WEEKDAY_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const MONTH_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

  const pad2 = (value) => String(value).padStart(2, '0');

  /* -------------------------------------------------------------- 日期 */

  function toDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function toTimeKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  function parseDateKey(key) {
    const match = DATE_KEY_RE.exec(String(key == null ? '' : key).trim());
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (Number.isNaN(date.getTime())) return null;
    if (date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }

  function isValidDateKey(key) {
    return parseDateKey(key) !== null;
  }

  function dayDiff(aKey, bKey) {
    const a = parseDateKey(aKey);
    const b = parseDateKey(bKey);
    if (!a || !b) return NaN;
    return Math.round((a.getTime() - b.getTime()) / DAY_MS);
  }

  function shiftDateKey(key, days) {
    const date = parseDateKey(key);
    if (!date) return '';
    date.setDate(date.getDate() + days);
    return toDateKey(date);
  }

  function todayKey(now = Date.now()) {
    return toDateKey(now);
  }

  function dateLabel(key, today = todayKey()) {
    const diff = dayDiff(key, today);
    if (diff === 0) return '今天';
    if (diff === -1) return '昨天';
    if (diff === -2) return '前天';
    const date = parseDateKey(key);
    if (!date) return String(key == null ? '' : key);
    const todayDate = parseDateKey(today);
    const weekday = WEEKDAYS[date.getDay()];
    if (todayDate && date.getFullYear() === todayDate.getFullYear()) {
      return `${date.getMonth() + 1}月${date.getDate()}日 周${weekday}`;
    }
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  /** 卡片头部用的「26 周六」。 */
  function cardDate(key) {
    const date = parseDateKey(key);
    if (!date) return { day: '?', weekday: '' };
    return { day: String(date.getDate()), weekday: WEEKDAY_FULL[date.getDay()] };
  }

  /** 日历头部用的「9月26日 + 2026」。 */
  function headerDate(key) {
    const date = parseDateKey(key);
    if (!date) return { main: '', year: '', weekday: '' };
    return {
      main: `${date.getMonth() + 1}月${date.getDate()}日`,
      year: String(date.getFullYear()),
      weekday: WEEKDAY_FULL[date.getDay()],
    };
  }

  function formatDateTime(value) {
    return `${toDateKey(value)} ${toTimeKey(value)}`;
  }

  function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} B`;
    if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1048576).toFixed(2)} MB`;
  }

  /* ------------------------------------------------------------- 记账 */

  /** 金额：只保留两位小数，非法值归零 */
  function toMoney(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return 0;
    return Math.round(number * 100) / 100;
  }

  /** 一笔流水的三种类型：支出 / 收入 / 转账 */
  const LEDGER_TYPES = [
    { key: 'expense', label: '支出' },
    { key: 'income', label: '收入' },
    { key: 'transfer', label: '转账' },
  ];

  const LEDGER_TYPE_LABELS = { expense: '支出', income: '收入', transfer: '转账' };

  function normalizeLedgerType(value) {
    const key = toText(value).trim();
    return LEDGER_TYPE_LABELS[key] ? key : 'expense';
  }

  function ledgerTypeLabel(type) {
    return LEDGER_TYPE_LABELS[normalizeLedgerType(type)];
  }

  /** 账户类型 */
  const ACCOUNT_KINDS = [
    { key: 'cash', label: '现金' },
    { key: 'debit', label: '储蓄卡' },
    { key: 'credit', label: '信用卡' },
    { key: 'virtual', label: '虚拟账户' },
    { key: 'other', label: '其他' },
  ];

  const ACCOUNT_KIND_LABELS = {
    cash: '现金',
    debit: '储蓄卡',
    credit: '信用卡',
    virtual: '虚拟账户',
    other: '其他',
  };

  function normalizeAccountKind(value) {
    const key = toText(value).trim();
    return ACCOUNT_KIND_LABELS[key] ? key : 'cash';
  }

  function accountKindLabel(kind) {
    return ACCOUNT_KIND_LABELS[normalizeAccountKind(kind)];
  }

  /** 分类可选的底色（都取自现有中性色板，保持极简调性） */
  const CATEGORY_COLORS = [
    '#c2705a',
    '#b0692b',
    '#c09a3a',
    '#7a9a5e',
    '#4e9a6a',
    '#5a8fa0',
    '#5a7fb0',
    '#6a7f95',
    '#8a6fc0',
    '#b05a8a',
    '#a0855e',
    '#8b8f9a',
  ];

  const DEFAULT_EXPENSE_CATEGORIES = [
    { name: '餐饮', icon: '🍜', color: '#c2705a' },
    { name: '交通', icon: '🚌', color: '#5a7fb0' },
    { name: '购物', icon: '🛍️', color: '#b05a8a' },
    { name: '居家', icon: '🏠', color: '#7a9a5e' },
    { name: '娱乐', icon: '🎬', color: '#8a6fc0' },
    { name: '医疗', icon: '💊', color: '#c0453f' },
    { name: '教育', icon: '📚', color: '#5a8fa0' },
    { name: '通讯', icon: '📱', color: '#6a7f95' },
    { name: '人情', icon: '🎁', color: '#c08a4a' },
    { name: '旅行', icon: '✈️', color: '#4a90a0' },
    { name: '宠物', icon: '🐾', color: '#a0855e' },
    { name: '其他', icon: '📦', color: '#8b8f9a' },
  ];

  const DEFAULT_INCOME_CATEGORIES = [
    { name: '工资', icon: '💰', color: '#4e9a6a' },
    { name: '奖金', icon: '🏆', color: '#c09a3a' },
    { name: '兼职', icon: '🧾', color: '#5a8fb0' },
    { name: '理财', icon: '📈', color: '#4a8a8a' },
    { name: '红包', icon: '🧧', color: '#c0453f' },
    { name: '报销', icon: '🧮', color: '#7a8fa0' },
    { name: '退款', icon: '↩️', color: '#8a9a5e' },
    { name: '其他', icon: '📦', color: '#8b8f9a' },
  ];

  function createDefaultCategories(bookId, now = Date.now()) {
    const list = [];
    let order = 0;
    for (const [kind, presets] of [
      ['expense', DEFAULT_EXPENSE_CATEGORIES],
      ['income', DEFAULT_INCOME_CATEGORIES],
    ]) {
      for (const preset of presets) {
        order += 1;
        list.push(normalizeCategory({ ...preset, kind, bookId, order, builtin: true }, now));
      }
    }
    return list;
  }

  function createDefaultAccounts(bookId, now = Date.now()) {
    return [normalizeAccount({ name: '现金', kind: 'cash', bookId, order: 1, initialBalance: 0 }, now)];
  }

  /* --------------------------------------------------------- 记账：规整 */

  function normalizeBook(raw, now = Date.now()) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: toText(source.id).trim() || createId(),
      name: toText(source.name).trim().slice(0, 20) || '日常账本',
      createdAt: toTimestamp(source.createdAt, now),
    };
  }

  function normalizeCategory(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const color = toText(source.color).trim();
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      kind: normalizeLedgerType(source.kind) === 'income' ? 'income' : 'expense',
      name: toText(source.name).trim().slice(0, 12) || '未命名',
      icon: toText(source.icon).trim().slice(0, 4) || '📦',
      color: /^#[0-9a-f]{6}$/i.test(color) ? color : CATEGORY_COLORS[0],
      order: toTimestamp(source.order, now),
      builtin: Boolean(source.builtin),
    };
  }

  function normalizeAccount(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      name: toText(source.name).trim().slice(0, 12) || '现金',
      kind: normalizeAccountKind(source.kind),
      initialBalance: toMoney(source.initialBalance),
      order: toTimestamp(source.order, now),
    };
  }

  function normalizeBudget(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const scope = toText(source.scope).trim();
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      scope: scope === 'month-total' || !scope ? 'month-total' : scope,
      amount: toMoney(source.amount),
      enabled: source.enabled === undefined ? true : Boolean(source.enabled),
      updatedAt: toTimestamp(source.updatedAt, now),
    };
  }

  const FREQUENCIES = [
    { key: 'daily', label: '每天' },
    { key: 'weekly', label: '每周' },
    { key: 'monthly', label: '每月' },
    { key: 'yearly', label: '每年' },
  ];

  const FREQUENCY_UNITS = { daily: '天', weekly: '周', monthly: '个月', yearly: '年' };

  function normalizeFrequency(value) {
    const key = toText(value).trim();
    return FREQUENCY_UNITS[key] ? key : 'monthly';
  }

  function normalizeRecurring(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const time = toText(source.time).trim();
    const endDate = toText(source.endDate).trim();
    const dayOfMonth = Number(source.dayOfMonth);
    const dayOfWeek = Number(source.dayOfWeek);
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      name: toText(source.name).trim().slice(0, 16),
      type: normalizeLedgerType(source.type),
      amount: toMoney(source.amount),
      categoryId: toText(source.categoryId).trim(),
      accountId: toText(source.accountId).trim(),
      toAccountId: toText(source.toAccountId).trim(),
      note: toText(source.note).trim().slice(0, 60),
      time: TIME_KEY_RE.test(time) ? time : '08:00',
      frequency: normalizeFrequency(source.frequency),
      interval: Math.max(1, Math.min(60, Math.round(Number(source.interval) || 1))),
      dayOfMonth: Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : null,
      dayOfWeek: Number.isInteger(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6 ? dayOfWeek : null,
      startDate: isValidDateKey(source.startDate) ? source.startDate : toDateKey(now),
      endDate: isValidDateKey(endDate) ? endDate : '',
      lastGeneratedDate: isValidDateKey(source.lastGeneratedDate) ? source.lastGeneratedDate : '',
      enabled: source.enabled === undefined ? true : Boolean(source.enabled),
      createdAt: toTimestamp(source.createdAt, now),
    };
  }

  /** 记账记录：一笔交易一条 */
  function normalizeLedger(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const time = toText(source.time).trim();
    const createdAt = toTimestamp(source.createdAt, now);
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      type: normalizeLedgerType(source.type),
      amount: toMoney(source.amount),
      date: isValidDateKey(source.date) ? source.date : toDateKey(createdAt),
      time: TIME_KEY_RE.test(time) ? time : toTimeKey(createdAt),
      categoryId: toText(source.categoryId).trim(),
      accountId: toText(source.accountId).trim(),
      toAccountId: toText(source.toAccountId).trim(),
      note: toText(source.note).trim().slice(0, 60),
      ruleId: toText(source.ruleId).trim(),
      occurrenceKey: toText(source.occurrenceKey).trim(),
      createdAt,
      updatedAt: toTimestamp(source.updatedAt, createdAt),
    };
  }

  /** 金额为 0（或小于 0）的一笔视作空记录，保存时会被丢掉 */
  function isEmptyLedger(record) {
    return !record || !(Number(record.amount) > 0);
  }

  function formatMoney(value) {
    return toMoney(value).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  /** 日历格子用：金额太大时缩写成 1.2k / 3.4w */
  function formatMoneyShort(value) {
    const amount = toMoney(value);
    if (amount === 0) return '';
    const abs = Math.abs(amount);
    if (abs >= 10000) return `${(amount / 10000).toFixed(abs >= 100000 ? 0 : 1)}w`;
    if (abs >= 1000) return `${(amount / 1000).toFixed(1)}k`;
    return String(amount);
  }

  /* --------------------------------------------------------- 记账：统计 */

  /** 记账排序：默认最新的一笔在前（先比日期，再比时间） */
  function sortLedger(list, mode = 'desc') {
    const dir = mode === 'asc' ? 1 : -1;
    return [...(list || [])].sort((a, b) => {
      const left = `${(a && a.date) || ''} ${(a && a.time) || ''}`;
      const right = `${(b && b.date) || ''} ${(b && b.time) || ''}`;
      if (left !== right) return (left < right ? -1 : 1) * dir;
      return (((a && a.createdAt) || 0) - ((b && b.createdAt) || 0)) * dir;
    });
  }

  /** 合计：转账不计入收支 */
  function sumLedger(list) {
    let income = 0;
    let expense = 0;
    let count = 0;
    let transferCount = 0;
    for (const record of list || []) {
      const amount = Number(record && record.amount) || 0;
      const type = normalizeLedgerType(record && record.type);
      if (type === 'transfer') {
        transferCount += 1;
        continue;
      }
      if (type === 'income') income += amount;
      else expense += amount;
      count += 1;
    }
    return {
      income: toMoney(income),
      expense: toMoney(expense),
      net: toMoney(income - expense),
      count,
      transferCount,
    };
  }

  function monthLedgerTotals(ledger, year, month) {
    const prefix = monthKey(year, month);
    const inMonth = (ledger || []).filter((record) => toText(record && record.date).startsWith(prefix));
    return { ...sumLedger(inMonth), days: new Set(inMonth.map((record) => record.date)).size };
  }

  function yearLedgerTotals(ledger, year) {
    const prefix = `${year}-`;
    const inYear = (ledger || []).filter((record) => toText(record && record.date).startsWith(prefix));
    return { ...sumLedger(inYear), days: new Set(inYear.map((record) => record.date)).size };
  }

  function ledgerTotals(ledger) {
    return sumLedger(ledger);
  }

  function dayLedgerTotals(list, date) {
    return sumLedger((list || []).filter((record) => record && record.date === date));
  }

  /** 日历「记账模式」用：某个月每一天的支出 / 收入 */
  function dayLedgerMap(list, year, month) {
    const prefix = monthKey(year, month);
    const map = new Map();
    for (const record of list || []) {
      if (!record || !toText(record.date).startsWith(prefix)) continue;
      const cell = map.get(record.date) || { expense: 0, income: 0, count: 0 };
      const type = normalizeLedgerType(record.type);
      const amount = Number(record.amount) || 0;
      if (type === 'expense') cell.expense += amount;
      else if (type === 'income') cell.income += amount;
      cell.count += 1;
      map.set(record.date, cell);
    }
    for (const cell of map.values()) {
      cell.expense = toMoney(cell.expense);
      cell.income = toMoney(cell.income);
    }
    return map;
  }

  /** 按日期分组，每组带当天支出 / 收入合计 */
  function groupLedger(list, mode = 'desc') {
    const groups = new Map();
    for (const record of sortLedger(list, mode)) {
      if (!groups.has(record.date)) groups.set(record.date, []);
      groups.get(record.date).push(record);
    }
    return [...groups.entries()].map(([date, items]) => {
      const totals = sumLedger(items);
      return { date, items, income: totals.income, expense: totals.expense, net: totals.net };
    });
  }

  function categoryIndex(categories) {
    const map = new Map();
    for (const item of categories || []) if (item && item.id) map.set(item.id, item);
    return map;
  }

  /** 分类占比 / 排行 */
  function categoryStats(list, kind, categories) {
    const wanted = kind ? normalizeLedgerType(kind) : '';
    const rows = new Map();
    let total = 0;
    for (const record of list || []) {
      const type = normalizeLedgerType(record && record.type);
      if (type === 'transfer') continue;
      if (wanted && type !== wanted) continue;
      const id = toText(record.categoryId);
      const amount = Number(record.amount) || 0;
      const row = rows.get(id) || { categoryId: id, amount: 0, count: 0 };
      row.amount += amount;
      row.count += 1;
      rows.set(id, row);
      total += amount;
    }
    const byId = categoryIndex(categories);
    return [...rows.values()]
      .map((row) => {
        const category = byId.get(row.categoryId) || null;
        return {
          categoryId: row.categoryId,
          name: category ? category.name : '未分类',
          icon: category ? category.icon : '📦',
          color: category ? category.color : CATEGORY_COLORS[11],
          amount: toMoney(row.amount),
          count: row.count,
          ratio: total > 0 ? row.amount / total : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  /** 账户余额 = 初始余额 + 收入 − 支出 ± 转账 */
  function accountBalances(accounts, ledger) {
    const map = new Map();
    for (const account of accounts || []) map.set(account.id, Number(account.initialBalance) || 0);
    const bump = (id, delta) => {
      if (!id || !map.has(id)) return;
      map.set(id, map.get(id) + delta);
    };
    for (const record of ledger || []) {
      const amount = Number(record && record.amount) || 0;
      const type = normalizeLedgerType(record && record.type);
      if (type === 'income') bump(record.accountId, amount);
      else if (type === 'expense') bump(record.accountId, -amount);
      else if (type === 'transfer') {
        bump(record.accountId, -amount);
        bump(record.toAccountId, amount);
      }
    }
    for (const [id, value] of map) map.set(id, toMoney(value));
    return map;
  }

  function budgetProgress(budget, spent) {
    const amount = toMoney(budget && budget.amount);
    const used = toMoney(spent);
    return {
      amount,
      spent: used,
      remaining: toMoney(amount - used),
      ratio: amount > 0 ? used / amount : 0,
      over: amount > 0 && used > amount,
      enabled: !budget || budget.enabled !== false,
    };
  }

  /** 最近 N 个月的收支，统计页柱状图用 */
  function monthlyLedgerTotals(ledger, months = 6, today = todayKey()) {
    const todayDate = parseDateKey(today) || new Date();
    const result = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      const date = new Date(todayDate.getFullYear(), todayDate.getMonth() - i, 1);
      const totals = monthLedgerTotals(ledger, date.getFullYear(), date.getMonth());
      result.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        label: `${date.getMonth() + 1}月`,
        income: totals.income,
        expense: totals.expense,
        net: totals.net,
      });
    }
    return result;
  }

  /* --------------------------------------------------------- 周期记账 */

  /** 一条周期规则从 startDate 到 today 之间所有「应该发生」的日期（升序） */
  function recurringDates(rule, today = todayKey()) {
    if (!rule || rule.enabled === false) return [];
    const start = isValidDateKey(rule.startDate) ? rule.startDate : today;
    const end = isValidDateKey(rule.endDate) && rule.endDate < today ? rule.endDate : today;
    if (start > end) return [];
    const interval = Math.max(1, Math.min(60, Math.round(Number(rule.interval) || 1)));
    const dates = [];
    const keep = (key) => {
      if (key >= start && key <= end) dates.push(key);
    };
    const startDate = parseDateKey(start) || new Date();

    if (rule.frequency === 'daily') {
      let cursor = start;
      for (let i = 0; i < 400 && cursor && cursor <= end; i += 1) {
        keep(cursor);
        cursor = shiftDateKey(cursor, interval);
      }
    } else if (rule.frequency === 'weekly') {
      const want = Number.isInteger(rule.dayOfWeek) ? rule.dayOfWeek : startDate.getDay();
      const first = new Date(startDate);
      first.setDate(first.getDate() + ((want - first.getDay() + 7) % 7));
      let cursor = toDateKey(first);
      for (let i = 0; i < 400 && cursor && cursor <= end; i += 1) {
        keep(cursor);
        cursor = shiftDateKey(cursor, 7 * interval);
      }
    } else if (rule.frequency === 'yearly') {
      const day = Number.isInteger(rule.dayOfMonth) ? rule.dayOfMonth : startDate.getDate();
      const month = startDate.getMonth();
      let year = startDate.getFullYear();
      for (let i = 0; i < 200; i += 1) {
        const last = new Date(year, month + 1, 0).getDate();
        const key = `${year}-${pad2(month + 1)}-${pad2(Math.min(day, last))}`;
        if (key > end) break;
        keep(key);
        year += interval;
      }
    } else {
      const day = Number.isInteger(rule.dayOfMonth) ? rule.dayOfMonth : startDate.getDate();
      let year = startDate.getFullYear();
      let month = startDate.getMonth();
      for (let i = 0; i < 400; i += 1) {
        const last = new Date(year, month + 1, 0).getDate();
        const key = `${year}-${pad2(month + 1)}-${pad2(Math.min(day, last))}`;
        if (key > end) break;
        keep(key);
        month += interval;
        year += Math.floor(month / 12);
        month %= 12;
      }
    }
    return dates;
  }

  /** 还没生成过的那几次 */
  function pendingRecurringDates(rule, today = todayKey()) {
    const last = isValidDateKey(rule && rule.lastGeneratedDate) ? rule.lastGeneratedDate : '';
    return recurringDates(rule, today).filter((date) => !last || date > last);
  }

  function frequencyLabel(rule) {
    const unit = FREQUENCY_UNITS[normalizeFrequency(rule && rule.frequency)] || '个月';
    const interval = Math.max(1, Math.round(Number((rule && rule.interval) || 1)));
    return interval === 1 ? `每${unit}` : `每 ${interval} ${unit}`;
  }

  /* ------------------------------------------------------------- 待办 */

  const TODO_PRIORITIES = [
    { key: 0, label: '普通' },
    { key: 1, label: '重要' },
    { key: 2, label: '紧急' },
  ];

  const PRIORITY_LABELS = { 0: '普通', 1: '重要', 2: '紧急' };

  function normalizePriority(value) {
    const number = Math.round(Number(value));
    return number === 1 || number === 2 ? number : 0;
  }

  function priorityLabel(value) {
    return PRIORITY_LABELS[normalizePriority(value)];
  }

  function normalizeTodo(raw, now = Date.now()) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const createdAt = toTimestamp(source.createdAt, now);
    const done = Boolean(source.done);
    const due = toText(source.dueDate).trim();
    return {
      id: toText(source.id).trim() || createId(),
      text: toText(source.text).trim().slice(0, 120),
      note: toText(source.note).trim().slice(0, 200),
      priority: normalizePriority(source.priority),
      dueDate: isValidDateKey(due) ? due : '',
      groupId: toText(source.groupId).trim(),
      order: toTimestamp(source.order, createdAt),
      done,
      doneAt: done ? toTimestamp(source.doneAt, now) : null,
      createdAt,
    };
  }

  function normalizeTodoGroup(raw, now = Date.now()) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: toText(source.id).trim() || createId(),
      name: toText(source.name).trim().slice(0, 16) || '未命名分组',
      order: toTimestamp(source.order, now),
      createdAt: toTimestamp(source.createdAt, now),
    };
  }

  /** 待办排序：未完成在前、组内按手动顺序；已完成按完成时间倒序归档 */
  function sortTodos(list) {
    return [...(list || [])].sort((a, b) => {
      if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
      if (a.done) return (b.doneAt || 0) - (a.doneAt || 0);
      const left = Number(a.order) || 0;
      const right = Number(b.order) || 0;
      if (left !== right) return left - right;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function sortTodoGroups(list) {
    return [...(list || [])].sort(
      (a, b) => (a.order || 0) - (b.order || 0) || (a.createdAt || 0) - (b.createdAt || 0),
    );
  }

  /** 日历「待办模式」用：某个月每一天还没完成的待办数量 */
  function todoDueMap(todos, year, month) {
    const prefix = monthKey(year, month);
    const map = new Map();
    for (const todo of todos || []) {
      if (!todo || todo.done || !isValidDateKey(todo.dueDate)) continue;
      if (!toText(todo.dueDate).startsWith(prefix)) continue;
      map.set(todo.dueDate, (map.get(todo.dueDate) || 0) + 1);
    }
    return map;
  }

  function todoStats(todos, today = todayKey()) {
    let pending = 0;
    let done = 0;
    let overdue = 0;
    for (const todo of todos || []) {
      if (todo.done) {
        done += 1;
        continue;
      }
      pending += 1;
      if (isValidDateKey(todo.dueDate) && todo.dueDate < today) overdue += 1;
    }
    return { pending, done, overdue, total: pending + done };
  }

  /* ------------------------------------------------------------ 日历网格 */

  function monthKey(year, month) {
    return `${year}-${pad2(month + 1)}`;
  }

  function addMonths(year, month, delta) {
    const date = new Date(year, month + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
  }

  /** 周一开头的 6×7 月历（不足整行的最后一整行会被裁掉）。 */
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const cursor = new Date(year, month, 1 - offset);
    const weeks = [];
    for (let w = 0; w < 6; w += 1) {
      const week = [];
      for (let d = 0; d < 7; d += 1) {
        week.push({
          date: toDateKey(cursor),
          day: cursor.getDate(),
          inMonth: cursor.getMonth() === month && cursor.getFullYear() === year,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    if (weeks.length === 6 && weeks[5].every((cell) => !cell.inMonth)) weeks.pop();
    return weeks;
  }

  function countByDate(entries) {
    const counts = new Map();
    for (const entry of entries || []) {
      if (!entry || !entry.date) continue;
      counts.set(entry.date, (counts.get(entry.date) || 0) + 1);
    }
    return counts;
  }

  /** 统计页的热力图：按周分列，每列周一到周日。 */
  /** 热力图用的连续天数：从旧到新排列，最后一个一定是今天。 */
  function activityDays(entries, options) {
    const config = options || {};
    const count = config.days || 91;
    const today = config.today || todayKey();
    const counts = countByDate(entries);
    const days = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const key = shiftDateKey(today, -offset);
      if (!key) continue;
      days.push({ date: key, count: counts.get(key) || 0, today: key === today });
    }
    return days;
  }

  function activityWeeks(entries, options) {
    const config = options || {};
    const weekCount = config.weeks || 13;
    const today = config.today || todayKey();
    const todayDate = parseDateKey(today) || new Date();
    const monday = new Date(todayDate);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const counts = countByDate(entries);
    const weeks = [];
    for (let w = weekCount - 1; w >= 0; w -= 1) {
      const days = [];
      for (let d = 0; d < 7; d += 1) {
        const date = new Date(monday);
        date.setDate(monday.getDate() - w * 7 + d);
        const key = toDateKey(date);
        days.push({
          date: key,
          day: date.getDate(),
          month: date.getMonth(),
          count: counts.get(key) || 0,
          future: date.getTime() > todayDate.getTime(),
          today: key === today,
        });
      }
      weeks.push(days);
    }
    return weeks;
  }

  /* ---------------------------------------------------------------- 条目 */

  function createId() {
    const cryptoObj = root.crypto;
    if (cryptoObj && cryptoObj.randomUUID) return cryptoObj.randomUUID();
    return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function toText(value) {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : String(value);
  }

  function toTimestamp(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        const numeric = Number(trimmed);
        // 10 位当秒，13 位当毫秒
        return trimmed.length <= 10 ? numeric * 1000 : numeric;
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return fallback;
  }

  function normalizeTags(input) {
    const list = Array.isArray(input) ? input : toText(input).split(/[,，;；、|\n]+/);
    const seen = new Set();
    const tags = [];
    for (const item of list) {
      // 先去空白再剥掉 # 前缀，顺序反了会把 " #读书" 当成标签名
      const tag = toText(item).trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ');
      if (!tag) continue;
      const dedupeKey = tag.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      tags.push(tag.slice(0, 24));
      if (tags.length >= 12) break;
    }
    return tags;
  }

  function normalizeEntry(raw, now = Date.now()) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const createdAt = toTimestamp(source.createdAt, now);
    const updatedAt = Math.max(toTimestamp(source.updatedAt, createdAt), createdAt);
    const id = toText(source.id).trim() || createId();
    const date = isValidDateKey(source.date) ? source.date : toDateKey(createdAt);
    const time = TIME_KEY_RE.test(toText(source.time)) ? source.time : toTimeKey(createdAt);
    return {
      id,
      date,
      time,
      title: toText(source.title).slice(0, 200),
      content: toText(source.content),
      tags: normalizeTags(source.tags),
      pinned: Boolean(source.pinned),
      media: Array.isArray(source.media) ? source.media.filter((item) => typeof item === 'string').slice(0, 24) : [],
      source: toText(source.source).slice(0, 40),
      createdAt,
      updatedAt,
    };
  }

  function createEntry(now = Date.now(), id = createId()) {
    const date = new Date(now);
    return {
      id,
      date: toDateKey(date),
      time: toTimeKey(date),
      title: '',
      content: '',
      tags: [],
      pinned: false,
      media: [],
      source: '',
      createdAt: now,
      updatedAt: now,
    };
  }

  function isEmptyEntry(entry) {
    const hasMedia = entry && Array.isArray(entry.media) && entry.media.length > 0;
    return !toText(entry && entry.title).trim() && !toText(entry && entry.content).trim() && !hasMedia;
  }

  function entryTitle(entry) {
    const title = toText(entry && entry.title).trim();
    if (title) return title;
    const line = toText(entry && entry.content)
      .split('\n')
      .map((item) => item.replace(/^#{1,6}\s*/, '').replace(/^[>*\-+\d.]+\s*/, '').trim())
      .find(Boolean);
    return line ? line.slice(0, 40) : '无标题';
  }

  /** 去掉 Markdown 记号，用于卡片预览。 */
  function stripMarkdown(text) {
    return toText(text)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}[-*+]\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function entryExcerpt(entry, max = 80) {
    const content = toText(entry && entry.content);
    const plain = stripMarkdown(content);
    if (!plain) return '';
    const title = toText(entry && entry.title).trim();
    const text = title && plain.startsWith(title) ? plain.slice(title.length).trim() : plain;
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function wordCount(text) {
    const source = toText(text);
    if (!source.trim()) return 0;
    const cjk = (source.match(CJK_RE) || []).length;
    const latin = (source.replace(CJK_RE, ' ').match(/[A-Za-z0-9_'’-]+/g) || []).length;
    return cjk + latin;
  }

  /* ------------------------------------------------------------ 查询排序 */

  function matchesQuery(entry, query) {
    const needle = toText(query).trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      entry && entry.title,
      entry && entry.content,
      entry && entry.date,
      toText(entry && entry.tags ? entry.tags.join(' ') : ''),
    ];
    return haystack.some((field) => toText(field).toLowerCase().includes(needle));
  }

  function sortEntries(entries, mode = 'desc') {
    const factor = mode === 'asc' ? 1 : -1;
    return [...(entries || [])].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? -factor : factor;
      // 同一天里按「创建时间」排，而不是「更新时间」——否则重新编辑一篇旧日记就会
      // 因为 updatedAt 被刷新而顶到最前面，位置就乱了
      if ((a.createdAt || 0) !== (b.createdAt || 0)) return ((a.createdAt || 0) - (b.createdAt || 0)) * factor;
      return toText(a.id).localeCompare(toText(b.id));
    });
  }

  function filterEntries(entries, options) {
    const config = options || {};
    const query = config.query || '';
    const tag = config.tag || null;
    const filter = config.filter || 'all';
    const today = config.today || todayKey();
    const sort = config.sort || 'desc';
    const result = [];
    for (const entry of entries || []) {
      if (!matchesQuery(entry, query)) continue;
      if (tag && !(entry.tags || []).some((item) => item.toLowerCase() === String(tag).toLowerCase())) continue;
      if (filter === 'today' && entry.date !== today) continue;
      if (filter === 'pinned' && !entry.pinned) continue;
      if (filter === 'media' && !(entry.media || []).length) continue;
      if (filter === 'week') {
        const diff = dayDiff(entry.date, today);
        if (!(diff <= 0 && diff >= -6)) continue;
      }
      result.push(entry);
    }
    return sortEntries(result, sort);
  }

  function groupByDate(entries, sort = 'desc') {
    const groups = new Map();
    for (const entry of sortEntries(entries, sort)) {
      if (!groups.has(entry.date)) groups.set(entry.date, []);
      groups.get(entry.date).push(entry);
    }
    return [...groups.entries()].map(([date, items]) => ({ date, entries: items }));
  }

  function collectTags(entries, limit = 40) {
    const counts = new Map();
    for (const entry of entries || []) {
      for (const tag of (entry && entry.tags) || []) {
        const key = tag.toLowerCase();
        const current = counts.get(key);
        if (current) current.count += 1;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()]
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
      .slice(0, limit);
  }

  /* ---------------------------------------------------------------- 统计 */

  function computeStreak(entries, today = todayKey()) {
    const days = new Set((entries || []).map((entry) => entry.date).filter(Boolean));
    if (!days.size) return { current: 0, longest: 0, days: 0, since: null };

    const yesterday = shiftDateKey(today, -1);
    let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
    let current = 0;
    while (cursor && days.has(cursor)) {
      current += 1;
      cursor = shiftDateKey(cursor, -1);
    }

    const sorted = [...days].sort();
    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i += 1) {
      if (dayDiff(sorted[i], sorted[i - 1]) === 1) run += 1;
      else run = 1;
      if (run > longest) longest = run;
    }

    return { current, longest, days: sorted.length, since: sorted[0] };
  }

  /** 每月的记录分布，统计页用。 */
  function monthlyCounts(entries, months = 6, today = todayKey()) {
    const todayDate = parseDateKey(today) || new Date();
    const counts = countByDate(entries);
    const result = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      const date = new Date(todayDate.getFullYear(), todayDate.getMonth() - i, 1);
      const total = [...counts.entries()].reduce((sum, [key, value]) => {
        const parsed = parseDateKey(key);
        if (!parsed) return sum;
        return parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth() ? sum + value : sum;
      }, 0);
      result.push({ year: date.getFullYear(), month: date.getMonth(), label: `${date.getMonth() + 1}月`, count: total });
    }
    return result;
  }

  /* ------------------------------------------------------------ 导入 / 导出 */

  function utf8Length(text) {
    let bytes = 0;
    for (const char of toText(text)) {
      const code = char.codePointAt(0);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code <= 0xffff) bytes += 3;
      else bytes += 4;
    }
    return bytes;
  }

  /** 导出用的集合字段（v3 起备份里还会带上记账与待办） */
  const EXPORT_COLLECTIONS = ['books', 'categories', 'accounts', 'budgets', 'recurring', 'ledger', 'todos', 'todoGroups'];

  function buildExportPayload(entries, options) {
    const config = options || {};
    const list = sortEntries(entries, 'asc');
    const payload = {
      app: '拾光日记',
      format: 'diary-json',
      version: 3,
      exportedAt: new Date(config.now || Date.now()).toISOString(),
      count: list.length,
      entries: list.map((entry) => normalizeEntry(entry, entry.createdAt || Date.now())),
    };
    for (const key of EXPORT_COLLECTIONS) {
      if (Array.isArray(config[key]) && config[key].length) payload[key] = config[key];
    }
    return payload;
  }

  function parseImport(text) {
    let data;
    try {
      data = JSON.parse(toText(text));
    } catch (error) {
      throw new Error('文件不是有效的 JSON');
    }
    const raw = Array.isArray(data) ? data : Array.isArray(data && data.entries) ? data.entries : null;
    if (!raw) throw new Error('JSON 里找不到 entries 列表');
    const entries = [];
    let skipped = 0;
    for (const item of raw) {
      const entry = normalizeEntry(item);
      if (isEmptyEntry(entry)) {
        skipped += 1;
        continue;
      }
      entries.push(entry);
    }
    const result = { entries, skipped, total: raw.length, version: Number(data && data.version) || 2 };
    for (const key of EXPORT_COLLECTIONS) {
      if (Array.isArray(data && data[key])) result[key] = data[key];
    }
    return result;
  }

  /** 记账流水导出成 CSV（Excel 能直接打开） */
  function ledgerToCsv(ledger, options) {
    const config = options || {};
    const categories = categoryIndex(config.categories);
    const accounts = categoryIndex(config.accounts);
    const books = categoryIndex(config.books);
    const esc = (value) => {
      const text = toText(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows = [['日期', '时间', '类型', '金额', '分类', '账户', '转入账户', '备注', '账本']];
    for (const record of sortLedger(ledger, 'asc')) {
      const category = categories.get(record.categoryId);
      const account = accounts.get(record.accountId);
      const toAccount = accounts.get(record.toAccountId);
      rows.push([
        record.date,
        record.time,
        ledgerTypeLabel(record.type),
        String(record.amount),
        category ? category.name : '',
        account ? account.name : '',
        toAccount ? toAccount.name : '',
        record.note,
        (books.get(record.bookId) || {}).name || '',
      ]);
    }
    return rows.map((row) => row.map(esc).join(',')).join('\r\n');
  }

  function toMarkdown(entries, options) {
    const config = options || {};
    const list = sortEntries(entries, 'asc');
    const title = config.title || '我的日记';
    const lines = [
      `# ${title}`,
      '',
      `> 导出时间：${formatDateTime(config.now || Date.now())}　·　共 ${list.length} 篇`,
      '',
    ];
    for (const entry of list) {
      lines.push('---', '', `## ${entryTitle(entry)}`, '');
      const meta = [`📅 ${entry.date}${entry.time ? ` ${entry.time}` : ''}`];
      if (entry.pinned) meta.push('⭐ 收藏');
      if ((entry.media || []).length) meta.push(`🖼 ${entry.media.length} 张图片`);
      lines.push(`*${meta.join('　·　')}*`, '');
      if (entry.tags.length) lines.push(entry.tags.map((tag) => `#${tag}`).join(' '), '');
      if (entry.content.trim()) lines.push(entry.content.trim(), '');
    }
    return lines.join('\n');
  }

  function toPlainText(entries) {
    const list = sortEntries(entries, 'asc');
    return list
      .map((entry) => {
        const head = [`【${entry.date}${entry.time ? ` ${entry.time}` : ''}】${entryTitle(entry)}`];
        if (entry.content.trim()) head.push(entry.content.trim());
        return head.join('\n');
      })
      .join('\n\n');
  }

  /* ------------------------------------------------------------- Markdown */

  function escapeHtml(value) {
    return toText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const TOKEN = '\u0000';

  function renderInline(source, tokens) {
    let text = source;

    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
      tokens.push(`<code>${code}</code>`);
      return `${TOKEN}${tokens.length - 1}${TOKEN}`;
    });

    // 只允许 http/https 链接，挡掉 javascript: 之类
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, href) => {
      tokens.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`);
      return `${TOKEN}${tokens.length - 1}${TOKEN}`;
    });

    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, prefix, url) => {
      tokens.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
      return `${prefix}${TOKEN}${tokens.length - 1}${TOKEN}`;
    });

    text = text
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<em>$2</em>');

    return text.replace(new RegExp(`${TOKEN}(\\d+)${TOKEN}`, 'g'), (_, index) => tokens[Number(index)] || '');
  }

  /** 极简 Markdown → HTML：先转义再渲染，天然不会执行用户输入的标签。 */
  function renderMarkdown(input) {
    const source = toText(input).replace(/\r\n?/g, '\n');
    const tokens = [];
    const out = [];
    let list = null;
    let quoting = false;

    const closeBlocks = () => {
      if (list) {
        out.push(`</${list}>`);
        list = null;
      }
      if (quoting) {
        out.push('</blockquote>');
        quoting = false;
      }
    };

    for (const rawLine of source.split('\n')) {
      const line = escapeHtml(rawLine.trim());
      if (!line) {
        closeBlocks();
        continue;
      }
      let match;
      if ((match = /^(#{1,6})\s+(.*)$/.exec(line))) {
        closeBlocks();
        const level = Math.min(match[1].length + 2, 6);
        out.push(`<h${level}>${renderInline(match[2], tokens)}</h${level}>`);
        continue;
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
        closeBlocks();
        out.push('<hr>');
        continue;
      }
      if ((match = /^[-*+]\s+(.*)$/.exec(line))) {
        if (list !== 'ul') {
          closeBlocks();
          out.push('<ul>');
          list = 'ul';
        }
        out.push(`<li>${renderInline(match[1], tokens)}</li>`);
        continue;
      }
      if ((match = /^\d+[.)]\s+(.*)$/.exec(line))) {
        if (list !== 'ol') {
          closeBlocks();
          out.push('<ol>');
          list = 'ol';
        }
        out.push(`<li>${renderInline(match[1], tokens)}</li>`);
        continue;
      }
      if ((match = /^&gt;\s?(.*)$/.exec(line))) {
        if (!quoting) {
          closeBlocks();
          out.push('<blockquote>');
          quoting = true;
        }
        out.push(`<p>${renderInline(match[1], tokens)}</p>`);
        continue;
      }
      closeBlocks();
      out.push(`<p>${renderInline(line, tokens)}</p>`);
    }

    closeBlocks();
    return out.join('\n');
  }

  Diary.model = {
    ACCOUNT_KINDS,
    CATEGORY_COLORS,
    DEFAULT_EXPENSE_CATEGORIES,
    DEFAULT_INCOME_CATEGORIES,
    FREQUENCIES,
    LEDGER_TYPES,
    MONTH_LABELS,
    TODO_PRIORITIES,
    WEEKDAY_FULL,
    accountBalances,
    accountKindLabel,
    addMonths,
    activityWeeks,
    activityDays,
    buildExportPayload,
    budgetProgress,
    cardDate,
    categoryIndex,
    categoryStats,
    collectTags,
    computeStreak,
    countByDate,
    createDefaultAccounts,
    createDefaultCategories,
    createEntry,
    createId,
    dateLabel,
    dayLedgerTotals,
    dayLedgerMap,
    dayDiff,
    entryExcerpt,
    entryTitle,
    escapeHtml,
    filterEntries,
    formatBytes,
    formatDateTime,
    formatMoney,
    formatMoneyShort,
    frequencyLabel,
    groupByDate,
    groupLedger,
    headerDate,
    isEmptyLedger,
    isEmptyEntry,
    isValidDateKey,
    ledgerToCsv,
    ledgerTotals,
    ledgerTypeLabel,
    matchesQuery,
    monthLedgerTotals,
    monthlyLedgerTotals,
    monthGrid,
    monthKey,
    monthlyCounts,
    normalizeAccount,
    normalizeAccountKind,
    normalizeBook,
    normalizeBudget,
    normalizeCategory,
    normalizeFrequency,
    normalizeLedger,
    normalizeLedgerType,
    normalizePriority,
    normalizeRecurring,
    normalizeEntry,
    normalizeTags,
    normalizeTodo,
    normalizeTodoGroup,
    parseDateKey,
    parseImport,
    pendingRecurringDates,
    priorityLabel,
    recurringDates,
    renderMarkdown,
    shiftDateKey,
    sortEntries,
    sortLedger,
    sortTodoGroups,
    sortTodos,
    stripMarkdown,
    toDateKey,
    toMarkdown,
    toMoney,
    toPlainText,
    toTimeKey,
    todayKey,
    todoDueMap,
    todoStats,
    utf8Length,
    wordCount,
    yearLedgerTotals,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
