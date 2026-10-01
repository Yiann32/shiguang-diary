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
    { name: '约稿', icon: '🎨', color: '#8a6fc0' },
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
    { name: '约稿收入', icon: '🖌️', color: '#5a8fb0' },
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
      payableId: toText(source.payableId).trim(),
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
    const time = toText(source.dueTime).trim();
    const dueTime = TIME_KEY_RE.test(time) ? time : '';
    return {
      id: toText(source.id).trim() || createId(),
      text: toText(source.text).trim().slice(0, 120),
      note: toText(source.note).trim().slice(0, 200),
      priority: normalizePriority(source.priority),
      // 有时间就必须有日期：只填了时间就落到今天
      dueDate: isValidDateKey(due) ? due : dueTime ? toDateKey(now) : '',
      dueTime,
      groupId: toText(source.groupId).trim(),
      receivableId: toText(source.receivableId).trim(),
      order: toTimestamp(source.order, createdAt),
      done,
      doneAt: done ? toTimestamp(source.doneAt, now) : null,
      createdAt,
    };
  }

  /** 某一天的待办：有时间的按时间排前面，没时间的按手动顺序 */
  function sortTodosForDay(list, mode = 'pending') {
    return [...(list || [])].sort((a, b) => {
      const leftTime = toText(a && a.dueTime);
      const rightTime = toText(b && b.dueTime);
      if (Boolean(leftTime) !== Boolean(rightTime)) return leftTime ? -1 : 1;
      if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
      if (mode === 'done') return (b.doneAt || 0) - (a.doneAt || 0);
      return (Number(a.order) || 0) - (Number(b.order) || 0) || (b.createdAt || 0) - (a.createdAt || 0);
    });
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
      if (!todo || !isValidDateKey(todo.dueDate)) continue;
      if (!toText(todo.dueDate).startsWith(prefix)) continue;
      const cell = map.get(todo.dueDate) || { pending: 0, done: 0, total: 0 };
      if (todo.done) cell.done += 1;
      else cell.pending += 1;
      cell.total += 1;
      map.set(todo.dueDate, cell);
    }
    return map;
  }

  /** 统计范围的时间边界（含今天；「近 7 天」不把未来的记录算进来） */
  function todoRangeBounds(range, today) {
    const todayDate = parseDateKey(today) || new Date();
    if (range === 'week') {
      const start = new Date(todayDate);
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      const end = new Date(todayDate);
      end.setHours(23, 59, 59, 999);
      return { from: start.getTime(), to: end.getTime() };
    }
    if (range === 'month') {
      return {
        from: new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).getTime(),
        to: new Date(todayDate.getFullYear(), todayDate.getMonth() + 1, 0, 23, 59, 59, 999).getTime(),
      };
    }
    return { from: 0, to: Infinity };
  }

  /**
   * 打卡式的分组完成统计：每个分组完成了多少次。
   * 没分组的归「默认清单」；分组被删掉的成员也算默认。
   */
  function todoGroupStats(todos, groups, options) {
    const config = options || {};
    const range = config.range || 'all';
    const today = config.today || todayKey();
    const { from, to } = todoRangeBounds(range, today);
    const nameOf = new Map((groups || []).filter((g) => g && g.id).map((g) => [g.id, g.name]));

    const rows = new Map();
    for (const id of nameOf.keys()) rows.set(id, { groupId: id, name: nameOf.get(id), count: 0 });
    rows.set('', { groupId: '', name: '默认清单', count: 0 });

    let total = 0;
    for (const todo of todos || []) {
      if (!todo || !todo.done) continue;
      const at = Number(todo.doneAt) || 0;
      if (!at || at < from || at > to) continue;
      const groupId = todo.groupId && nameOf.has(todo.groupId) ? todo.groupId : '';
      const row = rows.get(groupId);
      if (!row) continue;
      row.count += 1;
      total += 1;
    }

    const list = [...rows.values()].filter((row) => row.groupId || row.count > 0);
    const max = Math.max(1, ...list.map((row) => row.count));
    return {
      total,
      rows: list
        .map((row) => ({ ...row, ratio: row.count / max }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN')),
    };
  }

  /** 已完成的待办按「完成那天」倒序分组，组内按完成时间倒序 */
  function todoDoneByDay(todos) {
    const groups = new Map();
    for (const todo of todos || []) {
      if (!todo || !todo.done) continue;
      const date = toDateKey(Number(todo.doneAt) || Date.now());
      if (!date) continue;
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(todo);
    }
    return [...groups.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, items]) => ({
        date,
        items: items.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
      }));
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

  /* --------------------------------------------------------- 待收款项 */

  /**
   * 待收款项（预计收入）：一笔约稿的应收。
   * `dueDate` 可以是空字符串 —— 代表「不知道什么时候能收到」，
   * 这类金额要单独统计，不能混进「本月预计收到」。
   */
  function normalizeReceivable(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const due = toText(source.dueDate).trim();
    const createdAt = toTimestamp(source.createdAt, now);
    const amount = toMoney(source.amount);
    const received = Math.min(toMoney(source.received), amount);
    const settled = received >= amount && amount > 0;
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      client: toText(source.client).trim().slice(0, 20),
      title: toText(source.title).trim().slice(0, 40),
      amount,
      received,
      dueDate: isValidDateKey(due) ? due : '',
      accountId: toText(source.accountId).trim(),
      note: toText(source.note).trim().slice(0, 60),
      settledAt: settled ? toTimestamp(source.settledAt, now) : null,
      createdAt,
      updatedAt: toTimestamp(source.updatedAt, createdAt),
    };
  }

  /** 还差多少没收到 */
  function receivableRemaining(item) {
    if (!item) return 0;
    return toMoney(Math.max(0, (Number(item.amount) || 0) - (Number(item.received) || 0)));
  }

  function isReceivableSettled(item) {
    return receivableRemaining(item) <= 0 && Number(item && item.amount) > 0;
  }

  /** open（一分没收到）/ partial（收了一部分）/ settled（已结清） */
  function receivableStatus(item) {
    if (isReceivableSettled(item)) return 'settled';
    return Number(item && item.received) > 0 ? 'partial' : 'open';
  }

  function receivableStatusLabel(item) {
    const status = receivableStatus(item);
    if (status === 'settled') return '已结清';
    return status === 'partial' ? '部分收到' : '未收到';
  }

  /** 未结清的排前面；然后按约定到账日（没写日期的排最后），最后按创建时间倒序 */
  function sortReceivables(list) {
    return [...(list || [])].sort((a, b) => {
      const leftDone = isReceivableSettled(a);
      const rightDone = isReceivableSettled(b);
      if (leftDone !== rightDone) return leftDone ? 1 : -1;
      const leftDate = toText(a && a.dueDate);
      const rightDate = toText(b && b.dueDate);
      if (leftDate !== rightDate) {
        if (!leftDate) return 1;
        if (!rightDate) return -1;
        return leftDate < rightDate ? -1 : 1;
      }
      return (b && b.createdAt ? b.createdAt : 0) - (a && a.createdAt ? a.createdAt : 0);
    });
  }

  function sumReceivables(list) {
    let pending = 0;
    let settled = 0;
    for (const item of list || []) {
      pending += receivableRemaining(item);
      settled += Number(item && item.received) || 0;
    }
    return { pending: toMoney(pending), settled: toMoney(settled), count: (list || []).length };
  }

  /**
   * 待收汇总：
   * - monthPending：约定在本月到账、还没收到的钱（「这个月预计收到多少」）
   * - undated：没写约定日期、不知道什么时候能收到的钱
   * - overdue：过了约定日期还没收到的
   */
  function receivableTotals(list, options) {
    const config = options || {};
    const today = config.today || todayKey();
    const nowDate = parseDateKey(today) || new Date();
    const year = Number.isInteger(config.year) ? config.year : nowDate.getFullYear();
    const month = Number.isInteger(config.month) ? config.month : nowDate.getMonth();
    const prefix = monthKey(year, month);
    const open = (list || []).filter((item) => !isReceivableSettled(item));

    let monthPending = 0;
    let undated = 0;
    let overdue = 0;
    let later = 0;
    let overdueCount = 0;
    for (const item of open) {
      const remaining = receivableRemaining(item);
      if (!item.dueDate) {
        undated += remaining;
        continue;
      }
      if (item.dueDate < today) {
        overdue += remaining;
        overdueCount += 1;
        continue;
      }
      if (item.dueDate.startsWith(prefix)) monthPending += remaining;
      else if (item.dueDate > today) later += remaining;
    }

    const settledItems = (list || []).filter((item) => isReceivableSettled(item));
    return {
      monthPending: toMoney(monthPending),
      undated: toMoney(undated),
      overdue: toMoney(overdue),
      overdueCount,
      later: toMoney(later),
      settled: toMoney(settledItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)),
      openTotal: toMoney(monthPending + undated + overdue + later),
      openCount: open.length,
    };
  }

  function receivablesDueOn(list, date) {
    return sortReceivables((list || []).filter((item) => item.dueDate === date));
  }

  /** 日历（排单模式）用：某个月每一天有几笔待收到账（浅红数字） */
  function receivableDueMap(list, year, month, today = todayKey()) {
    const prefix = monthKey(year, month);
    const map = new Map();
    for (const item of list || []) {
      if (!item || !isValidDateKey(item.dueDate)) continue;
      if (receivableRemaining(item) <= 0) continue;
      if (!toText(item.dueDate).startsWith(prefix)) continue;
      const cell = map.get(item.dueDate) || { count: 0, overdue: 0 };
      cell.count += 1;
      if (item.dueDate < today) cell.overdue += 1;
      map.set(item.dueDate, cell);
    }
    return map;
  }

  /** 按甲方聚合：还欠我多少、已经结了多少 */
  function clientStats(list, today = todayKey()) {
    const rows = new Map();
    for (const item of list || []) {
      const key = toText(item && item.client).trim() || '未填写甲方';
      const row = rows.get(key) || { client: key, pending: 0, settled: 0, overdue: 0, count: 0 };
      const remaining = receivableRemaining(item);
      row.pending += remaining;
      row.settled += Number(item && item.received) || 0;
      if (remaining > 0 && item.dueDate && item.dueDate < today) row.overdue += remaining;
      row.count += 1;
      rows.set(key, row);
    }
    return [...rows.values()]
      .map((row) => ({
        ...row,
        pending: toMoney(row.pending),
        settled: toMoney(row.settled),
        overdue: toMoney(row.overdue),
      }))
      .sort(
        (a, b) => b.pending - a.pending || b.settled - a.settled || a.client.localeCompare(b.client, 'zh-Hans-CN'),
      );
  }

  /** 未来 N 个月的预计到账（按约定到账日），没写日期的单独放 undated */
  function monthlyExpected(list, options) {
    const config = options || {};
    const months = config.months || 6;
    const today = config.today || todayKey();
    const todayDate = parseDateKey(today) || new Date();
    const open = (list || []).filter((item) => !isReceivableSettled(item));
    const undated = toMoney(
      open.filter((item) => !item.dueDate).reduce((sum, item) => sum + receivableRemaining(item), 0),
    );
    const result = [];
    for (let i = 0; i < months; i += 1) {
      const date = new Date(todayDate.getFullYear(), todayDate.getMonth() + i, 1);
      const prefix = monthKey(date.getFullYear(), date.getMonth());
      const amount = open
        .filter((item) => item.dueDate && item.dueDate.startsWith(prefix))
        .reduce((sum, item) => sum + receivableRemaining(item), 0);
      result.push({
        year: date.getFullYear(),
        month: date.getMonth(),
        label: `${date.getMonth() + 1}月`,
        amount: toMoney(amount),
      });
    }
    return { months: result, undated };
  }

  /* --------------------------------------------------------- 约稿订单 */

  const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

  /**
   * 约稿订单（我方付钱给画师）：
   * - `deadline` 稿件截止日（日历「排单」唯一依据，可空）
   * - `dueMonth` / `dueDate` 尾款约定付款时间（可空；两个都空 = 时间未定）
   */
  function normalizeCommission(raw, now = Date.now(), fallbackBookId = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const createdAt = toTimestamp(source.createdAt, now);
    const total = toMoney(source.total);
    const paid = Math.min(toMoney(source.paid), total);
    const deadline = toText(source.deadline).trim();
    const dueDate = toText(source.dueDate).trim();
    const dueMonth = toText(source.dueMonth).trim();
    return {
      id: toText(source.id).trim() || createId(),
      bookId: toText(source.bookId).trim() || fallbackBookId,
      title: toText(source.title).trim().slice(0, 40),
      artist: toText(source.artist).trim().slice(0, 20),
      total,
      paid,
      deadline: isValidDateKey(deadline) ? deadline : '',
      dueDate: isValidDateKey(dueDate) ? dueDate : '',
      dueMonth: MONTH_KEY_RE.test(dueMonth) ? dueMonth : '',
      done: Boolean(source.done),
      note: toText(source.note).trim().slice(0, 60),
      createdAt,
      updatedAt: toTimestamp(source.updatedAt, createdAt),
    };
  }

  function commissionRemaining(item) {
    if (!item) return 0;
    return toMoney(Math.max(0, (Number(item.total) || 0) - (Number(item.paid) || 0)));
  }

  function isCommissionSettled(item) {
    return commissionRemaining(item) <= 0 && Number(item && item.total) > 0;
  }

  /** 已完结 = 画完了 + 钱也结清了 */
  function isCommissionClosed(item) {
    return Boolean(item && item.done) && isCommissionSettled(item);
  }

  /** settled / tail（付过一部分）/ unpaid */
  function commissionPayState(item) {
    if (isCommissionSettled(item)) return 'settled';
    return Number(item && item.paid) > 0 ? 'tail' : 'unpaid';
  }

  function commissionPayLabel(item) {
    const state = commissionPayState(item);
    if (state === 'settled') return '已结清';
    return state === 'tail' ? '待付尾款' : '待付款';
  }

  function commissionProgressLabel(item) {
    return item && item.done ? '已完稿' : '绘制中';
  }

  function commissionStatusLabel(item) {
    const pay = commissionPayLabel(item);
    if (isCommissionClosed(item)) return '已完结';
    return `${pay} · ${commissionProgressLabel(item)}`;
  }

  /** 尾款约定的时间点（日期优先），用于排序与逾期判断 */
  function commissionPayKey(item) {
    if (!item) return '';
    if (item.dueDate) return item.dueDate;
    if (item.dueMonth) return `${item.dueMonth}-01`;
    return '';
  }

  /** 尾款落在哪个月（'YYYY-MM'），时间未定返回空串 */
  function commissionPayMonth(item) {
    const key = commissionPayKey(item);
    return key ? key.slice(0, 7) : '';
  }

  /** 未完结的排前面；然后按尾款时间（没写时间的排最后），最后按创建时间倒序 */
  function sortCommissions(list) {
    return [...(list || [])].sort((a, b) => {
      const leftClosed = isCommissionClosed(a);
      const rightClosed = isCommissionClosed(b);
      if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
      const leftKey = commissionPayKey(a);
      const rightKey = commissionPayKey(b);
      if (leftKey !== rightKey) {
        if (!leftKey) return 1;
        if (!rightKey) return -1;
        return leftKey < rightKey ? -1 : 1;
      }
      const leftDeadline = toText(a && a.deadline);
      const rightDeadline = toText(b && b.deadline);
      if (leftDeadline !== rightDeadline) {
        if (!leftDeadline) return 1;
        if (!rightDeadline) return -1;
        return leftDeadline < rightDeadline ? -1 : 1;
      }
      return (b && b.createdAt ? b.createdAt : 0) - (a && a.createdAt ? a.createdAt : 0);
    });
  }

  function commissionBucket(item, options) {
    const config = options || {};
    const today = config.today || todayKey();
    if (isCommissionSettled(item)) return 'settled';
    const key = commissionPayKey(item);
    if (!key) return 'undated';
    if (key < today) return 'overdue';
    const prefix = config.monthPrefix || (config.year !== undefined ? monthKey(config.year, config.month) : today.slice(0, 7));
    if (key.startsWith(prefix)) return 'current';
    return 'later';
  }

  /** 按「逾期 / 本月 / 以后各月 / 时间未定 / 已结清」分好组的视图数据 */
  function commissionGroups(list, options) {
    const config = options || {};
    const today = config.today || todayKey();
    const nowDate = parseDateKey(today) || new Date();
    const year = Number.isInteger(config.year) ? config.year : nowDate.getFullYear();
    const month = Number.isInteger(config.month) ? config.month : nowDate.getMonth();
    const monthPrefix = monthKey(year, month);
    const sorted = sortCommissions(list);

    const overdue = [];
    const current = [];
    const undated = [];
    const settled = [];
    const upcoming = new Map();
    for (const item of sorted) {
      const bucket = commissionBucket(item, { today, year, month, monthPrefix });
      if (bucket === 'settled') settled.push(item);
      else if (bucket === 'overdue') overdue.push(item);
      else if (bucket === 'undated') undated.push(item);
      else if (bucket === 'current') current.push(item);
      else {
        const key = commissionPayMonth(item);
        if (!upcoming.has(key)) upcoming.set(key, []);
        upcoming.get(key).push(item);
      }
    }

    const upcomingGroups = [...upcoming.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, items]) => {
        const date = parseDateKey(`${key}-01`) || nowDate;
        return {
          month: key,
          label: `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`,
          items,
          remaining: toMoney(items.reduce((sum, item) => sum + commissionRemaining(item), 0)),
        };
      });

    const sum = (items) => toMoney(items.reduce((total, item) => total + commissionRemaining(item), 0));
    return {
      overdue,
      current,
      upcoming: upcomingGroups,
      undated,
      settled,
      overdueTotal: sum(overdue),
      currentTotal: sum(current),
      undatedTotal: sum(undated),
      openTotal: toMoney(sum(overdue) + sum(current) + sum(undated) + upcomingGroups.reduce((t, g) => t + g.remaining, 0)),
      openCount: overdue.length + current.length + undated.length + upcomingGroups.reduce((t, g) => t + g.items.length, 0),
    };
  }

  /** 资金压力用：某个月的尾款合计（含逾期） */
  function commissionMonthTotal(list, year, month, today = todayKey()) {
    const prefix = monthKey(year, month);
    let total = 0;
    for (const item of list || []) {
      if (isCommissionSettled(item)) continue;
      const key = commissionPayKey(item);
      if (!key) continue;
      if (key.startsWith(prefix)) total += commissionRemaining(item);
    }
    return toMoney(total);
  }

  /**
   * 日历「排单」用：按稿件截止日索引。
   * 只收有 deadline 且未完结（没画完 或 还没付清）的订单。
   */
  function commissionDueMap(list, year, month, today = todayKey()) {
    const prefix = monthKey(year, month);
    const map = new Map();
    for (const item of list || []) {
      if (!item || !item.deadline || isCommissionClosed(item)) continue;
      if (!item.deadline.startsWith(prefix)) continue;
      const cell = map.get(item.deadline) || { count: 0, overdue: 0 };
      cell.count += 1;
      if (item.deadline < today && !item.done) cell.overdue += 1;
      map.set(item.deadline, cell);
    }
    return map;
  }

  function commissionDueOn(list, date) {
    return sortCommissions((list || []).filter((item) => item && item.deadline === date && !isCommissionClosed(item)));
  }

  /** 某天的稿件是不是已经拖过期了（还没画完） */
  function isCommissionOverdue(item, today = todayKey()) {
    return Boolean(item && item.deadline) && !item.done && item.deadline < today;
  }

  /** 日历（记账模式）用：某个月每一天要付掉的约稿尾款 */
  function commissionPayDueMap(list, year, month) {
    const prefix = monthKey(year, month);
    const map = new Map();
    for (const item of list || []) {
      if (!item || isCommissionSettled(item)) continue;
      if (!isValidDateKey(item.dueDate)) continue;
      if (!item.dueDate.startsWith(prefix)) continue;
      const remaining = commissionRemaining(item);
      if (!(remaining > 0)) continue;
      const cell = map.get(item.dueDate) || { count: 0, amount: 0 };
      cell.count += 1;
      cell.amount = toMoney(cell.amount + remaining);
      map.set(item.dueDate, cell);
    }
    return map;
  }

  /**
   * 「本月尾款预支出」：没排到具体某一天、但本月要掏的钱。
   * 含两类：只填了月份（等于当月）或完全没填时间的；以及已经逾期未付的。
   */
  function commissionMonthPending(list, year, month, today = todayKey()) {
    const prefix = monthKey(year, month);
    let total = 0;
    let overdue = 0;
    let count = 0;
    for (const item of list || []) {
      if (!item || isCommissionSettled(item)) continue;
      const remaining = commissionRemaining(item);
      if (!(remaining > 0)) continue;
      if (item.dueDate) {
        // 有具体日期：逾期的也算进「本月要掏的」，其余落到那一天
        if (item.dueDate < today) {
          overdue += remaining;
          total += remaining;
          count += 1;
        }
        continue;
      }
      if (!item.dueMonth || item.dueMonth === prefix) {
        total += remaining;
        count += 1;
      }
    }
    return { total: toMoney(total), overdue: toMoney(overdue), count };
  }

  /* --------------------------------------------------------- 资金压力 */

  /**
   * 本月预计结余 = 预计收入（工资 + 其他收入 + 本月预计收到）− 其他固定支出 − 本月待付尾款。
   */
  function pressureSummary(raw) {
    const source = raw || {};
    const salary = toMoney(source.salary);
    const otherIncome = toMoney(source.otherIncome);
    const receivable = toMoney(source.receivable);
    const fixed = toMoney(source.fixed);
    const tail = toMoney(source.tail);
    const income = toMoney(salary + otherIncome + receivable);
    const balance = toMoney(income - fixed - tail);
    return {
      salary,
      otherIncome,
      receivable,
      income,
      fixed,
      tail,
      balance,
      over: balance < 0,
    };
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
  const EXPORT_COLLECTIONS = [
    'books',
    'categories',
    'accounts',
    'budgets',
    'payables',
    'recurring',
    'ledger',
    'receivables',
    'todos',
    'todoGroups',
  ];

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
    clientStats,
    collectTags,
    commissionBucket,
    commissionDueMap,
    commissionDueOn,
    commissionGroups,
    commissionMonthTotal,
    commissionMonthPending,
    commissionPayDueMap,
    commissionPayKey,
    commissionPayLabel,
    commissionPayMonth,
    commissionPayState,
    commissionProgressLabel,
    commissionRemaining,
    commissionStatusLabel,
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
    isCommissionClosed,
    isCommissionOverdue,
    isCommissionSettled,
    isReceivableSettled,
    ledgerToCsv,
    ledgerTotals,
    ledgerTypeLabel,
    matchesQuery,
    monthLedgerTotals,
    monthlyLedgerTotals,
    monthGrid,
    monthKey,
    monthlyCounts,
    monthlyExpected,
    normalizeAccount,
    normalizeAccountKind,
    normalizeBook,
    normalizeBudget,
    normalizeCategory,
    normalizeCommission,
    normalizeFrequency,
    normalizeLedger,
    normalizeLedgerType,
    normalizePriority,
    normalizeReceivable,
    normalizeRecurring,
    normalizeEntry,
    normalizeTags,
    normalizeTodo,
    normalizeTodoGroup,
    parseDateKey,
    parseImport,
    pendingRecurringDates,
    pressureSummary,
    priorityLabel,
    recurringDates,
    renderMarkdown,
    shiftDateKey,
    sortEntries,
    sortCommissions,
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
    todoDoneByDay,
    todoGroupStats,
    todoStats,
    sortTodosForDay,
    receivableRemaining,
    receivableStatus,
    receivableStatusLabel,
    receivableTotals,
    receivableDueMap,
    receivablesDueOn,
    sortReceivables,
    sumReceivables,
    utf8Length,
    wordCount,
    yearLedgerTotals,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
