import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildDemoMbk } from '../tools/mbk-fixture.mjs';

import { loadSource } from '../tools/load-source.mjs';

const Diary = loadSource('js/aes.js', 'js/model.js', 'js/db.js', 'js/zip.js', 'js/importer.js', 'js/store.js');
const { model, db, createStore, importer } = Diary;
const {
  accountBalances,
  budgetProgress,
  categoryStats,
  dayLedgerMap,
  formatMoney,
  formatMoneyShort,
  groupLedger,
  isEmptyLedger,
  ledgerToCsv,
  monthLedgerTotals,
  normalizeAccount,
  normalizeBudget,
  normalizeCategory,
  normalizeLedger,
  normalizeRecurring,
  normalizeTodo,
  pendingRecurringDates,
  recurringDates,
  sortLedger,
  sortTodos,
  todoDueMap,
  todoStats,
  yearLedgerTotals,
} = model;

const memoryStore = async () => {
  const store = createStore(db.createMemoryAdapter());
  await store.init();
  return store;
};

/* ---------------------------------------------------------------- 记账 */

test('记账：一笔一条，日期 / 时间 / 类型 / 金额 / 备注 / 分类 / 账户都规整', () => {
  const record = normalizeLedger({
    date: '2026-09-26',
    time: '09:05',
    type: 'income',
    amount: '80.456',
    note: '  项目尾款  ',
    categoryId: 'cat-1',
    accountId: 'acc-1',
  });
  assert.equal(record.date, '2026-09-26');
  assert.equal(record.time, '09:05');
  assert.equal(record.type, 'income');
  assert.equal(record.amount, 80.46);
  assert.equal(record.note, '项目尾款');
  assert.equal(record.categoryId, 'cat-1');
  assert.equal(record.accountId, 'acc-1');
  assert.ok(record.id);
  assert.equal(typeof record.updatedAt, 'number');
  assert.equal(model.ledgerTypeLabel(record.type), '收入');
});

test('记账：非法日期 / 类型 / 时间都回落，三种类型互转', () => {
  const record = normalizeLedger({ date: '2026-02-31', type: 'nope', amount: 'abc', time: '25:99' });
  assert.equal(record.date, model.toDateKey(Date.now()));
  assert.equal(record.type, 'expense');
  assert.equal(record.amount, 0);
  assert.match(record.time, /^\d{2}:\d{2}$/);
  assert.equal(model.normalizeLedgerType('transfer'), 'transfer');
  assert.equal(model.normalizeLedgerType('收入'), 'expense');
  assert.equal(model.ledgerTypeLabel('transfer'), '转账');
});

test('记账：0 元（或负数）算空记录，金额展示有两位上限', () => {
  assert.equal(isEmptyLedger(normalizeLedger({ amount: 0 })), true);
  assert.equal(isEmptyLedger(normalizeLedger({ amount: -3 })), true);
  assert.equal(isEmptyLedger(normalizeLedger({ amount: 1 })), false);
  assert.equal(isEmptyLedger(null), true);
  assert.equal(formatMoney(1234.5), '1,234.5');
  assert.equal(formatMoney('abc'), '0');
  assert.equal(formatMoneyShort(999), '999');
  assert.equal(formatMoneyShort(1234), '1.2k');
  assert.equal(formatMoneyShort(23456), '2.3w');
  assert.equal(formatMoneyShort(0), '');
});

test('记账：排序默认最新在前（先比日期再比时间）', () => {
  const list = [
    normalizeLedger({ date: '2026-09-26', time: '08:00', amount: 1 }),
    normalizeLedger({ date: '2026-09-27', time: '07:00', amount: 2 }),
    normalizeLedger({ date: '2026-09-26', time: '20:00', amount: 3 }),
  ];
  assert.deepEqual(sortLedger(list).map((item) => item.amount), [2, 3, 1]);
  assert.deepEqual(sortLedger(list, 'asc').map((item) => item.amount), [1, 3, 2]);
});

