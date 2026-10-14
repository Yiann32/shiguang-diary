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

  // 收入侧同样能出「本月收入构成」
  const incomeCategories = [normalizeCategory({ id: 'pay', kind: 'income', name: '工资' })];
  const incomeRows = categoryStats(list, 'income', incomeCategories);
  assert.deepEqual(incomeRows.map((row) => [row.name, row.amount, row.ratio]), [['工资', 500, 1]]);
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

test('待办：日历格子统计当月每天的 未完成/已完成/总数', () => {
  const todos = [
    normalizeTodo({ text: 'a', dueDate: '2026-10-01' }),
    normalizeTodo({ text: 'b', dueDate: '2026-10-01' }),
    normalizeTodo({ text: 'c', dueDate: '2026-10-01', done: true }),
    normalizeTodo({ text: 'd', dueDate: '2026-11-01' }),
  ];
  const map = todoDueMap(todos, 2026, 9);
  assert.deepEqual(map.get('2026-10-01'), { pending: 2, done: 1, total: 3 });
  assert.equal(map.size, 1);
});

test('待办：具体时间可空，只填时间自动落到今天', () => {
  const withTime = normalizeTodo({ text: 'A', dueDate: '2026-10-08', dueTime: '14:30' });
  assert.equal(withTime.dueTime, '14:30');
  assert.equal(withTime.dueDate, '2026-10-08');

  const timeOnly = normalizeTodo({ text: 'B', dueTime: '09:05' });
  assert.equal(timeOnly.dueTime, '09:05');
  assert.equal(timeOnly.dueDate, model.toDateKey(Date.now()), '只填时间要有今天兜底');

  const bad = normalizeTodo({ text: 'C', dueDate: '2026-10-08', dueTime: '25:99' });
  assert.equal(bad.dueTime, '');
  assert.equal(bad.dueDate, '2026-10-08');
});

test('待办：某一天排序时有时间的在前，按时间升序', () => {
  const list = [
    normalizeTodo({ id: 'a', text: 'A', dueDate: '2026-10-08', order: 1 }),
    normalizeTodo({ id: 'b', text: 'B', dueDate: '2026-10-08', dueTime: '18:00', order: 2 }),
    normalizeTodo({ id: 'c', text: 'C', dueDate: '2026-10-08', dueTime: '09:00', order: 3 }),
  ];
  assert.deepEqual(model.sortTodosForDay(list).map((item) => item.id), ['c', 'b', 'a']);
});

test('待办：打卡式分组完成统计（近 7 天 / 本月 / 全部）', () => {
  const groups = [model.normalizeTodoGroup({ id: 'g1', name: '工作' }), model.normalizeTodoGroup({ id: 'g2', name: '生活' })];
  const at = (day, hour = 10) => Date.parse(`2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`);
  const todos = [
    normalizeTodo({ id: 't1', text: 'A', done: true, doneAt: at(1), groupId: 'g1' }),
    normalizeTodo({ id: 't2', text: 'B', done: true, doneAt: at(2), groupId: 'g1' }),
    normalizeTodo({ id: 't3', text: 'C', done: true, doneAt: at(3), groupId: 'g2' }),
    normalizeTodo({ id: 't4', text: 'D', done: true, doneAt: at(20), groupId: 'g1' }), // 上个月的旧记录
    normalizeTodo({ id: 't5', text: 'E', done: true, doneAt: at(1) }), // 没分组
    normalizeTodo({ id: 't6', text: 'F', dueDate: '2026-10-08' }), // 没完成的，不计
  ];
  const all = model.todoGroupStats(todos, groups, { range: 'all', today: '2026-10-08' });
  assert.equal(all.total, 5);
  assert.deepEqual(all.rows[0], { groupId: 'g1', name: '工作', count: 3, ratio: 1 });
  assert.equal(all.rows.find((row) => row.groupId === 'g2').count, 1);
  assert.equal(all.rows.find((row) => row.groupId === '').count, 1);

  const week = model.todoGroupStats(todos, groups, { range: 'week', today: '2026-10-08' });
  assert.equal(week.total, 2, '近 7 天=今天往前数 7 天（含今天），10-01 与 9 月那条都不算');
  const day2 = model.todoGroupStats(todos, groups, { range: 'week', today: '2026-10-02' });
  assert.equal(day2.total, 3, '以 10-02 为今天时窗口覆盖 09-26 起，10-01 的两条也算进来');

  // 分组被删掉后，成员算进「默认清单」
  const orphan = model.todoGroupStats(todos, [], { range: 'all', today: '2026-10-08' });
  assert.equal(orphan.rows.length, 1);
  assert.equal(orphan.rows[0].name, '默认清单');
  assert.equal(orphan.rows[0].count, 5);
});

