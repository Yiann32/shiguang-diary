import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assembleZip, aesEntry, buildDemoMbk, plainEntry } from '../tools/mbk-fixture.mjs';

import { loadSource } from '../tools/load-source.mjs';

const Diary = loadSource('js/aes.js', 'js/model.js', 'js/zip.js', 'js/importer.js');
const { aes, zip, importer, model } = Diary;

/* ------------------------------------------------------------------ AES */

test('AES 实现符合 FIPS-197 标准向量', () => {
  const hex = (text) => Uint8Array.from(text.match(/../g).map((item) => parseInt(item, 16)));
  const toHex = (bytes) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const plaintext = hex('00112233445566778899aabbccddeeff');
  const key128 = hex('000102030405060708090a0b0c0d0e0f');
  const key256 = hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f');
  assert.equal(toHex(aes.encryptBlock(aes.expandKey(key128), plaintext)), '69c4e0d86a7b0430d8cdb78070b4c55a');
  assert.equal(toHex(aes.encryptBlock(aes.expandKey(key256), plaintext)), '8ea2b7ca516745bfeafc49904b496089');
});

test('CTR 加解密可逆，计数器按小端递增', () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index);
  const data = Uint8Array.from({ length: 100 }, (_, index) => (index * 7) % 256);
  const encrypted = aes.ctrXor(key, data);
  assert.notDeepEqual([...encrypted], [...data]);
  assert.deepEqual([...aes.ctrXor(key, encrypted)], [...data]);
  // 小端计数器第 2 块与第 1 块的密钥流不同
  assert.notDeepEqual([...aes.ctrXor(key, data)][0], [...aes.ctrXor(key, data)][16]);
});

/* ------------------------------------------------------------------ ZIP */

test('自建 ZIP 能被读出（含中文文件名与图片字节）', async () => {
  const bytes = new Uint8Array(assembleZip([plainEntry('entries.json', '{"a":1}'), plainEntry('media/图.jpg', 'IMAGE')]));
  assert.equal(zip.isZip(bytes), true);
  const list = zip.listEntries(bytes);
  assert.deepEqual(list.map((item) => item.name), ['entries.json', 'media/图.jpg']);
  assert.equal(zip.needsPassword(bytes), false);
  const first = await zip.readEntry(bytes, list[0]);
  assert.equal(Buffer.from(first).toString('utf8'), '{"a":1}');
  const second = await zip.readEntry(bytes, list[1]);
  assert.equal(Buffer.from(second).toString('utf8'), 'IMAGE');
});

test('createZip 打出来的包能自己读回来', async () => {
  const bytes = await zip.createZip([
    { name: 'entries.json', data: '{"count":1}' },
    { name: 'media/a.txt', data: 'hello 世界' },
  ]);
  const list = zip.listEntries(bytes);
  assert.equal(list.length, 2);
  assert.equal(Buffer.from(await zip.readEntry(bytes, list[0])).toString('utf8'), '{"count":1}');
  assert.equal(Buffer.from(await zip.readEntry(bytes, list[1])).toString('utf8'), 'hello 世界');
});

test('WinZip AES 加密条目：口令正确才能解开', async () => {
  const content = JSON.stringify({ content: '加密的日记内容', date: '2026-09-26 20:00:00' });
  const bytes = new Uint8Array(assembleZip([aesEntry('LockTimeDiaryData/x/DiaryContent', content, '201505')]));

  assert.equal(zip.needsPassword(bytes), true);
  const list = zip.listEntries(bytes);
  assert.equal(list[0].method, 99);
  assert.equal(list[0].encrypted, true);

  const ok = await zip.readEntry(bytes, list[0], { password: '201505' });
  assert.equal(Buffer.from(ok).toString('utf8'), content);

  await assert.rejects(() => zip.readEntry(bytes, list[0], { password: '000000' }), (error) => error.code === 'PASSWORD');
  await assert.rejects(() => zip.readEntry(bytes, list[0], {}), (error) => error.code === 'PASSWORD');
});

/* ------------------------------------------------------------- 导入识别 */

test('detect 能区分 JSON / ZIP / 文本', () => {
  const json = new TextEncoder().encode('{"entries":[]}');
  assert.equal(importer.detect(json, 'a.json').kind, 'json');
  const text = new TextEncoder().encode('今天天气很好');
  assert.equal(importer.detect(text, 'a.txt').kind, 'text');
  const mbk = new Uint8Array(assembleZip([aesEntry('LockTimeDiaryData/x/DiaryContent', '{}', 'pw')]));
  const info = importer.detect(mbk, 'Diary_123.mbk');
  assert.equal(info.kind, 'mbk');
  assert.equal(info.needsPassword, true);
});