test('记账：合计里转账不算收支，只算笔数', () => {
  const list = [
    normalizeLedger({ date: '2026-09-01', type: 'income', amount: 100 }),
    normalizeLedger({ date: '2026-09-01', type: 'income', amount: 23.456 }),
    normalizeLedger({ date: '2026-09-26', type: 'expense', amount: 80 }),
    normalizeLedger({ date: '2026-09-26', type: 'transfer', amount: 500 }),
    normalizeLedger({ date: '2026-08-31', type: 'income', amount: 999 }),
  ];
  assert.deepEqual(monthLedgerTotals(list, 2026, 8), {
    income: 123.46,
    expense: 80,
    net: 43.46,
    count: 3,
    transferCount: 1,
    days: 2,
  });
  assert.deepEqual(monthLedgerTotals(list, 2026, 7), {
    income: 999,
    expense: 0,
    net: 999,
    count: 1,
    transferCount: 0,
    days: 1,
  });
  assert.deepEqual(yearLedgerTotals(list, 2026).expense, 80);
  assert.deepEqual(model.ledgerTotals(list), { income: 1122.46, expense: 80, net: 1042.46, count: 4, transferCount: 1 });
  assert.deepEqual(model.dayLedgerTotals(list, '2026-09-01'), {
    income: 123.46,
    expense: 0,
    net: 123.46,
    count: 2,
    transferCount: 0,
  });
});

test('记账：按日期分组，带当天收支合计（新的日期在前）', () => {
  const list = [
    normalizeLedger({ date: '2026-09-26', time: '09:00', type: 'income', amount: 10 }),
    normalizeLedger({ date: '2026-09-26', time: '18:00', type: 'expense', amount: 5 }),
    normalizeLedger({ date: '2026-09-27', type: 'income', amount: 1 }),
  ];
  const groups = groupLedger(list);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, '2026-09-27');
  assert.deepEqual([groups[0].income, groups[0].expense], [1, 0]);
  assert.deepEqual([groups[1].income, groups[1].expense], [10, 5]);
  assert.equal(groups[1].items.length, 2);
  assert.deepEqual(groups[1].items.map((item) => item.time), ['18:00', '09:00']);
});

test('记账：日历格子的按天支出地图只看当月', () => {
  const list = [
    normalizeLedger({ date: '2026-09-26', type: 'expense', amount: 12.5 }),
    normalizeLedger({ date: '2026-09-26', type: 'income', amount: 100 }),
    normalizeLedger({ date: '2026-09-30', type: 'expense', amount: 3 }),
    normalizeLedger({ date: '2026-10-01', type: 'expense', amount: 9 }),
  ];
  const map = dayLedgerMap(list, 2026, 8);
  assert.deepEqual(map.get('2026-09-26'), { expense: 12.5, income: 100, count: 2 });
  assert.deepEqual(map.get('2026-09-30'), { expense: 3, income: 0, count: 1 });
  assert.equal(map.has('2026-10-01'), false);
});

test('记账：分类统计按金额排行并算占比，未分类归到「未分类」', () => {
  const categories = [
    normalizeCategory({ id: 'food', kind: 'expense', name: '餐饮' }),
    normalizeCategory({ id: 'bus', kind: 'expense', name: '交通' }),
  ];
  const list = [
    normalizeLedger({ type: 'expense', amount: 60, categoryId: 'food' }),
    normalizeLedger({ type: 'expense', amount: 20, categoryId: 'food' }),
    normalizeLedger({ type: 'expense', amount: 20, categoryId: 'bus' }),
    normalizeLedger({ type: 'income', amount: 500, categoryId: 'pay' }),
  ];
  const rows = categoryStats(list, 'expense', categories);
  assert.deepEqual(rows.map((row) => [row.name, row.amount]), [
    ['餐饮', 80],
    ['交通', 20],
  ]);
  assert.equal(rows[0].ratio, 0.8);
  assert.equal(rows[1].count, 1);
  assert.equal(rows[0].icon, '📦'); // 没给图标时用兜底
});

test('记账：账户余额含转账，信用卡可以是负的', () => {
  const accounts = [
    normalizeAccount({ id: 'cash', name: '现金', initialBalance: 100 }),
    normalizeAccount({ id: 'card', name: '信用卡', kind: 'credit', initialBalance: 0 }),
  ];
  const list = [
    normalizeLedger({ type: 'expense', amount: 30, accountId: 'cash' }),
    normalizeLedger({ type: 'expense', amount: 200, accountId: 'card' }),
    normalizeLedger({ type: 'income', amount: 50, accountId: 'cash' }),
    normalizeLedger({ type: 'transfer', amount: 20, accountId: 'cash', toAccountId: 'card' }),
  ];
  const balances = accountBalances(accounts, list);
  assert.equal(balances.get('cash'), 100);
  assert.equal(balances.get('card'), -180);
});

