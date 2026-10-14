import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { loadSource } from '../tools/load-source.mjs';

// 浏览器里是 <script> 直接加载，测试里用同一个加载器，源码只有一份
const { model } = loadSource('js/model.js');
const {
  buildExportPayload,
  collectTags,
  computeStreak,
  createEntry,
  dateLabel,
  dayDiff,
  entryExcerpt,
  entryTitle,
  filterEntries,
  groupByDate,
  isEmptyEntry,
  isValidDateKey,
  normalizeEntry,
  normalizeTags,
  parseDateKey,
  parseImport,
  renderMarkdown,
  shiftDateKey,
  sortEntries,
  toDateKey,
  toMarkdown,
  toTimeKey,
  utf8Length,
  wordCount,
} = model;

const entry = (patch) =>
  normalizeEntry({ id: patch.id ?? `id-${patch.date}`, createdAt: Date.parse(`${patch.date}T08:00:00`) , ...patch });

/* ------------------------------------------------------------------ 日期 */

test('日期键可以来回转换，并且按本地时区处理', () => {
  const date = new Date(2026, 8, 26, 23, 30);
  assert.equal(toDateKey(date), '2026-09-26');
  assert.equal(toTimeKey(date), '23:30');
  const parsed = parseDateKey('2026-09-26');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 26);
  assert.equal(parsed.getHours(), 0);
});

test('非法日期不会被当成有效值', () => {
  assert.equal(isValidDateKey('2026-02-31'), false);
  assert.equal(isValidDateKey('2026-13-01'), false);
  assert.equal(isValidDateKey('26-01-01'), false);
  assert.equal(isValidDateKey(''), false);
  assert.equal(isValidDateKey(null), false);
  assert.equal(isValidDateKey('2024-02-29'), true);
});