test('各种日期写法都能识别', () => {
  assert.equal(importer.normalizeDate('2026-09-26 20:15:00').date, '2026-09-26');
  assert.equal(importer.normalizeDate('2026-09-26 20:15:00').time, '20:15');
  assert.equal(importer.normalizeDate('2026/9/6').date, '2026-09-06');
  assert.equal(importer.normalizeDate('2026年9月26日').date, '2026-09-26');
  assert.equal(importer.normalizeDate('20260926').date, '2026-09-26');
  assert.equal(importer.normalizeDate(1790000000).date, model.toDateKey(1790000000 * 1000));
  assert.equal(importer.normalizeDate(''), null);
  assert.equal(importer.normalizeDate('不是日期'), null);
});

test('通用 JSON 记录能映射成条目', () => {
  const entry = importer.mapRecord({
    标题: '标题会走别名',
    body: '<p>第一段</p><p>第二段</p>',
    createTime: '2026-09-26 21:30:00',
    labels: ['生活', '散步'],
  });
  assert.equal(entry.content, '第一段\n第二段');
  assert.equal(entry.date, '2026-09-26');
  assert.equal(entry.time, '21:30');
  assert.deepEqual(entry.tags, ['生活', '散步']);
});

test('能处理按日期做键的 JSON 结构', () => {
  const entries = importer.recordsFromJson({
    entries: [
      { date: '2026-09-26', text: '有正文' },
      { date: '2026-09-25', text: '' },
    ],
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].content, '有正文');
});

test('HTML 正文会转成纯文本', () => {
  assert.equal(importer.htmlToText('<div>你好<br>世界</div>'), '你好\n世界');
  assert.equal(importer.htmlToText('<p>a &amp; b</p>'), 'a & b');
  assert.equal(importer.looksLikeHtml('普通文本'), false);
});

test('导入 ZIP 备份：条目与图片都能带进来', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
  const payload = JSON.stringify({
    entries: [{ date: '2026-09-26', content: '带图片的日记', media: ['media/a.jpg'] }],
  });
  const bytes = new Uint8Array(assembleZip([plainEntry('entries.json', payload), plainEntry('media/a.jpg', jpeg)]));
  const result = await importer.parseBackup({ bytes, filename: 'backup.zip' });
  assert.equal(result.entries.length, 1);
  assert.equal(result.media.length, 1);
  assert.equal(result.entries[0].media.length, 1);
  assert.equal(result.media[0].blob.type, 'image/jpeg');
});

test('导入 .mbk 结构（未加密）能读出文字与图片', async () => {
  const body = JSON.stringify({ content: '锁时日记的正文', date: '2026-09-26 19:30:00' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const bytes = new Uint8Array(
    assembleZip([
      plainEntry('LockTimeDiaryData/abc/DiaryContent', body),
      plainEntry('LockTimeDiaryData/abc/Pic_0', png),
    ]),
  );
  const result = await importer.parseBackup({ bytes, filename: 'Diary_x.mbk' });
  assert.equal(result.source, 'mbk');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].content, '锁时日记的正文');
  assert.equal(result.entries[0].date, '2026-09-26');
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].blob.type, 'image/png');
  assert.equal(result.entries[0].media.length, 1);
});

test('JSON / 纯文本文件也能直接导入', async () => {
  const json = new TextEncoder().encode(JSON.stringify([{ date: '2026-09-26', content: '一条' }]));
  const parsed = await importer.parseBackup({ bytes: json, filename: 'a.json' });
  assert.equal(parsed.entries.length, 1);

  const text = new TextEncoder().encode('随手写的纯文本');
  const parsedText = await importer.parseBackup({ bytes: text, filename: 'a.txt' });
  assert.equal(parsedText.entries[0].content, '随手写的纯文本');
});