test('记账：预算进度算已用 / 剩余 / 超支', () => {
  const budget = normalizeBudget({ amount: 1000 });
  assert.deepEqual(budgetProgress(budget, 250), {
    amount: 1000,
    spent: 250,
    remaining: 750,
    ratio: 0.25,
    over: false,
    enabled: true,
  });
  assert.equal(budgetProgress(budget, 1200).over, true);
  assert.equal(budgetProgress(null, 1200).enabled, true);
  assert.equal(budgetProgress(null, 1200).amount, 0);
});

test('周期记账：按天 / 周 / 月 / 年算出到期日，且只补没生成过的', () => {
  const monthly = normalizeRecurring({
    type: 'expense',
    amount: 88,
    frequency: 'monthly',
    startDate: '2026-07-15',
    dayOfMonth: 15,
  });
  assert.deepEqual(recurringDates(monthly, '2026-09-20'), ['2026-07-15', '2026-08-15', '2026-09-15']);
  assert.deepEqual(pendingRecurringDates({ ...monthly, lastGeneratedDate: '2026-08-15' }, '2026-09-20'), ['2026-09-15']);

  const weekly = normalizeRecurring({ frequency: 'weekly', startDate: '2026-09-01', dayOfWeek: 1 });
  assert.deepEqual(recurringDates(weekly, '2026-09-20'), ['2026-09-07', '2026-09-14']);

  const daily = normalizeRecurring({ frequency: 'daily', startDate: '2026-09-18', interval: 2 });
  assert.deepEqual(recurringDates(daily, '2026-09-23'), ['2026-09-18', '2026-09-20', '2026-09-22']);

  const yearly = normalizeRecurring({ frequency: 'yearly', startDate: '2024-09-10', endDate: '2026-12-31' });
  assert.deepEqual(recurringDates(yearly, '2026-09-20'), ['2024-09-10', '2025-09-10', '2026-09-10']);

  // 月底的规则遇到小月自动收到当月最后一天
  const clamp = normalizeRecurring({ frequency: 'monthly', startDate: '2026-01-31', dayOfMonth: 31 });
  assert.deepEqual(recurringDates(clamp, '2026-04-30'), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
});

/* -------------------------------------------------------------- 待办 */

test('待办：文本 / 优先级 / 截止日期 / 分组都规整', () => {
  const todo = normalizeTodo({
    text: '  交房租  ',
    note: ' 记得带票据 ',
    priority: 2,
    dueDate: '2026-10-01',
    groupId: 'g1',
  });
  assert.equal(todo.text, '交房租');
  assert.equal(todo.note, '记得带票据');
  assert.equal(todo.priority, 2);
  assert.equal(todo.dueDate, '2026-10-01');
  assert.equal(todo.groupId, 'g1');
  assert.equal(todo.done, false);
  assert.equal(model.priorityLabel(2), '紧急');
  assert.equal(normalizeTodo({ priority: 9 }).priority, 0);
  assert.equal(normalizeTodo({ dueDate: '2026-02-31' }).dueDate, '');
});

test('待办：未完成在前按手动顺序，已完成按完成时间归档', () => {
  const a = normalizeTodo({ text: 'A', order: 2, createdAt: 10 });
  const b = normalizeTodo({ text: 'B', order: 1, createdAt: 20 });
  const done = normalizeTodo({ text: 'C', done: true, doneAt: 50, order: 0, createdAt: 30 });
  assert.deepEqual(sortTodos([a, b, done]).map((item) => item.text), ['B', 'A', 'C']);
  const stats = todoStats([a, b, done], '2026-10-01');
  assert.deepEqual(stats, { pending: 2, done: 1, overdue: 0, total: 3 });
  assert.equal(todoStats([normalizeTodo({ text: 'X', dueDate: '2026-09-01' })], '2026-10-01').overdue, 1);
});

test('待办：日历格子只统计当月未完成的数量', () => {
  const todos = [
    normalizeTodo({ text: 'a', dueDate: '2026-10-01' }),
    normalizeTodo({ text: 'b', dueDate: '2026-10-01' }),
    normalizeTodo({ text: 'c', dueDate: '2026-10-01', done: true }),
    normalizeTodo({ text: 'd', dueDate: '2026-11-01' }),
  ];
  const map = todoDueMap(todos, 2026, 9);
  assert.equal(map.get('2026-10-01'), 2);
  assert.equal(map.size, 1);
});

/* ---------------------------------------------------------- 仓库层 */

test('仓库层：记一笔 / 改一笔 / 删一笔，默认账本自带分类与账户', async () => {
  const store = await memoryStore();
  assert.equal(store.books().length, 1);
  assert.equal(store.categories('expense').length, 12);
  assert.equal(store.categories('income').length, 8);
  assert.equal(store.accounts().length, 1);

  const account = store.accounts()[0];
  const food = store.categories('expense').find((item) => item.name === '餐饮');
  const first = await store.addLedger({ type: 'expense', amount: 24.5, categoryId: food.id, accountId: account.id });
  const second = await store.addLedger({ type: 'income', amount: 8000, accountId: account.id });
  assert.ok(first.id);
  assert.equal(await store.addLedger({ amount: 0 }), null);
  assert.equal(store.ledgerList().length, 2);

  await store.updateLedger(second.id, { amount: 9000, note: '改过' });
  assert.equal(store.ledgerList().find((item) => item.id === second.id).amount, 9000);
  assert.equal(store.ledgerList().find((item) => item.id === second.id).note, '改过');

  assert.equal(await store.removeLedger(first.id), true);
  assert.equal(await store.removeLedger(first.id), false);
  assert.equal(store.ledgerList().length, 1);

  const today = model.todayKey();
  assert.deepEqual(store.ledgerDayTotals(today).income, 9000);
  assert.deepEqual(store.ledgerMonthTotals(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1).income, 9000);
});

test('仓库层：转账不影响收支，但两个账户的余额都动', async () => {
  const store = await memoryStore();
  const cash = store.accounts()[0];
  const bank = await store.addAccount({ name: '储蓄卡', kind: 'debit' });
  await store.addLedger({ type: 'income', amount: 1000, accountId: cash.id });
  await store.addLedger({ type: 'transfer', amount: 300, accountId: cash.id, toAccountId: bank.id });
  const totals = store.ledgerTotals();
  assert.equal(totals.income, 1000);
  assert.equal(totals.expense, 0);
  assert.equal(totals.transferCount, 1);
  const balances = store.accountBalances();
  assert.equal(balances.get(cash.id), 700);
  assert.equal(balances.get(bank.id), 300);
});

test('仓库层：多账本互相隔离，日记与待办不受影响', async () => {
  const store = await memoryStore();
  await store.save({ id: 'e1', date: '2026-10-01', content: '日记' });
  await store.addTodo('待办');
  const first = store.activeBook();
  await store.addLedger({ type: 'expense', amount: 10 });
  assert.equal(store.ledgerList().length, 1);

  const second = await store.addBook('工作');
  assert.equal(store.activeBook().id, second.id);
  assert.equal(store.ledgerList().length, 0, '新账本是空的');
  assert.equal(store.categories('expense').length, 12, '新账本有自己的分类');
  assert.equal(store.list().length, 1, '日记不分账本');
  assert.equal(store.todoList().length, 1, '待办不分账本');

  await store.setActiveBook(first.id);
  assert.equal(store.ledgerList().length, 1);
  assert.equal(await store.removeBook(first.id), true);
  assert.equal(store.books().length, 1);
  assert.equal(store.ledgerList().length, 0);
});

test('仓库层：周期记账补生成是幂等的，跨天只补一次', async () => {
  const store = await memoryStore();
  const account = store.accounts()[0];
  const rule = await store.addRecurring({
    type: 'expense',
    amount: 30,
    name: '房租',
    frequency: 'monthly',
    startDate: '2026-07-05',
    dayOfMonth: 5,
    accountId: account.id,
  });
  assert.equal(store.ledgerList().length, 0, '加规则时不补历史，等 materialize 显式调用');
  const created = await store.materializeRecurring('2026-09-20');
  assert.equal(created.length, 3);
  assert.equal(store.ledgerList().length, 3);
  const again = await store.materializeRecurring('2026-09-20');
  assert.equal(again.length, 0);
  assert.equal(store.ledgerList().length, 3);
  assert.equal(store.ledgerList()[0].ruleId, rule.id);
  assert.equal(store.ledgerList()[0].occurrenceKey, '2026-09-05');

  // 再往后一天，只补新的一次
  const next = await store.materializeRecurring('2026-10-05');
  assert.equal(next.length, 1);
  assert.equal(store.ledgerList().length, 4);

  // 删规则会把自动生成的流水一起撤掉
  await store.removeRecurring(rule.id);
  assert.equal(store.ledgerList().length, 0);
});

test('仓库层：分类 / 账户 / 预算的增删改', async () => {
  const store = await memoryStore();
  const custom = await store.addCategory({ kind: 'expense', name: '咖啡', icon: '☕', color: '#c2705a' });
  assert.equal(store.categories('expense').length, 13);
  await store.updateCategory(custom.id, { name: '咖啡奶茶' });
  assert.equal(store.categoryById(custom.id).name, '咖啡奶茶');

  const food = store.categories('expense').find((item) => item.name === '餐饮');
  const account = store.accounts()[0];
  await store.addLedger({ type: 'expense', amount: 20, categoryId: food.id, accountId: account.id });
  await store.removeCategory(food.id);
  assert.equal(store.ledgerList()[0].categoryId, '', '删分类不删流水，只是变成未分类');

  const bank = await store.addAccount({ name: '微信', kind: 'virtual', initialBalance: 200 });
  assert.equal(store.accountBalances().get(bank.id), 200);
  await store.updateAccount(bank.id, { initialBalance: 300 });
  assert.equal(store.accountBalances().get(bank.id), 300);
  await store.removeAccount(bank.id);
  assert.equal(store.accounts().some((item) => item.id === bank.id), false);

  await store.setBudget('month-total', 2000);
  assert.equal(store.monthlyBudget().amount, 2000);
  await store.setBudget('month-total', 0);
  assert.equal(store.monthlyBudget(), null);
});

test('仓库层：待办增改删、分组与拖拽排序', async () => {
  const store = await memoryStore();
  const a = await store.addTodo('买牛奶');
  const b = await store.addTodo({ text: '交房租', priority: 2, dueDate: '2026-10-01' });
  assert.equal(store.todoList().length, 2);
  assert.equal(await store.addTodo('   '), null);

  await store.toggleTodo(a.id);
  assert.equal(store.todoList()[1].done, true);
  assert.equal(store.todoList()[0].id, b.id);

  await store.reorderTodos([b.id]);
  assert.equal(store.todoList()[0].order, 1);

  const group = await store.addTodoGroup('工作');
  await store.updateTodo(b.id, { groupId: group.id });
  assert.equal(store.todoList().find((item) => item.id === b.id).groupId, group.id);
  await store.removeTodoGroup(group.id);
  assert.equal(store.todoList().find((item) => item.id === b.id).groupId, '');

  assert.equal(store.todosDueOn('2026-10-01').length, 1);
  assert.equal(await store.clearDoneTodos(), 1);
  assert.equal(store.todoList().length, 1);
});

test('仓库层：清空全部会连记账和待办一起清掉，并重建默认账本', async () => {
  const store = await memoryStore();
  await store.save({ id: 'x', date: '2026-09-26', content: '日记' });
  await store.addLedger({ date: '2026-09-26', amount: 10 });
  await store.addTodo('待办');

  await store.clear();
  assert.equal(store.list().length, 0);
  assert.equal(store.ledgerList().length, 0);
  assert.equal(store.todoList().length, 0);
  assert.equal(store.books().length, 1);
  assert.equal(store.categories('expense').length, 12);
});

test('降级存储（同接口的兜底适配器）也能存记账与待办', async () => {
  const memory = db.createMemoryAdapter();
  const store = createStore(memory);
  await store.init();
  await store.addLedger({ date: '2026-10-01', type: 'income', amount: 88 });
  await store.addTodo('短期待办');

  // 换一个 store 实例读同一份存储，确认真的落库了
  const again = createStore(memory);
  await again.init();
  assert.equal(again.ledgerList()[0].amount, 88);
  assert.equal(again.todoList()[0].text, '短期待办');
});

test('迁移兼容：老版本的日记与待办读进来不丢，旧版记账数据被忽略', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  try {
    localStorage.setItem('diary:entries', JSON.stringify([{ id: 'e1', date: '2026-09-01', content: '老日记' }]));
    // v4 的待办只有 text / done / createdAt
    localStorage.setItem('diary:todos', JSON.stringify([{ id: 't1', text: '老待办', done: false, createdAt: 123 }]));
    // v4 的记账是「收入 / 尾款」两分类，v5 直接不要了
    localStorage.setItem('diary:ledger', JSON.stringify([{ id: 'l1', date: '2026-09-01', type: 'balance', amount: 20 }]));

    const store = createStore(db.createLocalStorageAdapter());
    await store.init();
    assert.equal(store.list().length, 1);
    assert.equal(store.get('e1').content, '老日记');
    assert.equal(store.todoList().length, 1);
    assert.equal(store.todoList()[0].text, '老待办');
    assert.equal(store.todoList()[0].priority, 0, '新字段自动补默认值');
    assert.equal(store.ledgerList().length, 0, '旧版记账数据不再读取');
    assert.equal(store.books().length, 1, '自动建一个默认账本');
    assert.equal(store.categories('expense').length, 12);
  } finally {
    delete globalThis.localStorage;
  }
});

