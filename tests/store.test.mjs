import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { loadSource } from '../tools/load-source.mjs';

const Diary = loadSource('js/model.js', 'js/db.js', 'js/store.js');
const { createMemoryAdapter } = Diary.db;
const createStore = Diary.createStore;

const seed = [
  { id: 'a', date: '2026-09-24', content: '前天', tags: ['生活'], createdAt: 1, updatedAt: 1 },
  { id: 'b', date: '2026-09-26', content: '今天', tags: ['工作'], createdAt: 2, updatedAt: 2 },
];

test('初始化：读入数据并补全字段', async () => {
  const store = createStore(createMemoryAdapter(seed));
  const entries = await store.init();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'b'); // 默认按日期倒序
  assert.deepEqual(entries[0].tags, ['工作']);
  assert.equal(store.ready, true);
  assert.equal(store.kind, 'memory');
});

test('新增 / 更新 / 删除', async () => {
  const store = createStore(createMemoryAdapter());
  await store.init();

  const saved = await store.save({ id: 'x', date: '2026-09-26', content: '第一篇' });
  assert.equal(store.list().length, 1);
  assert.equal(store.get('x').content, '第一篇');

  await store.save({ ...saved, content: '改过了' });
  assert.equal(store.list().length, 1, '同一 id 不应该产生新条目');
  assert.equal(store.get('x').content, '改过了');

  await store.remove('x');
  assert.equal(store.list().length, 0);
  assert.equal(store.get('x'), null);
});

test('合并导入：更新的覆盖，旧的跳过', async () => {
  const store = createStore(createMemoryAdapter(seed));
  await store.init();

  const result = await store.mergeAll([
    { id: 'a', date: '2026-09-24', content: '导入的旧内容', createdAt: 1, updatedAt: 1 }, // 与现有同版本 → 跳过
    { id: 'b', date: '2026-09-26', content: '导入的新内容', createdAt: 99, updatedAt: 99 }, // 更新 → 覆盖
    { id: 'c', date: '2026-09-27', content: '全新条目', createdAt: 5, updatedAt: 5 },
  ]);

  assert.deepEqual(result, { added: 1, updated: 1, skipped: 1 });
  assert.equal(store.get('a').content, '前天');
  assert.equal(store.get('b').content, '导入的新内容');
  assert.equal(store.get('c').content, '全新条目');
  assert.equal(store.list().length, 3);
});

test('覆盖导入会清掉旧数据', async () => {
  const store = createStore(createMemoryAdapter(seed));
  await store.init();
  const count = await store.replaceAll([{ id: 'z', date: '2026-09-26', content: '只留这篇' }]);
  assert.equal(count, 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.get('a'), null);
});

test('订阅会在数据变化时收到通知', async () => {
  const store = createStore(createMemoryAdapter());
  await store.init();
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });
  await store.save({ id: 'n', date: '2026-09-26', content: 'hi' });
  assert.equal(calls, 1);
  unsubscribe();
  await store.save({ id: 'n2', date: '2026-09-26', content: 'hi again' });
  assert.equal(calls, 1);
});

test('统计包含篇数、天数、连续天数与占用空间', async () => {
  const store = createStore(createMemoryAdapter(seed));
  await store.init();
  const stats = store.stats();
  assert.equal(stats.count, 2);
  assert.equal(stats.days, 2);
  assert.equal(stats.words, 4); // 「前天」+「今天」
  assert.equal(stats.bytes > 0, true);
  assert.equal(stats.storage, 'memory');
});

test('导出 Markdown / 纯文本 / JSON', async () => {
  const store = createStore(createMemoryAdapter(seed));
  await store.init();
  assert.match(store.exportMarkdown(), /## 前天/);
  assert.match(store.exportPlainText(), /【2026-09-26 08:00】今天/);
  assert.equal(store.exportPayload().count, 2);
});

test('存储坏掉时会退化为内存模式而不是崩溃', async () => {
  const broken = {
    kind: 'indexeddb',
    async getAll() {
      throw new Error('IndexedDB 被禁用');
    },
  };
  const store = createStore(broken);
  const entries = await store.init();
  assert.deepEqual(entries, []);
  assert.equal(store.degraded, true);
  assert.equal(store.kind, 'memory');
  await store.save({ id: 'a', date: '2026-09-26', content: '内存里也能写' });
  assert.equal(store.list().length, 1);
});