test('加密 .mbk 走完整导入流程：口令正确才有内容', async () => {
  const bytes = buildDemoMbk('my-secret');
  const info = importer.detect(bytes, 'Diary_demo.mbk');
  assert.equal(info.kind, 'mbk');
  assert.equal(info.needsPassword, true);

  // 不给口令 / 口令错误
  await assert.rejects(() => importer.parseBackup({ bytes, filename: 'Diary_demo.mbk' }), (error) => error.code === 'PASSWORD');
  await assert.rejects(
    () => importer.parseBackup({ bytes, filename: 'Diary_demo.mbk', password: 'nope' }),
    (error) => error.code === 'PASSWORD',
  );

  const result = await importer.parseBackup({ bytes, filename: 'Diary_demo.mbk', password: 'my-secret' });
  assert.equal(result.source, 'mbk');
  assert.equal(result.entries.length, 2);
  assert.deepEqual(
    result.entries.map((entry) => entry.content).sort(),
    ['第一天的加密日记', '第二天的加密日记'],
  );
  assert.equal(result.entries.every((entry) => entry.source === 'mbk'), true);
  assert.equal(result.media.length, 1);
  assert.equal(result.media[0].blob.type, 'image/png');
  const first = result.entries.find((entry) => entry.content === '第一天的加密日记');
  assert.equal(first.date, '2026-08-01');
  assert.equal(first.media.length, 1);

  // 关掉图片导入时只取文字
  const textOnly = await importer.parseBackup({ bytes, filename: 'Diary_demo.mbk', password: 'my-secret', includeMedia: false });
  assert.equal(textOnly.entries.length, 2);
  assert.equal(textOnly.media.length, 0);
});

test('认不出字段名的内容也能靠兜底救回正文', () => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ abc: '2026-08-01 20:00:00', xyz: '这是一段很长的正文，用来验证兜底逻辑能把最长的字符串当成内容。' }),
  );
  const parsed = importer.parseDiaryContent(bytes);
  assert.equal(parsed.entry.content.includes('兜底逻辑'), true);
  assert.equal(parsed.entry.date, '2026-08-01');
  assert.equal(importer.parseDiaryContent(new TextEncoder().encode('')).entry, null);
  assert.equal(importer.parseDiaryContent(new TextEncoder().encode('   ')).entry, null);
});

test('定格日记的 property 元数据能还原成日期 / 标签', () => {
  const createTime = 1738850509003;
  const record = {
    property: JSON.stringify({
      title: '',
      smallContent: '摘要',
      createTime,
      showTime: createTime,
      labIds: 'u1,u2',
      picNames: 'Pic_0',
    }),
    content: '<p>第一段</p><p>第二段</p>',
  };
  const tagMap = new Map([
    ['u1', '读书笔记'],
    ['u2', '感悟'],
  ]);
  const entry = importer.mapRecord(record, 0, { tagMap });
  assert.equal(entry.content, '第一段\n第二段');
  assert.equal(entry.date, model.toDateKey(createTime));
  assert.equal(entry.time, model.toTimeKey(createTime));
  assert.deepEqual(entry.tags, ['读书笔记', '感悟']);
});

test('定格日记整包导入：标签表 + 正文 + 图片', async () => {
  const createTime = 1738850509003;
  const content = JSON.stringify({
    property: JSON.stringify({ createTime, labIds: 'u1', picNames: 'Pic_0' }),
    content: '<p>今天心情很好</p>',
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7]);
  const bytes = new Uint8Array(
    assembleZip([
      plainEntry('LockTimeDiaryData/LabTagList', JSON.stringify({ tagLabList: [{ uuid: 'u1', name: '读书笔记' }], minVersion: 2 })),
      plainEntry('LockTimeDiaryData/abc/DiaryContent', content),
      plainEntry('LockTimeDiaryData/abc/Pic_0', png),
    ]),
  );
  const result = await importer.parseBackup({ bytes, filename: 'Diary_demo.mbk' });
  assert.equal(result.source, 'mbk');
  assert.equal(result.entries.length, 1);
  assert.equal(result.meta.tags, 1);
  const [entry] = result.entries;
  assert.equal(entry.content, '今天心情很好');
  assert.equal(entry.date, model.toDateKey(createTime));
  assert.deepEqual(entry.tags, ['读书笔记']);
  assert.equal(entry.media.length, 1);
  assert.equal(result.media[0].blob.type, 'image/png');
});

test('真实 .mbk 备份的目录结构能被解析（有样本时才跑）', { skip: !existsSync('D:/下载/Diary_1790424879623.mbk') }, () => {
  const bytes = new Uint8Array(readFileSync('D:/下载/Diary_1790424879623.mbk'));
  assert.equal(zip.isZip(bytes), true);
  const list = zip.listEntries(bytes);
  assert.ok(list.length > 300, `条目数应该很多，实际 ${list.length}`);
  assert.ok(list.some((item) => /LockTimeDiaryData\/.+\/DiaryContent$/.test(item.name)));
  assert.ok(list.some((item) => /Pic_\d+$/.test(item.name)));
  assert.equal(zip.needsPassword(bytes), true);
  const info = importer.detect(bytes, 'Diary_1790424879623.mbk');
  assert.equal(info.kind, 'mbk');
  assert.equal(info.needsPassword, true);
});