test('待办：已完成按完成那天倒序分组', () => {
  const at = (day, hour) => Date.parse(`2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`);
  const todos = [
    normalizeTodo({ id: 'a', text: 'A', done: true, doneAt: at(2, 9) }),
    normalizeTodo({ id: 'b', text: 'B', done: true, doneAt: at(2, 20) }),
    normalizeTodo({ id: 'c', text: 'C', done: true, doneAt: at(3, 10) }),
    normalizeTodo({ id: 'd', text: 'D', dueDate: '2026-10-03' }),
  ];
  const days = model.todoDoneByDay(todos);
  assert.deepEqual(days.map((day) => day.date), ['2026-10-03', '2026-10-02']);
  assert.deepEqual(days[1].items.map((item) => item.id), ['b', 'a'], '同一天按完成时间倒序');
});

test('日历索引：待收到账与约稿尾款预支出', () => {
  const receivables = [
    model.normalizeReceivable({ id: 'r1', client: '甲', amount: 1500, dueDate: '2026-10-08' }),
    model.normalizeReceivable({ id: 'r2', client: '乙', amount: 500, received: 500, dueDate: '2026-10-08' }),
    model.normalizeReceivable({ id: 'r3', client: '丙', amount: 900, dueDate: '2026-10-20' }),
  ];
  const incomeMap = model.receivableDueMap(receivables, 2026, 9, '2026-10-15');
  assert.deepEqual(incomeMap.get('2026-10-08'), { count: 1, overdue: 1 }, '结清的不算');
  assert.deepEqual(incomeMap.get('2026-10-20'), { count: 1, overdue: 0 });

  const commissions = [
    model.normalizeCommission({ id: 'c1', title: 'A', total: 2000, paid: 800, dueDate: '2026-10-08' }),
    model.normalizeCommission({ id: 'c2', title: 'B', total: 1000, dueMonth: '2026-10' }),
    model.normalizeCommission({ id: 'c3', title: 'C', total: 700 }),
    model.normalizeCommission({ id: 'c4', title: 'D', total: 300, dueDate: '2026-09-01' }), // 逾期
    model.normalizeCommission({ id: 'c5', title: 'E', total: 400, paid: 400, dueDate: '2026-10-08' }), // 已结清
    model.normalizeCommission({ id: 'c6', title: 'F', total: 600, dueMonth: '2026-12' }),
  ];
  const payMap = model.commissionPayDueMap(commissions, 2026, 9);
  assert.deepEqual(payMap.get('2026-10-08'), { count: 1, amount: 1200 });
  assert.equal(payMap.size, 1);

  const month = model.commissionMonthPending(commissions, 2026, 9, '2026-10-01');
  assert.equal(month.total, 1000 + 700 + 300, '当月只填月份的 + 完全没填的 + 逾期');
  assert.equal(month.overdue, 300);
  assert.equal(month.count, 3);

  // 到了 10-15 再算：10-08 那笔也就逾期了，一并计入本月要掏的钱
  const later = model.commissionMonthPending(commissions, 2026, 9, '2026-10-15');
  assert.equal(later.overdue, 300 + 1200);
  assert.equal(later.total, later.overdue + 1000 + 700);
});

/* ---------------------------------------------------------- 仓库层 */

