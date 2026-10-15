import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { encodeQr, qrToSvg, selfCheck } from '../tools/make-qr.mjs';
import { buildPage } from '../tools/release-page.mjs';

const APK_URL = 'https://yiann32.github.io/shiguang-diary/shiguang-diary.apk';

/**
 * 版本 1–6 在纠错等级 M、字节模式下能装的最大字节数：
 * 数据码字数 × 8 − 4（模式）− 8（长度），向下取整到字节。
 */
const CAPACITY = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106 };

test('二维码：每个版本都能装到容量上限，且自检通过', () => {
  for (const [version, limit] of Object.entries(CAPACITY)) {
    const text = 'a'.repeat(limit);
    const qr = encodeQr(text);
    const check = selfCheck(text, qr);
    assert.equal(check.ok, true, `${limit} 字节自检失败：${check.reason}`);
    assert.equal(qr.version, Number(version), `${limit} 字节应该是版本 ${version}`);
    assert.equal(qr.size, Number(version) * 4 + 17);
  }
});

test('二维码：再多一个字节就要升一档', () => {
  for (const [version, limit] of Object.entries(CAPACITY)) {
    if (Number(version) === 6) continue;
    assert.equal(encodeQr('a'.repeat(limit + 1)).version, Number(version) + 1);
  }
});

test('二维码：下载页用的那条固定直链能编码且自检通过', () => {
  const qr = encodeQr(APK_URL);
  const check = selfCheck(APK_URL, qr);
  assert.equal(check.ok, true, check.reason);
  assert.equal(check.dataModules, (64 + 18 * 2) * 8 + 7); // 版本 4：800 个数据模块 + 7 个余数位
  assert.ok(qr.mask >= 0 && qr.mask <= 7);
});

test('二维码：内容放不下版本 1–6 时直接报错', () => {
  assert.throws(() => encodeQr(`https://example.com/${'a'.repeat(200)}`), /内容太长/);
});

test('二维码：SVG 自带白底、静区与可访问名字', () => {
  const svg = qrToSvg(encodeQr(APK_URL), { size: 196, quiet: 3, label: '扫码下载' });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 39 39"/); // 33 + 3 × 2
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /aria-label="扫码下载"/);
  assert.match(svg, /<path d="M/);
});

test('下载页：单文件、内联二维码、带安装提示与直链', () => {
  const html = buildPage({
    version: '3.0.0',
    stamp: '2026-10-14 15:49',
    sizeText: '4.17 MB',
    qrSvg: qrToSvg(encodeQr(APK_URL), { label: '扫码下载拾光日记' }),
    apkUrl: APK_URL,
    pageUrl: 'https://yiann32.github.io/shiguang-diary/',
    repoUrl: 'https://github.com/Yiann32/shiguang-diary',
  });
  assert.match(html, /<a class="btn" href="https:\/\/yiann32\.github\.io\/shiguang-diary\/shiguang-diary\.apk">/);
  assert.match(html, /v3\.0\.0/);
  assert.match(html, /4\.17 MB/);
  assert.match(html, /<svg /);
  assert.match(html, /极速安装/);
  assert.equal(/<script|src="http|href="http:\/\/|@import/.test(html), false, '不能有外部依赖或脚本');
});