/* ------------------------------------------------------- 备份与口令 */

test('导出 v3 备份再导入回来，记账与待办一起还原', () => {
  const payload = model.buildExportPayload([{ id: 'e1', date: '2026-09-01', content: '日记' }], {
    books: [{ id: 'b1', name: '日常账本' }],
    categories: [{ id: 'c1', bookId: 'b1', kind: 'expense', name: '餐饮' }],
    ledger: [{ id: 'l1', bookId: 'b1', type: 'expense', amount: 12, date: '2026-09-01' }],
    todos: [{ id: 't1', text: '待办' }],
  });
  assert.equal(payload.version, 3);
  assert.equal(payload.app, '拾光日记');
  const parsed = model.parseImport(JSON.stringify(payload));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.ledger.length, 1);
  assert.equal(parsed.todos.length, 1);
  assert.equal(parsed.categories.length, 1);
  assert.equal(parsed.version, 3);
});

test('导入老版 v2 备份（只有 entries）不报错', () => {
  const parsed = model.parseImport(JSON.stringify({ version: 2, entries: [{ id: 'e', date: '2026-09-01', content: 'x' }] }));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.ledger, undefined);
  assert.equal(parsed.version, 2);
});

test('记账 CSV 导出带表头与分类 / 账户名字', () => {
  const csv = ledgerToCsv([normalizeLedger({ type: 'expense', amount: 12, date: '2026-09-01', categoryId: 'c1', accountId: 'a1', note: '午饭,加蛋' })], {
    categories: [normalizeCategory({ id: 'c1', name: '餐饮' })],
    accounts: [normalizeAccount({ id: 'a1', name: '现金' })],
    books: [{ id: '', name: '日常账本' }],
  });
  const [head, row] = csv.split('\r\n');
  assert.match(head, /^日期,时间,类型,金额,分类,账户/);
  assert.match(row, /支出/);
  assert.match(row, /餐饮/);
  assert.match(row, /"午饭,加蛋"/);
});

