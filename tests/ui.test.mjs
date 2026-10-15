import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadSource, projectRoot } from '../tools/load-source.mjs';

const Diary = loadSource('js/ui.js');
const { copyText, openExternal } = Diary.ui;

const REWARD_URL = 'https://afdian.com/a/yyqxoc';

/** 在 globalThis 上临时搭一个浏览器环境的壳，用完还原 */
function withBrowser(stubs, run) {
  const saved = new Map();
  for (const key of Object.keys(stubs)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: stubs[key], configurable: true, writable: true });
  }
  try {
    return run();
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('openExternal：网页端开新标签', () => {
  const opened = [];
  const result = withBrowser(
    {
      Capacitor: undefined,
      location: { href: '' },
      open: (url, name) => {
        opened.push([url, name]);
        return { closed: false };
      },
    },
    () => openExternal(REWARD_URL),
  );
  assert.deepEqual(result, { ok: true, opened: true });
  assert.deepEqual(opened, [[REWARD_URL, '_blank']]);
});

test('openExternal：新标签被拦时回落到当前页跳转', () => {
  const location = { href: '' };
  const result = withBrowser(
    {
      Capacitor: undefined,
      location,
      open: () => null,
    },
    () => openExternal(REWARD_URL),
  );
  assert.deepEqual(result, { ok: true, fallback: true });
  assert.equal(location.href, REWARD_URL);
});

test('openExternal：原生 App 里交给系统浏览器打开（改 location）', () => {
  const location = { href: '' };
  const result = withBrowser(
    {
      Capacitor: { isNativePlatform: () => true },
      location,
      open: () => {
        throw new Error('原生里不该用 window.open');
      },
    },
    () => openExternal(REWARD_URL),
  );
  assert.deepEqual(result, { ok: true, native: true });
  assert.equal(location.href, REWARD_URL);
});

test('openExternal / copyText：空链接直接返回失败', () => {
  const result = withBrowser({ Capacitor: undefined, location: { href: '' } }, () => openExternal(''));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
});

test('赞赏入口：app.js 里有 https 的 REWARD_URL 常量', () => {
  const source = readFileSync(join(projectRoot, 'js', 'app.js'), 'utf8');
  const hit = source.match(/const\s+REWARD_URL\s*=\s*'([^']*)'/);
  assert.ok(hit, 'app.js 里应该能看到 REWARD_URL');
  assert.equal(hit[1], REWARD_URL);
  assert.equal(Diary.ui.ICONS.heart.length > 0, true);
});

test('copyText：没有剪贴板能力时返回失败而不是抛错', async () => {
  const result = await withBrowser({ navigator: { clipboard: undefined }, document: undefined }, () =>
    copyText('hello'),
  ).catch(() => 'threw');
  assert.equal(result, false);
});