test('dayDiff 与 shiftDateKey 跨月跨年都正确', () => {
  assert.equal(dayDiff('2026-09-26', '2026-09-26'), 0);
  assert.equal(dayDiff('2026-09-26', '2026-09-25'), 1);
  assert.equal(dayDiff('2026-09-01', '2026-08-31'), 1);
  assert.equal(shiftDateKey('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDateKey('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDateKey('bad', 1), '');
});

test('分组标题：今天 / 昨天 / 前天 / 具体日期', () => {
  const today = '2026-09-26';
  assert.equal(dateLabel('2026-09-26', today), '今天');
  assert.equal(dateLabel('2026-09-25', today), '昨天');
  assert.equal(dateLabel('2026-09-24', today), '前天');
  assert.equal(dateLabel('2026-09-20', today), '9月20日 周日');
  assert.equal(dateLabel('2025-12-01', today), '2025年12月1日');
});

/* ------------------------------------------------------------------ 条目 */

test('createEntry 生成完整的空条目', () => {
  const created = createEntry(Date.parse('2026-09-26T21:05:00'), 'fixed-id');
  assert.deepEqual(created, {
    id: 'fixed-id',
    date: '2026-09-26',
    time: '21:05',
    title: '',
    content: '',
    tags: [],
    pinned: false,
    media: [],
    quotes: [],
    source: '',
    createdAt: Date.parse('2026-09-26T21:05:00'),
    updatedAt: Date.parse('2026-09-26T21:05:00'),
  });
  assert.equal(isEmptyEntry(created), true);
  assert.equal(isEmptyEntry({ ...created, content: '写点什么' }), false);
});

test('normalizeEntry 能修好脏数据', () => {
  const fixed = normalizeEntry(
    {
      id: '  entry-1 ',
      date: '2026-02-31',
      time: '25:99',
      content: 123,
      pinned: 'yes',
      tags: '工作，灵感, 工作',
      createdAt: '2026-09-26T08:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    },
    Date.parse('2026-09-26T08:00:00.000Z'),
  );

  assert.equal(fixed.id, 'entry-1');
  assert.equal(fixed.date, toDateKey(fixed.createdAt)); // 非法日期回退到创建时间
  assert.equal(fixed.time, toTimeKey(fixed.createdAt)); // 非法时间按创建时间重算
  assert.equal(fixed.content, '123');
  assert.equal(fixed.pinned, true);
  assert.deepEqual(fixed.tags, ['工作', '灵感']);
  assert.equal(fixed.updatedAt >= fixed.createdAt, true); // 更新时间不会早于创建时间
});

test('标题与摘要会自动回退到正文', () => {
  assert.equal(entryTitle({ title: '周末', content: '正文' }), '周末');
  assert.equal(entryTitle({ title: '  ', content: '## 爬山\n今天天气不错' }), '爬山');
  assert.equal(entryTitle({ title: '', content: '- 买牛奶' }), '买牛奶');
  assert.equal(entryTitle({ title: '', content: '   ' }), '无标题');

  const long = 'a'.repeat(120);
  assert.equal(entryExcerpt({ title: '', content: long }, 10).length, 11); // 10 个字 + 省略号
  assert.equal(entryExcerpt({ title: '标题', content: '标题后面的话' }), '后面的话');
  assert.equal(entryExcerpt({ title: '', content: '' }), '');
});

test('标签会去重、去掉 # 前缀并限制数量', () => {
  assert.deepEqual(normalizeTags('工作, 灵感；工作 , #读书'), ['工作', '灵感', '读书']);
  assert.deepEqual(normalizeTags(['  a  ', 'A', 'b']), ['a', 'b']);
  assert.equal(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12);
  assert.deepEqual(normalizeTags(''), []);
  assert.deepEqual(normalizeTags(undefined), []);
});

test('字数统计把中文按字、英文按词计算', () => {
  assert.equal(wordCount('你好世界'), 4);
  assert.equal(wordCount('hello world'), 2);
  assert.equal(wordCount('你好 world 2026'), 4); // 2 个汉字 + 2 个英文/数字词
  assert.equal(wordCount('   '), 0);
  assert.equal(wordCount(''), 0);
});

/* -------------------------------------------------------------- 筛选排序 */

const sample = [
  entry({ id: 'a', date: '2026-09-26', time: '09:00', title: '今天', content: '写代码', tags: ['工作'], pinned: false }),
  entry({ id: 'b', date: '2026-09-20', time: '20:00', title: '上周', content: '爬山看日落', tags: ['生活'], mood: 'great' }),
  entry({ id: 'c', date: '2026-09-25', time: '12:00', title: '置顶的旧日记', content: '生日快乐', tags: ['生活', '纪念'], pinned: true }),
];

test('筛选：关键词、标签、时间范围、收藏', () => {
  assert.equal(filterEntries(sample, { query: '爬山' }).length, 1);
  assert.equal(filterEntries(sample, { query: '生活' }).length, 2); // 标签也能搜到
  assert.equal(filterEntries(sample, { tag: '生活' }).length, 2);
  assert.equal(filterEntries(sample, { filter: 'pinned' }).length, 1);
  assert.equal(filterEntries(sample, { filter: 'today', today: '2026-09-26' }).length, 1);
  assert.equal(filterEntries(sample, { filter: 'week', today: '2026-09-26' }).length, 3); // 含 6 天前那条
  assert.equal(filterEntries(sample, { query: '不存在的关键词' }).length, 0);
  assert.equal(filterEntries(null).length, 0);
});

test('标签筛选忽略英文大小写', () => {
  const list = [entry({ id: 'x', date: '2026-09-26', content: 'x', tags: ['Work'] })];
  assert.equal(filterEntries(list, { tag: 'work' }).length, 1);
  assert.equal(filterEntries(list, { tag: 'WORK' }).length, 1);
  assert.equal(filterEntries(list, { tag: '生活' }).length, 0);
});

test('排序：置顶最前，其余按日期倒序', () => {
  assert.deepEqual(
    sortEntries(sample).map((item) => item.id),
    ['c', 'a', 'b'],
  );
  assert.deepEqual(
    sortEntries(sample, 'asc').map((item) => item.id),
    ['c', 'b', 'a'],
  );
});

test('重新编辑旧日记不会改变它在列表里的位置', () => {
  const list = [
    normalizeEntry({ id: 'a', date: '2026-09-20', content: '最早的一篇', createdAt: 3, updatedAt: 3 }),
    normalizeEntry({ id: 'b', date: '2026-09-26', content: '今天', createdAt: 2, updatedAt: 2 }),
    normalizeEntry({ id: 'c', date: '2026-09-25', content: '昨天', createdAt: 1, updatedAt: 1 }),
  ];
  const before = sortEntries(list).map((item) => item.id);
  assert.deepEqual(before, ['b', 'c', 'a']);

  // 模拟「重新编辑了最早那篇」：updatedAt 被刷新成最新
  const edited = list.map((item) => (item.id === 'a' ? { ...item, updatedAt: 999999 } : item));
  assert.deepEqual(sortEntries(edited).map((item) => item.id), before);

  // 同一天的多篇：按创建时间倒序，编辑其中一篇也不会插到前面
  const sameDay = [
    normalizeEntry({ id: 'x', date: '2026-09-26', content: '早上', createdAt: 10, updatedAt: 10 }),
    normalizeEntry({ id: 'y', date: '2026-09-26', content: '晚上', createdAt: 20, updatedAt: 20 }),
  ];
  assert.deepEqual(sortEntries(sameDay).map((item) => item.id), ['y', 'x']);
  const editedSameDay = sameDay.map((item) => (item.id === 'x' ? { ...item, updatedAt: 999999 } : item));
  assert.deepEqual(sortEntries(editedSameDay).map((item) => item.id), ['y', 'x']);
});

test('按日期分组并统计标签', () => {
  const groups = groupByDate(sample);
  // 收藏的置顶，所以它所在的日期分组排在最前
  assert.deepEqual(
    groups.map((group) => group.date),
    ['2026-09-25', '2026-09-26', '2026-09-20'],
  );
  assert.deepEqual(
    groups.map((group) => group.entries.map((item) => item.id)),
    [['c'], ['a'], ['b']],
  );
  assert.deepEqual(collectTags(sample), [
    { tag: '生活', count: 2 },
    { tag: '工作', count: 1 },
    { tag: '纪念', count: 1 },
  ]);
});

test('连续记录统计含当前与最长天数', () => {
  const streak = computeStreak(sample, '2026-09-26');
  assert.equal(streak.current, 2); // 9-26 与 9-25 连着
  assert.equal(streak.longest, 2);
  assert.equal(streak.days, 3);
  assert.equal(streak.since, '2026-09-20');

  // 今天没写但昨天写了，连续记录不算断
  assert.equal(computeStreak(sample, '2026-09-27').current, 2);
  // 隔了一天就算断
  assert.equal(computeStreak(sample, '2026-09-28').current, 0);
  assert.deepEqual(computeStreak([], '2026-09-26'), { current: 0, longest: 0, days: 0, since: null });
});

/* ------------------------------------------------------------ 导入导出 */

test('导出 JSON 再导入回来内容不丢', () => {
  const payload = buildExportPayload(sample, { now: Date.parse('2026-09-26T10:00:00') });
  assert.equal(payload.count, 3);
  assert.equal(payload.entries[0].id, 'c'); // 导出按时间正序

  const parsed = parseImport(JSON.stringify(payload));
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.skipped, 0);
  assert.deepEqual(
    parsed.entries.map((item) => item.id).sort(),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(parsed.entries.find((item) => item.id === 'c').tags, ['生活', '纪念']);
});

test('导入兼容纯数组，并忽略空记录', () => {
  const parsed = parseImport(JSON.stringify([{ date: '2026-09-26', content: '有内容' }, { date: '2026-09-26' }]));
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.total, 2);
  assert.throws(() => parseImport('这不是 json'), /JSON/);
  assert.throws(() => parseImport('{"foo":1}'), /entries/);
});

test('Markdown 导出带标题、时间与标签', () => {
  const markdown = toMarkdown([sample[0]], { now: Date.parse('2026-09-26T10:00:00') });
  assert.match(markdown, /^# 我的日记/);
  assert.match(markdown, /## 今天/);
  assert.match(markdown, /2026-09-26 09:00/);
  assert.match(markdown, /#工作/);
});

test('utf8Length 按字节统计', () => {
  assert.equal(utf8Length('abc'), 3);
  assert.equal(utf8Length('中文'), 6);
  assert.equal(utf8Length('😄'), 4);
  assert.equal(utf8Length(''), 0);
});

/* -------------------------------------------------------- Markdown 渲染 */

test('Markdown 渲染会转义 HTML，避免注入', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('&lt;script&gt;'), true);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('&lt;img'), true);
});

test('Markdown 只放行 http/https 链接', () => {
  const safe = renderMarkdown('[官网](https://example.com)');
  assert.match(safe, /<a href="https:\/\/example\.com"[^>]*>官网<\/a>/);

  const unsafe = renderMarkdown('[点我](javascript:alert(1))');
  assert.equal(unsafe.includes('href="javascript'), false);
  assert.equal(unsafe.includes('[点我]'), true);
});

test('Markdown 支持标题、列表、引用、加粗与行内代码', () => {
  const html = renderMarkdown('# 标题\n- 第一项\n- 第二项\n> 引用\n**粗** 与 `code`');
  assert.match(html, /<h3>标题<\/h3>/);
  assert.match(html, /<ul>\n<li>第一项<\/li>\n<li>第二项<\/li>\n<\/ul>/);
  assert.match(html, /<blockquote>\n<p>引用<\/p>\n<\/blockquote>/);
  assert.match(html, /<strong>粗<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.equal(renderMarkdown(''), '');
});

/* ------------------------------------------------------------ 日历相关 */

test('月历按周一开始，不足整行的最后一行被裁掉', () => {
  // 2026 年 9 月 1 日是周二，所以第一行周一的位置是空的
  const weeks = model.monthGrid(2026, 8);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0][0].inMonth, false);
  assert.equal(weeks[0][1].date, '2026-09-01');
  assert.equal(weeks[0][6].date, '2026-09-06');
  assert.equal(weeks[4][2].date, '2026-09-30');
  assert.equal(weeks.every((week) => week.length === 7), true);
  // 2024 年 9 月 1 日是周日，第一行只有最后一格属于本月
  const weeks2 = model.monthGrid(2024, 8);
  assert.equal(weeks2[0][6].date, '2024-09-01');
  assert.equal(weeks2[0][0].inMonth, false);
});