test('导入口令：timenotes 与 locktime2u 都能免密解开，输错会自动回退', async () => {
  const fresh = buildDemoMbk('timenotes');
  const legacy = buildDemoMbk('locktime2u');

  const a = await importer.parseBackup({ bytes: fresh, filename: 'Diary_new.mbk', includeMedia: false });
  assert.equal(a.entries.length, 2);
  assert.equal(a.password, 'timenotes');

  const b = await importer.parseBackup({ bytes: legacy, filename: 'Diary_old.mbk', includeMedia: false });
  assert.equal(b.entries.length, 2);
  assert.equal(b.password, 'locktime2u', '老备份自动回退到旧口令');

  const c = await importer.parseBackup({
    bytes: legacy,
    filename: 'Diary_old.mbk',
    includeMedia: false,
    password: '打错了',
  });
  assert.equal(c.password, 'locktime2u');

  const other = buildDemoMbk('my-secret');
  await assert.rejects(
    () => importer.parseBackup({ bytes: other, filename: 'Diary_other.mbk', includeMedia: false }),
    (error) => error.code === 'PASSWORD',
  );
});

test('待办排序的真实顺序：手动排序优先于创建时间', async () => {
  const store = await memoryStore();
  const a = await store.addTodo('第一');
  const b = await store.addTodo('第二');
  const c = await store.addTodo('第三');
  assert.deepEqual(store.todoList().map((item) => item.text), ['第一', '第二', '第三']);
  await store.reorderTodos([c.id, a.id, b.id]);
  assert.deepEqual(store.todoList().map((item) => item.text), ['第三', '第一', '第二']);
});