test('仓库层：记一笔 / 改一笔 / 删一笔，默认账本自带分类与账户', async () => {
  const store = await memoryStore();
  assert.equal(store.books().length, 1);
  assert.equal(store.categories('expense').length, 13);
  assert.equal(store.categories('income').length, 9);
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
  assert.equal(store.categories('expense').length, 13, '新账本有自己的分类');
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
  assert.equal(store.categories('expense').length, 14);
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
  assert.equal(store.categories('expense').length, 13);
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
    assert.equal(store.categories('expense').length, 13);
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

/* ------------------------------------------------------------ 待收款项 */

test('待收款项：规整、状态与剩余金额', () => {
  const item = model.normalizeReceivable({
    client: '  某甲方  ',
    title: '  封面插画  ',
    amount: '1500.555',
    received: 500,
    dueDate: '2026-10-20',
  });
  assert.equal(item.client, '某甲方');
  assert.equal(item.title, '封面插画');
  assert.equal(item.amount, 1500.56);
  assert.equal(item.received, 500);
  assert.equal(item.dueDate, '2026-10-20');
  assert.equal(model.receivableRemaining(item), 1000.56);
  assert.equal(model.receivableStatus(item), 'partial');
  assert.equal(model.receivableStatusLabel(item), '部分收到');

  const open = model.normalizeReceivable({ amount: 300, dueDate: '不是日期' });
  assert.equal(open.dueDate, '', '非法日期当成「时间未定」');
  assert.equal(model.receivableStatus(open), 'open');
  assert.equal(model.receivableStatusLabel(open), '未收到');

  const settled = model.normalizeReceivable({ amount: 200, received: 999 });
  assert.equal(settled.received, 200, '已收不会超过应收');
  assert.equal(model.receivableStatus(settled), 'settled');
  assert.equal(model.receivableRemaining(settled), 0);
  assert.ok(settled.settledAt);
});

test('待收款项：未结清排前面，按约定到账日，时间未定排最后', () => {
  const list = [
    model.normalizeReceivable({ id: 'a', client: 'A', amount: 100, dueDate: '2026-11-05' }),
    model.normalizeReceivable({ id: 'b', client: 'B', amount: 100, received: 100 }),
    model.normalizeReceivable({ id: 'c', client: 'C', amount: 100 }),
    model.normalizeReceivable({ id: 'd', client: 'D', amount: 100, dueDate: '2026-10-05' }),
  ];
  assert.deepEqual(
    model.sortReceivables(list).map((item) => item.id),
    ['d', 'a', 'c', 'b'],
  );
});

test('待收款项：本月预计收到 / 时间未定 / 逾期分开算', () => {
  const list = [
    model.normalizeReceivable({ amount: 800, dueDate: '2026-10-20' }), // 本月
    model.normalizeReceivable({ amount: 500, received: 200, dueDate: '2026-10-08' }), // 本月，还差 300
    model.normalizeReceivable({ amount: 400, dueDate: '2026-09-20' }), // 逾期
    model.normalizeReceivable({ amount: 1200 }), // 时间未定
    model.normalizeReceivable({ amount: 600, dueDate: '2026-12-01' }), // 以后
    model.normalizeReceivable({ amount: 999, received: 999 }), // 已结清，不计入
  ];
  const totals = model.receivableTotals(list, { today: '2026-10-01', year: 2026, month: 9 });
  assert.equal(totals.monthPending, 1100);
  assert.equal(totals.undated, 1200);
  assert.equal(totals.overdue, 400);
  assert.equal(totals.overdueCount, 1);
  assert.equal(totals.later, 600);
  assert.equal(totals.openTotal, 3300);
  assert.equal(totals.openCount, 5);
  assert.equal(totals.settled, 999);
});

test('待收款项：按甲方聚合未结与已结', () => {
  const list = [
    model.normalizeReceivable({ client: '甲', amount: 1000, received: 400, dueDate: '2026-09-01' }),
    model.normalizeReceivable({ client: '甲', amount: 500 }),
    model.normalizeReceivable({ client: '乙', amount: 800, received: 800 }),
  ];
  const rows = model.clientStats(list, '2026-10-01');
  assert.equal(rows[0].client, '甲');
  assert.equal(rows[0].pending, 1100);
  assert.equal(rows[0].settled, 400);
  assert.equal(rows[0].overdue, 600);
  assert.equal(rows[0].count, 2);
  assert.equal(rows[1].client, '乙');
  assert.equal(rows[1].pending, 0);
  assert.equal(rows[1].settled, 800);
});

test('待收款项：未来 6 个月的预计到账，时间未定单独算', () => {
  const list = [
    model.normalizeReceivable({ amount: 300, dueDate: '2026-10-10' }),
    model.normalizeReceivable({ amount: 200, dueDate: '2026-10-30' }),
    model.normalizeReceivable({ amount: 700, dueDate: '2026-11-02' }),
    model.normalizeReceivable({ amount: 900 }),
  ];
  const result = model.monthlyExpected(list, { months: 6, today: '2026-10-01' });
  assert.equal(result.months.length, 6);
  assert.deepEqual(result.months.slice(0, 2).map((item) => item.amount), [500, 700]);
  assert.equal(result.undated, 900);
});

test('仓库层：待收款项增改删 + 确认收款生成收入流水', async () => {
  const store = await memoryStore();
  const account = store.accounts()[0];
  const item = await store.addReceivable({
    client: '甲方 A',
    title: '封面',
    amount: 2000,
    dueDate: '2026-10-20',
    accountId: account.id,
  });
  assert.equal(await store.addReceivable({ amount: 0 }), null);
  assert.equal(store.receivableList().length, 1);

  // 收一半：清单里还在，只是变成部分收到
  const half = await store.settleReceivable(item.id, { amount: 1000, date: '2026-10-10' });
  assert.equal(half.amount, 1000);
  assert.equal(half.settled, false);
  assert.equal(store.receivableList()[0].received, 1000);
  assert.equal(store.ledgerList().length, 1, '收款会生成一笔收入流水');
  assert.equal(store.ledgerList()[0].type, 'income');
  assert.equal(store.ledgerList()[0].amount, 1000);
  assert.match(store.ledgerList()[0].note, /甲方 A/);
  assert.equal(store.ledgerMonthTotals(2026, 9).income, 1000);

  // 收尾款：结清，且不会再重复生成
  const rest = await store.settleReceivable(item.id, {});
  assert.equal(rest.amount, 1000);
  assert.equal(rest.settled, true);
  assert.equal(store.ledgerList().length, 2);
  assert.equal(await store.settleReceivable(item.id, {}), null);
  assert.equal(store.ledgerList().length, 2, '结清后不会再生成流水');
  assert.equal(store.receivableTotals().openTotal, 0);

  const totals = store.clientStats();
  assert.equal(totals[0].client, '甲方 A');
  assert.equal(totals[0].settled, 2000);

  await store.updateReceivable(item.id, { client: '甲方 B' });
  assert.equal(store.receivableList()[0].client, '甲方 B');
  assert.equal(await store.removeReceivable(item.id), true);
  assert.equal(store.receivableList().length, 0);
});

test('备份 v3 里带上待收款项', () => {
  const payload = model.buildExportPayload([{ id: 'e1', date: '2026-09-01', content: '日记' }], {
    receivables: [{ id: 'r1', client: '甲方', amount: 500 }],
  });
  assert.equal(payload.receivables.length, 1);
  const parsed = model.parseImport(JSON.stringify(payload));
  assert.equal(parsed.receivables.length, 1);
});

/* ------------------------------------------------------------ 约稿订单 */

test('约稿订单：规整时区分稿件截止日与尾款约定时间', () => {
  const item = model.normalizeCommission({
    title: '  双人半身  ',
    artist: '  阿蓝  ',
    total: '2000.555',
    paid: 800,
    deadline: '2026-10-20',
    dueMonth: '2026-11',
    note: '  记得要 PSD  ',
  });
  assert.equal(item.title, '双人半身');
  assert.equal(item.artist, '阿蓝');
  assert.equal(item.total, 2000.56);
  assert.equal(item.paid, 800);
  assert.equal(item.deadline, '2026-10-20');
  assert.equal(item.dueMonth, '2026-11');
  assert.equal(item.dueDate, '');
  assert.equal(item.note, '记得要 PSD');
  assert.equal(model.commissionRemaining(item), 1200.56);

  const messy = model.normalizeCommission({ title: 'X', total: 500, paid: 900, deadline: '不是日期', dueMonth: '2026-13' });
  assert.equal(messy.paid, 500, '已付不会超过总价');
  assert.equal(messy.deadline, '');
  assert.equal(messy.dueMonth, '');
});

test('约稿订单：付款状态与进度状态', () => {
  const unpaid = model.normalizeCommission({ title: 'A', total: 1000 });
  assert.equal(model.commissionPayState(unpaid), 'unpaid');
  assert.equal(model.commissionPayLabel(unpaid), '待付款');
  assert.equal(model.commissionProgressLabel(unpaid), '绘制中');
  assert.equal(model.commissionStatusLabel(unpaid), '待付款 · 绘制中');
  assert.equal(model.isCommissionClosed(unpaid), false);

  const tail = model.normalizeCommission({ title: 'A', total: 1000, paid: 300 });
  assert.equal(model.commissionPayLabel(tail), '待付尾款');

  const doneButUnpaid = model.normalizeCommission({ title: 'A', total: 1000, paid: 300, done: true });
  assert.equal(model.commissionStatusLabel(doneButUnpaid), '待付尾款 · 已完稿');
  assert.equal(model.isCommissionClosed(doneButUnpaid), false);

  const closed = model.normalizeCommission({ title: 'A', total: 1000, paid: 1000, done: true });
  assert.equal(model.commissionPayLabel(closed), '已结清');
  assert.equal(model.commissionStatusLabel(closed), '已完结');
  assert.equal(model.isCommissionClosed(closed), true);
  assert.equal(model.commissionRemaining(closed), 0);
});

test('约稿订单：尾款时间取日期优先，并按月分组', () => {
  const list = [
    model.normalizeCommission({ id: 'a', title: 'A', total: 800, done: true, deadline: '2026-10-05', dueDate: '2026-09-20' }), // 付款逾期
    model.normalizeCommission({ id: 'b', title: 'B', total: 500, paid: 200, dueDate: '2026-10-20' }), // 本月
    model.normalizeCommission({ id: 'c', title: 'C', total: 600, dueMonth: '2026-12' }), // 以后
    model.normalizeCommission({ id: 'd', title: 'D', total: 1200 }), // 时间未定
    model.normalizeCommission({ id: 'e', title: 'E', total: 300, paid: 300 }), // 已结清
  ];
  const groups = model.commissionGroups(list, { today: '2026-10-01', year: 2026, month: 9 });
  assert.deepEqual(groups.overdue.map((item) => item.id), ['a']);
  assert.deepEqual(groups.current.map((item) => item.id), ['b']);
  assert.deepEqual(groups.undated.map((item) => item.id), ['d']);
  assert.deepEqual(groups.settled.map((item) => item.id), ['e']);
  assert.equal(groups.upcoming.length, 1);
  assert.equal(groups.upcoming[0].month, '2026-12');
  assert.equal(groups.upcoming[0].remaining, 600);
  assert.equal(groups.overdueTotal, 800);
  assert.equal(groups.currentTotal, 300);
  assert.equal(groups.undatedTotal, 1200);
  assert.equal(groups.openTotal, 2900);
  assert.equal(groups.openCount, 4);

  assert.equal(model.commissionPayKey(list[1]), '2026-10-20');
  assert.equal(model.commissionPayMonth(list[2]), '2026-12');
  assert.equal(model.commissionPayKey(list[3]), '');
});

test('约稿订单：日历按稿件截止日索引，只收未完结的', () => {
  const list = [
    model.normalizeCommission({ id: 'a', title: 'A', total: 100, deadline: '2026-10-08' }),
    model.normalizeCommission({ id: 'b', title: 'B', total: 100, deadline: '2026-10-08', paid: 100, done: true }), // 已完结
    model.normalizeCommission({ id: 'c', title: 'C', total: 100, deadline: '2026-10-20', done: true }),
    model.normalizeCommission({ id: 'd', title: 'D', total: 100 }), // 没截止日
    model.normalizeCommission({ id: 'e', title: 'E', total: 100, deadline: '2026-11-02' }),
  ];
  const map = model.commissionDueMap(list, 2026, 9, '2026-10-01');
  assert.deepEqual(map.get('2026-10-08'), { count: 1, overdue: 0 });
  assert.deepEqual(map.get('2026-10-20'), { count: 1, overdue: 0 });
  assert.equal(map.has('2026-11-02'), false, '只看当月');
  assert.equal(map.size, 2);

  // 过了截止日还没画完 = 逾期
  const late = model.commissionDueMap(list, 2026, 9, '2026-10-25');
  assert.deepEqual(late.get('2026-10-08'), { count: 1, overdue: 1 });
  assert.deepEqual(late.get('2026-10-20'), { count: 1, overdue: 0 }, '已完稿不算逾期');

  assert.deepEqual(model.commissionDueOn(list, '2026-10-08').map((item) => item.id), ['a']);
  assert.equal(model.isCommissionOverdue(list[0], '2026-10-25'), true);
});

test('资金压力：预计收入 − 固定支出 − 本月尾款', () => {
  const balanced = model.pressureSummary({ salary: 8000, otherIncome: 2000, receivable: 1500, fixed: 3000, tail: 2500 });
  assert.equal(balanced.income, 11500);
  assert.equal(balanced.balance, 6000);
  assert.equal(balanced.over, false);

  const tight = model.pressureSummary({ salary: 5000, fixed: 4000, tail: 3000 });
  assert.equal(tight.balance, -2000);
  assert.equal(tight.over, true);

  assert.equal(model.pressureSummary({}).balance, 0);
});

test('仓库层：约稿订单增改删 + 付款生成支出流水', async () => {
  const store = await memoryStore();
  const today = model.todayKey();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const order = await store.addCommission({
    title: '双人半身',
    artist: '阿蓝',
    total: 2000,
    deadline: today,
    dueMonth: today.slice(0, 7),
  });
  assert.ok(order.id);
  assert.equal(await store.addCommission({ artist: '没写稿件名' }), null, '稿件名必填');
  assert.equal(store.commissionList().length, 1);
  assert.equal(store.commissionGroups(year, month).currentTotal, 2000, '只填月份的算本月要付，不算逾期');

  // 付 800：生成一笔支出，尾款变 1200，进入「待付尾款」
  const first = await store.settleCommission(order.id, { amount: 800, date: '2026-10-05' });
  assert.equal(first.amount, 800);
  assert.equal(first.settled, false);
  assert.equal(store.ledgerList().length, 1);
  assert.equal(store.ledgerList()[0].type, 'expense');
  assert.equal(store.ledgerList()[0].payableId, order.id);
  assert.equal(store.commissionById(order.id).paid, 800);
  assert.equal(model.commissionPayLabel(store.commissionById(order.id)), '待付尾款');

  // 付清：结清后再付返回 null，不重复生成流水
  const rest = await store.settleCommission(order.id, {});
  assert.equal(rest.settled, true);
  assert.equal(store.ledgerList().length, 2);
  assert.equal(await store.settleCommission(order.id, {}), null);
  assert.equal(store.ledgerList().length, 2);
  assert.equal(store.commissionGroups(year, month).openTotal, 0);

  // 完稿 + 结清 = 已完结
  await store.toggleCommissionDone(order.id);
  assert.equal(model.isCommissionClosed(store.commissionById(order.id)), true);
  await store.updateCommission(order.id, { artist: '阿蓝蓝' });
  assert.equal(store.commissionById(order.id).artist, '阿蓝蓝');
  assert.equal(await store.removeCommission(order.id), true);
  assert.equal(store.commissionList().length, 0);
});

test('仓库层：本月待付尾款与资金压力', async () => {
  const store = await memoryStore();
  const today = model.todayKey();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;
  const monthPrefix = model.monthKey(year, month);
  await store.addCommission({ title: '本月', total: 1000, dueDate: today, deadline: today });
  await store.addCommission({ title: '逾期', total: 500, dueDate: '2020-01-01' });
  await store.addCommission({ title: '下个月', total: 700, dueMonth: `${year + 1}-01` });
  await store.addCommission({ title: '没定时间', total: 300 });
  const dueThisMonth = store.commissionDueThisMonth(year, month);
  assert.equal(dueThisMonth, 1500, '本月 + 逾期都算这个月要掏的钱');

  const pressure = store.pressure(year, month);
  assert.equal(pressure.tail, dueThisMonth);
  assert.equal(pressure.balance, model.toMoney(pressure.income - pressure.fixed - pressure.tail));

  const dueMap = store.commissionDueMap(year, month);
  assert.equal(dueMap.size, 1, '只有填了稿件截止日的那条进日历');
  assert.equal(dueMap.get(today).count, 1);
  assert.equal(store.commissionsDueOn(today).length, 1);
  assert.equal(store.commissionsDueOn(today)[0].title, '本月');
  assert.equal(monthPrefix.length, 7);
});

test('备份 v3 里带上约稿订单', () => {
  const payload = model.buildExportPayload([], { payables: [{ id: 'p1', title: '双人半身', total: 2000 }] });
  assert.equal(payload.payables.length, 1);
  const parsed = model.parseImport(JSON.stringify(payload));
  assert.equal(parsed.payables.length, 1);
});

/* ------------------------------------------- 老库升级 / 待收联动待办 */

test('老库升级：自动补齐缺失的「约稿」分类，付款记成约稿而不是餐饮', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  try {
    // 模拟 v5 的老库：只有老的内置分类，没有「约稿」
    const book = { id: 'b1', name: '日常账本', createdAt: 1 };
    const legacyCategories = model
      .createDefaultCategories('b1')
      .filter((item) => item.name !== '约稿' && item.name !== '约稿收入');
    localStorage.setItem('diary:books', JSON.stringify([book]));
    localStorage.setItem('diary:categories', JSON.stringify(legacyCategories));
    localStorage.setItem('diary:accounts', JSON.stringify([{ id: 'a1', bookId: 'b1', name: '现金', kind: 'cash', initialBalance: 0, order: 1 }]));

    const store = createStore(db.createLocalStorageAdapter());
    await store.init();
    assert.equal(store.categories('expense').some((item) => item.name === '约稿'), true, '缺的预置分类要补上');
    assert.equal(store.categories('income').some((item) => item.name === '约稿收入'), true);

    const order = await store.addCommission({ title: '双人半身', total: 1000, dueDate: todayKeyish() });
    await store.settleCommission(order.id, { amount: 200 });
    const entry = store.ledgerList()[0];
    assert.equal(store.categoryById(entry.categoryId).name, '约稿');
  } finally {
    delete globalThis.localStorage;
  }
});

test('待收款项 ↔ 待办联动：建、改期、清空、收齐、删除', async () => {
  const store = await memoryStore();
  const item = await store.addReceivable({ client: '甲方 A', title: '封面', amount: 1500, dueDate: '2026-10-20' });
  assert.equal(store.todoList().length, 1, '填了到账日就自动建待办');
  assert.equal(store.todoList()[0].dueDate, '2026-10-20');
  assert.equal(store.todoList()[0].receivableId, item.id);
  assert.match(store.todoList()[0].text, /甲方 A/);
  assert.match(store.todoList()[0].text, /1,500/);

  // 没有到账日的待收不建待办
  const undated = await store.addReceivable({ client: '乙方', amount: 300 });
  assert.equal(store.todoList().length, 1);

  // 改日期 → 待办跟着改
  await store.updateReceivable(item.id, { dueDate: '2026-11-05' });
  assert.equal(store.todoList()[0].dueDate, '2026-11-05');

  // 部分收款 → 文案里的剩余金额跟着变
  await store.settleReceivable(item.id, { amount: 500 });
  assert.match(store.todoList()[0].text, /1,000/);
  assert.equal(store.todoList()[0].done, false);

  // 收齐 → 待办自动完成
  await store.settleReceivable(item.id, {});
  assert.equal(store.todoList().find((todo) => todo.receivableId === item.id).done, true);

  // 清空到账日 → 关联待办撤掉
  await store.updateReceivable(undated.id, { dueDate: '2026-10-09' });
  assert.equal(store.todoList().length, 2);
  await store.updateReceivable(undated.id, { dueDate: '' });
  assert.equal(store.todoList().filter((todo) => todo.receivableId === undated.id).length, 0);

  // 删除待收 → 连带删掉待办
  await store.updateReceivable(item.id, { received: 0, dueDate: '2026-10-20' });
  await store.removeReceivable(item.id);
  assert.equal(store.todoList().some((todo) => todo.receivableId === item.id), false);
});

function todayKeyish() {
  return model.toDateKey(Date.now());
}

/* -------------------------------------------------- 引用记账 / 备份往返 */

test('引用记账：支出 / 收入 / 转账 / 无备注四种文案', () => {
  const categories = [{ id: 'c1', name: '餐饮' }, { id: 'c2', name: '工资' }];
  const accounts = [{ id: 'a1', name: '现金' }, { id: 'a2', name: '招行卡' }];

  const expense = model.ledgerQuoteLine(
    model.normalizeLedger({ type: 'expense', amount: 25, date: '2026-09-26', time: '21:10', categoryId: 'c1', note: '楼下的小面馆' }),
    { categories, accounts },
  );
  assert.equal(expense, '> 09-26 21:10 餐饮 ¥25 · 楼下的小面馆');

  const income = model.ledgerQuoteLine(
    model.normalizeLedger({ type: 'income', amount: 5000, date: '2026-09-26', time: '09:00', categoryId: 'c2' }),
    { categories, accounts },
  );
  assert.equal(income, '> 09-26 09:00 工资 +¥5,000');

  const transfer = model.ledgerQuoteLine(
    model.normalizeLedger({ type: 'transfer', amount: 500, date: '2026-09-26', time: '18:30', accountId: 'a1', toAccountId: 'a2' }),
    { categories, accounts },
  );
  assert.equal(transfer, '> 09-26 18:30 转账 ¥500 · 现金 → 招行卡');

  const noNote = model.ledgerQuoteLine(
    model.normalizeLedger({ type: 'expense', amount: 8, date: '2026-09-26', time: '07:40', categoryId: 'c1' }),
    { categories, accounts },
  );
  assert.equal(noNote, '> 09-26 07:40 餐饮 ¥8');
});

test('备份往返：自家 JSON 保住日记时间与记账 / 待办', async () => {
  const payload = model.buildExportPayload(
    [{ id: 'e1', date: '2026-09-26', time: '21:10', content: '测试', createdAt: Date.parse('2026-09-26T21:10:00') }],
    {
      books: [{ id: 'b1', name: '日常账本', createdAt: 1 }],
      categories: [{ id: 'c1', bookId: 'b1', kind: 'expense', name: '餐饮' }],
      ledger: [{ id: 'l1', bookId: 'b1', type: 'expense', amount: 25, date: '2026-09-26', time: '09:05' }],
      todos: [{ id: 't1', text: '买牛奶', dueTime: '14:30' }],
    },
  );
  const out = await importer.parseBackup({
    bytes: new TextEncoder().encode(JSON.stringify(payload)),
    filename: '备份.json',
  });
  assert.equal(out.entries[0].time, '21:10', '日记的具体时间不能被冲成 00:00');
  assert.equal(out.ledger.length, 1);
  assert.equal(out.ledger[0].time, '09:05');
  assert.equal(out.todos.length, 1);
  assert.equal(out.todos[0].dueTime, '14:30');
  assert.equal(out.categories.length, 1);
});

test('备份往返：完整备份 ZIP 同样保住时间与集合', async () => {
  const payload = model.buildExportPayload(
    [{ id: 'e1', date: '2026-09-26', time: '21:10', content: '测试', createdAt: Date.parse('2026-09-26T21:10:00') }],
    {
      books: [{ id: 'b1', name: '日常账本', createdAt: 1 }],
      ledger: [{ id: 'l1', bookId: 'b1', type: 'expense', amount: 25, date: '2026-09-26', time: '09:05' }],
      todos: [{ id: 't1', text: '买牛奶', dueTime: '14:30' }],
      payables: [{ id: 'p1', bookId: 'b1', title: '双人半身', total: 2000 }],
      receivables: [{ id: 'r1', bookId: 'b1', client: '甲方', amount: 800 }],
    },
  );
  const zipBytes = await Diary.zip.createZip([{ name: 'entries.json', data: JSON.stringify(payload) }]);
  const out = await importer.parseBackup({ bytes: zipBytes, filename: '完整备份.zip' });
  assert.equal(out.entries[0].time, '21:10');
  assert.equal(out.ledger.length, 1);
  assert.equal(out.todos.length, 1);
  assert.equal(out.books.length, 1);
  assert.equal(out.payables.length, 1);
  assert.equal(out.receivables.length, 1);
});

test('覆盖导入：备份里没有的表不会被清空', async () => {
  const store = await memoryStore();
  await store.addLedger({ type: 'expense', amount: 30, date: '2026-09-26' });
  await store.addTodo('原来的待办');
  assert.equal(store.ledgerList().length, 1);

  // 一份只有日记的备份（v2 老格式）
  await store.importResult({ entries: [{ id: 'e9', date: '2026-09-26', content: '导入的日记' }] }, 'replace');
  assert.equal(store.list().length, 1);
  assert.equal(store.ledgerList().length, 1, '记账不该被清掉');
  assert.equal(store.todoList().length, 1, '待办不该被清掉');

  // 带了记账的备份才整表替换
  await store.importResult(
    {
      entries: [{ id: 'e9', date: '2026-09-26', content: '导入的日记' }],
      ledger: [{ id: 'l9', bookId: store.activeBookId, type: 'income', amount: 99, date: '2026-09-27' }],
    },
    'replace',
  );
  assert.equal(store.ledgerList().length, 1);
  assert.equal(store.ledgerList()[0].amount, 99);
});