test('相邻月份切换与月份键', () => {
  assert.deepEqual(model.addMonths(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(model.addMonths(2026, 11, 1), { year: 2027, month: 0 });
  assert.equal(model.monthKey(2026, 8), '2026-09');
});

test('热力图：13 周 × 7 天，今天是最后一周的对应位置', () => {
  const weeks = model.activityWeeks([{ date: '2026-09-26' }], { weeks: 13, today: '2026-09-26' });
  assert.equal(weeks.length, 13);
  assert.equal(weeks[0].length, 7);
  const flat = weeks.flat();
  assert.equal(flat.length, 91);
  const todayCell = flat.find((cell) => cell.today);
  assert.equal(todayCell.date, '2026-09-26');
  assert.equal(todayCell.count, 1);
  assert.equal(flat.filter((cell) => cell.future).length, 1); // 本周日在今天之后
  assert.equal(flat[0].date, '2026-06-29'); // 13 周前的周一
});

test('月度统计与卡片日期格式', () => {
  const entries = [
    { date: '2026-09-26' },
    { date: '2026-09-20' },
    { date: '2026-08-01' },
  ];
  const months = model.monthlyCounts(entries, 3, '2026-09-26');
  assert.deepEqual(months.map((item) => item.label), ['7月', '8月', '9月']);
  assert.deepEqual(months.map((item) => item.count), [0, 1, 2]);
  assert.deepEqual(model.cardDate('2026-09-26'), { day: '26', weekday: '周六' });
  assert.deepEqual(model.headerDate('2026-09-26'), { main: '9月26日', year: '2026', weekday: '周六' });
});

test('预览文本会去掉 Markdown 记号', () => {
  assert.equal(model.stripMarkdown('## 标题\n\n**加粗** 和 [链接](https://a.com)'), '标题 加粗 和 链接');
  assert.equal(model.stripMarkdown('> 引用\n- 列表项'), '引用 列表项');
  assert.equal(entryExcerpt({ title: '', content: '# 晚安\n`code` 结束' }), '晚安 code 结束');
});

test('带图片的条目不算空条目', () => {
  assert.equal(isEmptyEntry({ title: '', content: '', media: ['a'] }), false);
  assert.equal(isEmptyEntry({ title: '', content: '', media: [] }), true);
  const entry = normalizeEntry({ content: '', media: ['a', 'b', 3, null] });
  assert.deepEqual(entry.media, ['a', 'b']);
});
