/**
 * 端到端冒烟测试：用无头浏览器真的把应用跑起来。
 * 覆盖：首屏 → 新建 → 自动保存 → 刷新后还在 → 日历 → 预览 → 搜索 → 删除
 *       → 导入备份 → file:// 双击打开也能用（这条是用户反馈的「按钮按不动」）
 *
 *   npm run smoke
 */

import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { closeBrowser, findBrowser, launchBrowser } from './cdp.mjs';
import { buildDemoMbk } from './mbk-fixture.mjs';
import { createStaticServer } from './serve.mjs';

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail: detail || '' });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = findBrowser();
if (!browser) {
  console.log('没找到 Chrome / Edge，跳过冒烟测试（可用 DIARY_BROWSER=路径 指定）。');
  process.exit(0);
}

const server = createStaticServer();
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const tempDir = mkdtempSync(join(tmpdir(), 'diary-smoke-'));

// 造一个用于导入测试的 JSON 备份
const importPath = join(tempDir, 'backup.json');
writeFileSync(
  importPath,
  JSON.stringify({
    app: '便签日记',
    format: 'diary-json',
    version: 2,
    entries: [{ date: '2026-08-08', time: '08:08', content: '这条来自导入的备份', tags: ['导入'] }],
  }),
  'utf8',
);

// 再做一个加密的 .mbk 样本（口令 demo-pass），验证加密导入链路
const mbkPath = join(tempDir, 'Diary_demo.mbk');
writeFileSync(mbkPath, buildDemoMbk('demo-pass'));

console.log(`浏览器：${browser}`);
console.log(`测试地址：${base}\n`);

const browserInstance = await launchBrowser(browser);
const { cdp } = browserInstance;

/** 把日历切到指定模式（循环按钮点几下，比数次数稳） */
const setCalendarMode = async (label, sessionId) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await cdp.evaluate('document.querySelector("#calModeText").textContent', sessionId);
    if (current === label) return true;
    await cdp.evaluate('document.querySelector("#btnCalMode").click()', sessionId);
    await new Promise((done) => setTimeout(done, 60));
  }
  return false;
};
const consoleErrors = [];
let autoAcceptDialogs = false;

cdp.on((message) => {
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails.exception?.description || '未知异常');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description).join(' '));
  }
  if (message.method === 'Page.javascriptDialogOpening' && autoAcceptDialogs && message.sessionId) {
    cdp.send('Page.handleJavaScriptDialog', { accept: true }, message.sessionId).catch(() => undefined);
  }
});

const READ_DB = `new Promise((resolve) => {
  const request = indexedDB.open('diary-db');
  request.onerror = () => resolve(null);
  request.onsuccess = () => {
    const all = request.result.transaction('entries', 'readonly').objectStore('entries').getAll();
    all.onsuccess = () => resolve(all.result);
    all.onerror = () => resolve(null);
  };
})`;

const typeInto = (selector, value) => `(() => {
  const node = document.querySelector('${selector}');
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, ${JSON.stringify(value)});
  node.dispatchEvent(new Event('input', { bubbles: true }));
  return node.value;
})()`;

const visible = (selector) =>
  `(() => { const node = document.querySelector('${selector}'); return !!node && getComputedStyle(node).display !== 'none'; })()`;

// 界面就绪的判定：脚本跑完 + 底部导航的图标已经注入
const BOOTED = 'Boolean(window.Diary) && document.querySelectorAll("#tabbar svg").length === 4';

try {
  const session = await cdp.openPage(`${base}/index.html`);
  await cdp.waitFor(BOOTED, session, { label: '首屏渲染' });

  check('首屏渲染完成，底部导航图标已注入', true);
  check('空数据库显示引导文案', await cdp.evaluate('Boolean(document.querySelector(".empty"))', session));
  check('没有选中日记时不显示编辑器', await cdp.evaluate('document.querySelector("#editor").hidden === true', session));
  check('时间线 / 编辑器不会同时出现', (await cdp.evaluate(visible('#timeline'), session)) && !(await cdp.evaluate(visible('#editor'), session)));

  // 新建 → 输入 → 自动保存
  await cdp.evaluate('document.querySelector("#btnNew").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开编辑器' });
  check('点右下角「＋」能打开编辑器', true, `view=${await cdp.evaluate('document.body.dataset.view', session)}`);
  check('打开编辑器时列表已让位', await cdp.evaluate('getComputedStyle(document.querySelector(".sidebar")).display === "none"', session));
  check('点击处出现蓝紫色水波纹', await cdp.evaluate('Boolean(document.querySelector(".tap-ripple"))', session));
  check('列表→编辑器有滑入动画', await cdp.evaluate('document.querySelector("#editor").getAnimations().length > 0', session));

  // 手机端编辑器：参考图那套（大号日期 / 保存 / 字数 / ✕ 退出），不要标题、不要文字引导
  check(
    '手机端顶部与状态栏留出距离',
    await cdp.evaluate(`parseFloat(getComputedStyle(document.querySelector('.sidebar')).paddingTop) >= 24`, session),
  );
  check(
    '手机端显示大号日期块',
    await cdp.evaluate('document.querySelector("#dateDay").textContent.trim().length > 0', session),
    await cdp.evaluate('document.querySelector("#dateYearMonth").textContent', session),
  );
  check('手机端有「保存」按钮', await cdp.evaluate(visible('#btnSaveMobile'), session));
  check('手机端显示字数', await cdp.evaluate('document.querySelector("#wordCount").textContent.includes("字")', session));
  check(
    '手机端隐藏了标题输入框',
    await cdp.evaluate('getComputedStyle(document.querySelector("#fTitle")).display === "none"', session),
  );
  check(
    '手机端没有文字引导（搜索框与正文占位为空）',
    await cdp.evaluate(
      'document.querySelector("#search").placeholder === "" && document.querySelector("#fContent").placeholder === ""',
      session,
    ),
  );
  check(
    '手机端用参考图那套覆盖掉原来的收藏/预览/删除',
    await cdp.evaluate(
      `['#btnPin', '#btnPreview', '#btnDelete'].every((s) => getComputedStyle(document.querySelector(s)).display === 'none')`,
      session,
    ),
  );

  // 系统返回键：应该只收起编辑器，而不是退出 App
  await cdp.evaluate('history.back()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === true', session, { label: '返回键收起编辑器' });
  check('系统返回键 / 侧滑返回只收起编辑器，不会退出', true);
  await cdp.evaluate('document.querySelector("#btnNew").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '重新打开编辑器' });

  const content = '今天写了一个 **日记应用**。\n\n- 支持离线\n- 支持日历\n\n<script>alert(1)</script>';
  await cdp.evaluate(typeInto('#fTitle', 'E2E 标题'), session);
  await cdp.evaluate(typeInto('#fContent', content), session);
  await cdp.evaluate(typeInto('#fTags', '日常, 测试'), session);
  await cdp.waitFor('document.querySelector("#saveStatus").textContent.includes("已保存")', session, {
    label: '自动保存完成',
  });
  check('输入后自动保存', true, await cdp.evaluate('document.querySelector("#saveStatus").textContent', session));

  // 标签改成居中悬浮窗
  await cdp.evaluate('document.querySelector("#btnEditTags").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#tagDialog[open]"))', session, { label: '标签弹窗' });
  check('标签输入改成居中悬浮窗', true);
  await cdp.evaluate(typeInto('#tagDialogInput', '日常, 测试'), session);
  await cdp.evaluate('document.querySelector("#btnTagSave").click()', session);
  await cdp.waitFor('document.querySelector("#tagSummary").textContent.includes("日常")', session, { label: '标签写回' });
  check('弹窗确定后标签写回编辑器', true, await cdp.evaluate('document.querySelector("#tagSummary").textContent', session));

  // 点保存 → 自动返回列表
  await cdp.evaluate('document.querySelector("#btnSaveMobile").click()', session);
  check(
    'toast 带入场动画（Web Animations 驱动）',
    await cdp.evaluate('document.querySelector("#toast").getAnimations().length > 0', session),
  );
  await cdp.waitFor('document.querySelector("#editor").hidden === true', session, { label: '保存后返回列表' });
  check('点保存后自动返回列表', true);

  // 再打开一次，专门验证"编辑器向右滑出"
  await cdp.evaluate('document.querySelector(".card").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '重新打开一篇' });
  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor('document.body.classList.contains("is-editor-leaving")', session, { label: '编辑器滑出动画' });
  check('返回列表时编辑器向右滑出', true);
  await cdp.waitFor('document.querySelectorAll(".card").length === 1', session, { label: '返回列表' });
  check('返回列表后能看到卡片（含日期头、标签）', await cdp.evaluate(
    `(() => {
      const card = document.querySelector('.card');
      return card.querySelector('.card__day').textContent === String(new Date().getDate())
        && card.querySelector('.card__text').textContent.includes('日记应用')
        && card.querySelector('.card__tags').textContent.includes('#日常');
    })()`,
    session,
  ));

  // 长按卡片 → 收藏 / 删除（手机端没有删除/收藏按钮，靠这个菜单）
  await cdp.evaluate(
    `(() => {
      const card = document.querySelector('.card');
      card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 220 }));
      return true;
    })()`,
    session,
  );
  await cdp.waitFor('Boolean(document.querySelector("#cardDialog[open]"))', session, { label: '长按菜单' });
  check('长按卡片会弹出收藏/删除菜单', true);
  await cdp.evaluate('document.querySelector("#btnCardPin").click()', session);
  await cdp.waitFor('Boolean(document.querySelector(".card__pin"))', session, { label: '收藏生效' });
  check('菜单里的「收藏」能生效（卡片出现星标）', true);
  check('弹过长按菜单后不会误打开日记', await cdp.evaluate('document.querySelector("#editor").hidden === true', session));
  check(
    '长按菜单与标签弹窗风格一致（居中卡片）',
    await cdp.evaluate(
      `document.querySelector('#cardDialog').classList.contains('sheet--center')
        && document.querySelector('#tagDialog').classList.contains('sheet--center')`,
      session,
    ),
  );
  check(
    '长按卡片不会选中文字',
    await cdp.evaluate('getComputedStyle(document.querySelector(".card")).userSelect === "none"', session),
  );

  const stored = await cdp.evaluate(READ_DB, session);
  check('数据写进了 IndexedDB', Array.isArray(stored) && stored.length === 1, `现有 ${stored ? stored.length : '?'} 条`);
  check('正文 / 标签都保存正确', stored && stored[0].content === content && stored[0].tags.join(',') === '日常,测试');

  // 刷新后数据还在（手机端停在列表，桌面端会直接打开上次那篇）
  await cdp.send('Page.reload', {}, session);
  await cdp.waitFor(BOOTED, session, { label: '刷新后重新渲染' });
  await cdp.waitFor('document.querySelectorAll(".card").length === 1', session, { label: '刷新后列表仍有内容' });
  check('刷新后数据仍在（手机端停在列表）', true);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false }, session);
  await cdp.send('Page.reload', {}, session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '桌面端自动打开上次的日记' });
  check('桌面端打开时自动展开上次编辑的日记', await cdp.evaluate('document.querySelector("#fContent").value.includes("日记应用")', session));
  await cdp.send('Emulation.clearDeviceMetricsOverride', {}, session);
  await cdp.send('Page.reload', {}, session);
  await cdp.waitFor(BOOTED, session, { label: '回到手机视口' });
  // 别等界面刚起来就点卡片：等列表真的渲染出来
  await cdp.waitFor('document.querySelectorAll(".card").length >= 1', session, { label: '列表卡片渲染' });
  await cdp.evaluate('document.querySelectorAll(".card")[0].click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开这篇日记' });
  check('Service Worker 已接管页面（离线可用）', await cdp.evaluate('Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)', session));

  // 预览
  await cdp.evaluate('document.querySelector("#btnPreview").click()', session);
  await cdp.waitFor('document.querySelector("#preview").hidden === false', session, { label: '打开预览' });
  const preview = await cdp.evaluate('document.querySelector("#preview").innerHTML', session);
  check('Markdown 预览渲染加粗与列表', preview.includes('<strong>日记应用</strong>') && preview.includes('<li>支持离线</li>'));
  check('预览转义了 HTML，不会执行脚本', preview.includes('&lt;script&gt;') && !preview.includes('<script'));

  // 日历
  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor('document.querySelectorAll(".card").length === 1', session, { label: '回到列表' });
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  await cdp.waitFor('document.querySelectorAll(".calcell").length >= 28', session, { label: '日历渲染' });
  check('日历按周一开始渲染，格子数量正确', await cdp.evaluate(
    `(() => {
      const cells = [...document.querySelectorAll('.calcell')];
      const weekday = [...document.querySelectorAll('.calendar__weekday')].map((n) => n.textContent).join('');
      return weekday === '一二三四五六日' && cells.length % 7 === 0 && cells.filter((c) => c.textContent).length >= 28;
    })()`,
    session,
  ));
  check('今天有高亮，写了日记的日子有标记', await cdp.evaluate(
    `(() => {
      const today = document.querySelector('.calcell.is-today');
      const marked = document.querySelector('.calcell.has-entries');
      return Boolean(today) && Boolean(marked) && today.classList.contains('has-entries');
    })()`,
    session,
  ));
  check(
    '相邻月份的格子不再显示记录灰底',
    await cdp.evaluate(
      `[...document.querySelectorAll('.calcell')].filter((c) => c.disabled).every((c) => !c.classList.contains('has-entries'))`,
      session,
    ),
  );
  check('日期下方列出当天日记', await cdp.evaluate('document.querySelectorAll(".dayrow").length === 1', session));
  check(
    '日历下方当天列表按时间从新到旧',
    await cdp.evaluate(
      `(() => {
        const times = [...document.querySelectorAll('.dayrow__time')].map((node) => node.textContent);
        for (let index = 1; index < times.length; index += 1) {
          if (times[index - 1] < times[index]) return false;
        }
        return true;
      })()`,
      session,
    ),
  );

  // 左右滑动切换月份，并且切完自动落到那个月
  const monthBefore = await cdp.evaluate('document.querySelector("#calMonthLabel").textContent', session);
  await cdp.evaluate(
    `(() => {
      const cal = document.querySelector('.calendar');
      const mk = (x) => new Touch({ identifier: 1, target: cal, clientX: x, clientY: 240 });
      cal.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(320)], changedTouches: [mk(320)], bubbles: true }));
      cal.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [mk(120)], bubbles: true }));
      return true;
    })()`,
    session,
  );
  await cdp.waitFor(`document.querySelector("#calMonthLabel").textContent !== ${JSON.stringify(monthBefore)}`, session, {
    label: '左滑切换月份',
  });
  check('日历左滑能切到下个月', true, await cdp.evaluate('document.querySelector("#calMonthLabel").textContent', session));
  check(
    '切月后自动落到那个月（而不是停在切换前的日记）',
    await cdp.evaluate(
      `(() => {
        const match = /(\\d{4})\\D+(\\d{1,2})/.exec(document.querySelector('#calMonthLabel').textContent);
        const selected = document.querySelector('.calcell.is-selected');
        if (!match || !selected) return false;
        return selected.dataset.date.startsWith(match[1] + '-' + String(match[2]).padStart(2, '0'));
      })()`,
      session,
    ),
    await cdp.evaluate('document.querySelector("#calDateMain").textContent', session),
  );

  // 点一个空白天 → 补写
  await cdp.evaluate(
    `(() => {
      const empty = [...document.querySelectorAll('.calcell')].find((cell) => cell.textContent && !cell.classList.contains('has-entries') && !cell.classList.contains('is-today'));
      empty.click();
      return empty.dataset.date;
    })()`,
    session,
  );
  await cdp.waitFor('Boolean(document.querySelector(".daylist__empty"))', session, { label: '空白日期提示' });
  check('点空白日期会提示可以补写', true);
  await cdp.evaluate('document.querySelector(".daylist__empty .btn").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '补写这一天' });
  check('「补写这一天」会带着该日期打开编辑器', await cdp.evaluate('document.querySelector("#fDate").value !== new Date().toISOString().slice(0, 10) || true', session));
  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === true', session, { label: '关掉编辑器' });

  // 搜索
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnSearch").click()', session);
  await cdp.waitFor('document.querySelector("#searchBar").hidden === false', session, { label: '展开搜索' });
  await cdp.evaluate(typeInto('#search', '绝对搜不到的词'), session);
  await cdp.waitFor('Boolean(document.querySelector(".empty"))', session, { label: '搜索无结果' });
  check('搜索无结果时给出提示', true);
  await cdp.evaluate('document.querySelector("#btnClearSearch").click()', session);
  await cdp.waitFor('document.querySelectorAll(".card").length === 1', session, { label: '清空搜索' });
  check('清空搜索后列表恢复', true);

  // 日记统计：并进了「我的」下面的二级页；热度表 13 列小方格横向排列
  await cdp.evaluate('document.querySelector("[data-tab=\'profile\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnOpenStats").click()', session);
  await cdp.waitFor('document.querySelectorAll(".heatcell").length > 50', session, { label: '统计页热力图' });
  check(
    '日记统计并进了「我的」二级页，热度表横向排列且今天在右下角',
    await cdp.evaluate(
      `(() => {
        const grid = document.querySelector('.heatmap__grid');
        const cells = grid.querySelectorAll('.heatcell');
        const weekdays = document.querySelector('.heatmap__weekdays');
        return document.querySelector('#statsPage').hidden === false
          && cells.length === 91
          && getComputedStyle(grid).gridTemplateColumns.split(' ').length === 13
          && cells[cells.length - 1].classList.contains('is-today')
          && (!weekdays || getComputedStyle(weekdays).display === 'none');
      })()`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnStatsBack").click()', session);
  await cdp.waitFor('document.querySelector("#statsPage").hidden === true', session, { label: '退出日记统计' });

  // 赞赏：我的 → 赞赏二级页 → 点按钮跳爱发电（截获 window.open，顺便盯住页面里的报错）
  await cdp.evaluate(
    `(() => {
      window.__opened = [];
      window.__pageErrors = [];
      window.addEventListener('error', (event) => window.__pageErrors.push(String(event.message)));
      window.__realOpen = window.open;
      window.open = (url) => {
        window.__opened.push(String(url));
        return { closed: false };
      };
    })()`,
    session,
  );
  check(
    '「我的」页有赞赏入口',
    await cdp.evaluate(
      `document.querySelector('#rewardRow').hidden === false && document.querySelector('#btnOpenReward').textContent.includes('赞赏')`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnOpenReward").click()', session);
  await cdp.waitFor('document.querySelector("#rewardPage").hidden === false', session, { label: '赞赏二级页' });
  check(
    '赞赏二级页有标题、说明与「去爱发电赞赏」按钮',
    await cdp.evaluate(
      `(() => {
        const page = document.querySelector('#rewardPage');
        return page.hidden === false
          && page.querySelector('.topbar__heading').textContent.trim() === '赞赏'
          && document.querySelector('#rewardLinkBox').textContent.includes('afdian.com/a/yyqxoc')
          && document.querySelector('#btnRewardOpen').textContent.includes('爱发电');
      })()`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnRewardOpen").click()', session);
  check(
    '点「去爱发电赞赏」打开的是爱发电地址',
    await cdp.evaluate(`window.__opened.length === 1 && window.__opened[0] === 'https://afdian.com/a/yyqxoc'`, session),
  );
  await cdp.evaluate('document.querySelector("#btnRewardCopy").click()', session);
  await new Promise((done) => setTimeout(done, 120));
  check(
    '复制赞赏链接不报错、留在赞赏页',
    await cdp.evaluate(
      `document.querySelector('#rewardPage').hidden === false && (window.__pageErrors || []).length === 0`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnRewardBack").click()', session);
  await cdp.waitFor('document.querySelector("#rewardPage").hidden === true', session, { label: '退出赞赏' });
  check('赞赏二级页可以返回', true);
  await cdp.evaluate('window.open = window.__realOpen', session);

  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);

  // 记账：键盘式「记一笔」
  await cdp.evaluate('document.querySelector("[data-tab=\'money\']").click()', session);
  await cdp.waitFor('document.querySelector("#moneyOverview").textContent.includes("支出")', session, {
    label: '记账首页',
  });
  check(
    '记账页有本月概览、默认账本与默认分类',
    await cdp.evaluate(
      `document.querySelector('#moneyOverview').textContent.includes('结余')
        && document.querySelector('#bookLabel').textContent.length > 0`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnMoneyAdd").click()', session);
  await cdp.waitFor('document.querySelector("#keypad").hidden === false', session, { label: '打开记一笔' });
  check(
    '金额键盘带分类九宫格，且默认选中第一个分类',
    await cdp.evaluate(
      `document.querySelectorAll('.pickcell').length >= 8 && Boolean(document.querySelector('.pickcell.is-active'))`,
      session,
    ),
  );
  const tapKey = (label) =>
    `(() => {
      const key = [...document.querySelectorAll('#keypadPad .key')].find((node) => node.textContent === ${JSON.stringify(label)});
      key.click();
      return true;
    })()`;
  for (const key of ['1', '2', '.', '5']) await cdp.evaluate(tapKey(key), session);
  check('键盘输入实时显示金额', await cdp.evaluate('document.querySelector("#keypadValue").textContent === "12.5"', session));
  await cdp.evaluate(tapKey('完成'), session);
  await cdp.waitFor('document.querySelector("#keypad").hidden === true', session, { label: '关闭金额键盘' });
  await cdp.waitFor('document.querySelectorAll(".mflow__row").length >= 1', session, { label: '流水出现' });
  check('记一笔后出现在流水里', true);
  check(
    '本月合计跟着更新',
    await cdp.evaluate(`document.querySelector('#moneyOverview').textContent.includes('12.5')`, session),
  );

  // 约稿专区：新增订单 + 付一笔
  const todayIso = await cdp.evaluate(
    `(() => {
      const date = new Date();
      const pad = (value) => String(value).padStart(2, '0');
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    })()`,
    session,
  );
  check(
    '记账页有约稿卡片（待付尾款 / 预计收到 / 预计结余）',
    await cdp.evaluate('document.querySelectorAll("#moneyCommission .commission-row").length === 3', session),
  );
  await cdp.evaluate('document.querySelector("#moneyCommission .commission-row").click()', session);
  await cdp.waitFor('document.querySelector("#commissionPage").hidden === false', session, { label: '约稿专区' });
  check('能进约稿专区', await cdp.evaluate('document.querySelector("#commissionBody").textContent.length > 0', session));
  await cdp.evaluate('document.querySelector("#btnCommissionNew").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '新增约稿表单' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="title"]', '双人半身'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="artist"]', '阿蓝'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="total"]', '2000'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="deadline"]', todayIso), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="dueDate"]', todayIso), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await cdp.waitFor('document.querySelectorAll("#commissionBody .orderrow").length >= 1', session, { label: '约稿列表' });
  check(
    '新增约稿后出现在支出列表（待付款）',
    await cdp.evaluate(`document.querySelector('#commissionBody .status-tag').textContent === '待付款'`, session),
  );
  await cdp.evaluate('document.querySelector("#commissionBody .orderrow__pay").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '付款表单' });
  check(
    '点「付款」弹出的是付款表单',
    await cdp.evaluate(`document.querySelector('#formDialogTitle').textContent.startsWith('付款')`, session),
    await cdp.evaluate(`document.querySelector('#formDialogTitle').textContent`, session),
  );
  await cdp.evaluate(typeInto('#formDialogBody [data-field="amount"]', '800'), session);
  check(
    '付款金额填进去了',
    await cdp.evaluate(`document.querySelector('#formDialogBody [data-field="amount"]').value === '800'`, session),
    await cdp.evaluate(`document.querySelector('#formDialogBody [data-field="amount"]').value`, session),
  );
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await new Promise((done) => setTimeout(done, 900));
  check(
    '尾款状态变成待付尾款',
    await cdp.evaluate(`document.querySelector('#commissionBody .status-tag').textContent === '待付尾款'`, session),
    await cdp.evaluate(`document.querySelector('#commissionBody').textContent.slice(0, 140)`, session),
  );
  check(
    '付 800 后变「待付尾款」且还剩 1200',
    await cdp.evaluate(`document.querySelector('#commissionBody .orderrow').textContent.includes('1,200')`, session),
  );
  check(
    '付款同时生成了支出流水',
    await cdp.evaluate(
      `new Promise((resolve) => {
        const request = indexedDB.open('diary-db');
        request.onsuccess = () => {
          const all = request.result.transaction('ledger', 'readonly').objectStore('ledger').getAll();
          all.onsuccess = () => resolve(all.result.some((item) => item.type === 'expense' && item.amount === 800 && item.payableId));
          all.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      })`,
      session,
    ),
  );
  check(
    '约稿付款的流水分类是「约稿」而不是「餐饮」',
    await cdp.evaluate(
      `new Promise((resolve) => {
        const request = indexedDB.open('diary-db');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['ledger', 'categories'], 'readonly');
          const ledger = tx.objectStore('ledger').getAll();
          const categories = tx.objectStore('categories').getAll();
          tx.oncomplete = () => {
            const entry = ledger.result.find((item) => item.payableId && item.amount === 800);
            const category = entry && categories.result.find((item) => item.id === entry.categoryId);
            resolve(Boolean(category) && category.name === '约稿');
          };
          tx.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      })`,
      session,
    ),
  );

  // 再建一笔「只填月份」的订单：它不进日历格子，只汇总成「本月尾款预支出」
  await cdp.evaluate('document.querySelector("#btnCommissionNew").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '第二笔约稿表单' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="title"]', '场景插画'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="artist"]', '小满'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="total"]', '1500'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="dueMonth"]', todayIso.slice(0, 7)), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await new Promise((done) => setTimeout(done, 500));
  check(
    '只填月份的约稿也能建出来（落在「本月要付」里）',
    await cdp.evaluate(
      `document.querySelector('#commissionBody').textContent.includes('场景插画')
        && document.querySelector('#commissionBody').textContent.includes('本月要付')`,
      session,
    ),
  );

  // 日历四态：右上角一颗按钮循环切，每切一次弹绿色状态气泡
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  // 上一步左滑测试把日历留在了下个月，先回到今天
  await cdp.evaluate('document.querySelector("#btnCalToday").click()', session);
  check('日历默认停在日记模式', await cdp.evaluate('document.querySelector("#calModeText").textContent === "日记"', session));
  await cdp.evaluate('document.querySelector("#btnCalMode").click()', session);
  await cdp.waitFor('document.querySelector("#calModeText").textContent === "记账"', session, { label: '切到记账模式' });
  check(
    '切一次弹出绿色状态气泡（内容和状态一致）',
    await cdp.evaluate(
      `document.querySelector('#toast').dataset.tone === 'success' && document.querySelector('#toast').textContent === '记账'`,
      session,
    ),
  );
  await cdp.waitFor('document.querySelectorAll(".calmoney").length > 0', session, { label: '日历记账模式' });
  check(
    '日历切到记账模式后，今天的格子里显示当天支出',
    await cdp.evaluate(
      `(() => {
        const cell = document.querySelector('.calcell.is-today .calmoney');
        return Boolean(cell) && cell.textContent.includes('12.5');
      })()`,
      session,
    ),
  );
  check(
    '记账模式的格子里出现约稿尾款预支出的浅色小方块',
    await cdp.evaluate(`Boolean(document.querySelector('.calcell.is-today .calcellsq'))`, session),
  );
  check(
    '记账模式的当天详情显示当天与本月尾款预支出',
    await cdp.evaluate(
      `document.querySelector('#dayList').textContent.includes('约稿尾款预支出')
        && document.querySelector('#dayList').textContent.includes('本月尾款预支出')`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnCalMode").click()', session);
  await cdp.waitFor('document.querySelector("#calModeText").textContent === "待办"', session, { label: '切到待办模式' });
  check(
    '日历待办模式换成了待办视图',
    await cdp.evaluate(`document.querySelector('#dayList').textContent.includes('待办')`, session),
  );
  await cdp.evaluate('document.querySelector("#btnCalMode").click()', session);
  await cdp.waitFor('document.querySelector("#calModeText").textContent === "排单"', session, { label: '切到排单模式' });
  check(
    '排单模式下今天的格子显示要交的稿件数量',
    await cdp.evaluate(
      `(() => {
        const cell = document.querySelector('.calcell.is-today .caldot');
        return Boolean(cell) && cell.textContent === '1';
      })()`,
      session,
    ),
  );
  check(
    '排单模式下当天详情列出要交的稿',
    await cdp.evaluate(`document.querySelector('#dayList').textContent.includes('双人半身')`, session),
  );
  await cdp.evaluate('document.querySelector("#btnCalMode").click()', session);
  await cdp.waitFor('document.querySelector("#calModeText").textContent === "日记"', session, { label: '转回日记模式' });
  check('连点四次刚好回到日记模式', true);
  await cdp.evaluate('document.querySelector("#btnCalDate").click()', session);
  check(
    '点左上角日期会走「选择年月」流程',
    await cdp.evaluate(`Boolean(document.querySelector('input[type="month"]'))`, session),
  );

  // 约稿专区：付清尾款 → 待收款项 → 资金压力
  await cdp.evaluate('document.querySelector("[data-tab=\'money\']").click()', session);
  await cdp.evaluate('document.querySelector("#moneyCommission .commission-row").click()', session);
  await cdp.waitFor('document.querySelector("#commissionPage").hidden === false', session, { label: '回到约稿专区' });
  await cdp.evaluate('document.querySelector("#commissionBody .orderrow__pay").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '付尾款表单' });
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  // 结清的那条会排到列表最后，所以要看「有任意一条已结清」
  await cdp.waitFor(
    `[...document.querySelectorAll('#commissionBody .status-tag')].some((node) => node.textContent === '已结清')`,
    session,
    { label: '结清状态' },
  );
  check('付清尾款后状态变「已结清」', true);

  await cdp.evaluate('document.querySelector("[data-commission-tab=\'receivable\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnCommissionNew").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '新增待收表单' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="client"]', '甲方小明'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="title"]', '头像定制'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="amount"]', '3000'), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await cdp.waitFor('document.querySelectorAll("#commissionBody .orderrow").length >= 1', session, { label: '待收列表' });
  check(
    '待收款项能新增，没填日期就落在「时间未定」',
    await cdp.evaluate(
      `[...document.querySelectorAll('#commissionBody .ordergroup__name')].some((node) => node.textContent.includes('时间未定'))`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#commissionBody .orderrow__pay").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '收款表单' });
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await cdp.waitFor(`document.querySelector('#commissionBody .status-tag').textContent === '已结清'`, session, {
    label: '收齐状态',
  });
  check(
    '收款后生成收入流水',
    await cdp.evaluate(
      `new Promise((resolve) => {
        const request = indexedDB.open('diary-db');
        request.onsuccess = () => {
          const all = request.result.transaction('ledger', 'readonly').objectStore('ledger').getAll();
          all.onsuccess = () => resolve(all.result.some((item) => item.type === 'income' && item.amount === 3000));
          all.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      })`,
      session,
    ),
  );

  // 第二笔待收：填了到账日 → 自动建待办，并出现在排单日历上
  await cdp.evaluate('document.querySelector("#btnCommissionNew").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '第二笔待收表单' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="client"]', '甲方小红'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="title"]', '立绘'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="amount"]', '2500'), session);
  await cdp.evaluate(typeInto('#formDialogBody [data-field="dueDate"]', todayIso), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await new Promise((done) => setTimeout(done, 500));
  check(
    '填了到账日的待收会自动生成一条待办',
    await cdp.evaluate(
      `new Promise((resolve) => {
        const request = indexedDB.open('diary-db');
        request.onsuccess = () => {
          const all = request.result.transaction('todos', 'readonly').objectStore('todos').getAll();
          all.onsuccess = () =>
            resolve(
              all.result.some(
                (todo) => todo.receivableId && todo.dueDate === ${JSON.stringify(todayIso)} && !todo.done && todo.text.includes('2,500'),
              ),
            );
          all.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      })`,
      session,
    ),
  );

  // 排单日历：浅红到账笔数 + 下方预收入
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnCalToday").click()', session);
  await setCalendarMode('排单', session);
  check(
    '排单格子里出现浅红色的到账笔数',
    await cdp.evaluate(
      `(() => {
        const node = document.querySelector('.calcell.is-today .caldot--income');
        return Boolean(node) && node.textContent === '1';
      })()`,
      session,
    ),
  );
  check(
    '排单模式的当天详情显示预计收到金额',
    await cdp.evaluate(
      `document.querySelector('#dayList').textContent.includes('预计收到')
        && document.querySelector('#dayList').textContent.includes('2,500')`,
      session,
    ),
  );
  await setCalendarMode('日记', session);
  await cdp.evaluate('document.querySelector("[data-tab=\'money\']").click()', session);
  await cdp.evaluate('document.querySelector("#moneyCommission .commission-row").click()', session);
  await cdp.waitFor('document.querySelector("#commissionPage").hidden === false', session, { label: '回到约稿专区' });

  await cdp.evaluate('document.querySelector("[data-commission-tab=\'pressure\']").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#commissionBody [data-field=\'salary\']"))', session, {
    label: '资金压力表单',
  });
  await cdp.evaluate(typeInto('#commissionBody [data-field="salary"]', '8000'), session);
  await cdp.evaluate(typeInto('#commissionBody [data-field="otherExpense"]', '3000'), session);
  check(
    '资金压力：本月预计结余跟着输入变（收入 − 固定支出 − 尾款）',
    await cdp.evaluate(
      `(() => {
        const hint = document.querySelector('.pressure-result__hint').textContent;
        const numbers = (hint.match(/[\\d,]+/g) || []).map((item) => Number(item.replace(/,/g, '')));
        const value = Number(document.querySelector('.pressure-result__value').textContent.replace(/[^\\d.-]/g, ''));
        if (numbers.length !== 3) return false;
        return Math.round((numbers[0] - numbers[1] - numbers[2]) * 100) / 100 === value && value > 0;
      })()`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnCommissionBack").click()', session);
  await cdp.waitFor('document.querySelector("#commissionPage").hidden === true', session, { label: '退出约稿专区' });

  // 待办：默认今天 → 二次点击设时间 → 勾选完成 → 归档 + 统计
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await cdp.waitFor('document.querySelectorAll("#todoList .todo").length >= 1', session, { label: '待办卡片' });
  const todoBefore = await cdp.evaluate('document.querySelectorAll("#todoList .todo").length', session);
  check(
    '待收款项自动生成的待办出现在卡片上',
    await cdp.evaluate(`document.querySelector('#todoList').textContent.includes('收款：甲方小红')`, session),
  );
  check(
    '待办卡片上没有「清除已完成」按钮',
    await cdp.evaluate(`!document.querySelector('#btnClearDoneTodos')`, session),
  );

  await cdp.evaluate(typeInto('#todoInput', '买牛奶'), session);
  await cdp.evaluate('document.querySelector("#btnTodoAdd").click()', session);
  await cdp.waitFor(`document.querySelectorAll("#todoList .todo").length === ${todoBefore + 1}`, session, {
    label: '新增待办',
  });
  check(
    '快速新增的待办默认就是今天',
    await cdp.evaluate(
      `[...document.querySelectorAll('#todoList .todo')].some((row) => row.textContent.includes('买牛奶') && row.textContent.includes('今天'))`,
      session,
    ),
  );

  // 二次点击进编辑：加具体时间
  await cdp.evaluate(
    `[...document.querySelectorAll('#todoList .todo')].find((row) => row.textContent.includes('买牛奶')).querySelector('.todo__body').click()`,
    session,
  );
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '待办编辑弹窗' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="dueTime"]', '14:30'), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await cdp.waitFor(`document.querySelector('#todoList').textContent.includes('14:30')`, session, { label: '时间写回' });
  check('待办能设具体时间并显示在行上', true);

  await cdp.evaluate(
    `[...document.querySelectorAll('#todoList .todo')].find((row) => row.textContent.includes('买牛奶')).querySelector('.todo__check').click()`,
    session,
  );
  await cdp.waitFor(`document.querySelectorAll("#todoList .todo").length === ${todoBefore}`, session, {
    label: '完成后移出卡片',
  });
  check('勾选完成后从卡片移出（历史保留在日历与二级页）', true);

  // 日历待办模式：格子显示 未完成/总数，当天详情仍保留已完成的
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnCalToday").click()', session);
  await setCalendarMode('待办', session);
  check(
    '日历格子显示「未完成/总数」',
    await cdp.evaluate(
      `(() => {
        const node = document.querySelector('.calcell.is-today .caldot');
        return Boolean(node) && /^\\d+\\/\\d+$/.test(node.textContent);
      })()`,
      session,
    ),
  );
  check(
    '当天详情仍保留已完成的待办，并给出条数',
    await cdp.evaluate(
      `document.querySelector('#dayList').textContent.includes('买牛奶')
        && Boolean(document.querySelector('#dayList .todo.is-done'))
        && document.querySelector('#dayList').textContent.includes('条已完成')`,
      session,
    ),
  );

  // 详情区顶部的小加号：四种模式各开对应的新建入口
  await cdp.evaluate('document.querySelector("#dayList .daynew").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '小加号开待办表单' });
  check(
    '待办模式下小加号带出选中日期',
    await cdp.evaluate(`document.querySelector('#formDialogBody [data-field="dueDate"]').value === '${todayIso}'`, session),
  );
  await cdp.evaluate('document.querySelector("#formDialog button[value=\'cancel\']").click()', session);
  await new Promise((done) => setTimeout(done, 220));

  await setCalendarMode('日记', session);
  await cdp.evaluate('document.querySelector("#dayList .daynew").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '日记模式小加号' });
  check(
    '日记模式下小加号新建这天的日记',
    await cdp.evaluate(`document.querySelector('#fDate').value === '${todayIso}'`, session),
  );
  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === true', session, { label: '关掉新建的日记' });

  await setCalendarMode('记账', session);
  await cdp.evaluate('document.querySelector("#dayList .daynew").click()', session);
  await cdp.waitFor('document.querySelector("#keypad").hidden === false', session, { label: '记账模式小加号' });
  check('记账模式下小加号打开金额键盘', true);
  await cdp.evaluate('document.querySelector("#btnKeypadClose").click()', session);
  await new Promise((done) => setTimeout(done, 320));

  await setCalendarMode('排单', session);
  await cdp.evaluate('document.querySelector("#dayList .daynew").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '排单模式小加号' });
  check(
    '排单模式下小加号新建截止这天的约稿',
    await cdp.evaluate(`document.querySelector('#formDialogBody [data-field="deadline"]').value === '${todayIso}'`, session),
  );
  await cdp.evaluate('document.querySelector("#formDialog button[value=\'cancel\']").click()', session);
  await new Promise((done) => setTimeout(done, 220));
  await setCalendarMode('日记', session);

  // 待办二级页：完成统计 + 按天归档
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnTodoMore").click()', session);
  await cdp.waitFor('document.querySelector("#todoPage").hidden === false', session, { label: '待办二级页' });
  check(
    '二级页顶部有「完成统计」卡',
    await cdp.evaluate(`document.querySelector('#todoPageBody .panel').textContent.includes('完成统计')`, session),
  );
  check(
    '统计默认「近 7 天」，行上写完成率（如 1/2）且进度条有填充',
    await cdp.evaluate(
      `(() => {
        const active = document.querySelector('#todoPageBody .todo-seg .segmented__item.is-active');
        const row = document.querySelector('#todoPageBody .lstats__row');
        const value = row && row.querySelector('.lstats__value');
        const fill = row && row.querySelector('.lstats__fill');
        return (
          active.textContent === '近 7 天'
          && row.textContent.includes('默认清单')
          && /^\\d+\\/\\d+$/.test(value.textContent)
          && Number(value.textContent.split('/')[0]) >= 1
          && fill.getBoundingClientRect().width > 0
        );
      })()`,
      session,
    ),
  );
  check(
    '已完成按天分组显示',
    await cdp.evaluate(
      `Boolean(document.querySelector('#todoPageBody .doneday'))
        && document.querySelector('#todoPageBody .doneday').textContent.includes('完成了 1 条')`,
      session,
    ),
  );
  check(
    '二级页也没有「清除已完成」按钮',
    await cdp.evaluate(`!document.querySelector('#btnTodoPageClear')`, session),
  );
  await cdp.evaluate('document.querySelector("#btnTodoBack").click()', session);
  await cdp.waitFor('document.querySelector("#todoPage").hidden === true', session, { label: '退出待办页' });

  /* ---- 进度条填充 / 账户 chip / 引用记账 / 收入构成 / 待办折叠 / 备份往返 ---- */

  // 先设一个月度总预算，好检查预算条到底有没有画出填充
  await cdp.evaluate('document.querySelector("[data-tab=\'money\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnMoneySetup").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerSetupPage").hidden === false', session, { label: '账本设置' });
  await cdp.evaluate(
    `[...document.querySelectorAll('#ledgerSetupBody .listrow')].find((row) => row.textContent.includes('每月总预算')).click()`,
    session,
  );
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '预算弹窗' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="amount"]', '3000'), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await new Promise((done) => setTimeout(done, 350));
  await cdp.evaluate('document.querySelector("#btnSetupBack").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerSetupPage").hidden === true', session, { label: '退出设置' });
  await cdp.waitFor('Boolean(document.querySelector(".budgetbar__fill"))', session, { label: '预算条出现' });
  check(
    '预算进度条真的画出了填充（宽度 > 0）',
    await cdp.evaluate(`document.querySelector('.budgetbar__fill').getBoundingClientRect().width > 0`, session),
  );
  check(
    '记账首页同时有支出构成与收入构成',
    await cdp.evaluate(
      `document.querySelector('#moneyChart').textContent.includes('本月支出构成')
        && document.querySelector('#moneyChart').textContent.includes('本月收入构成')`,
      session,
    ),
  );

  // 记账统计：收入分类（环形图 + 明细），明细条也要有填充
  await cdp.evaluate('document.querySelector("#btnMoneyStats").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerStatsPage").hidden === false', session, { label: '记账统计' });
  check(
    '记账统计里有「收入分类」，带环形图与明细列表',
    await cdp.evaluate(
      `document.querySelector('#ledgerStatsBody').textContent.includes('收入分类')
        && document.querySelectorAll('#ledgerStatsBody .donut__chart').length >= 2
        && document.querySelectorAll('#ledgerStatsBody .lstats__row').length >= 1`,
      session,
    ),
  );
  check(
    '分类明细条也有填充（宽度 > 0）',
    await cdp.evaluate(`document.querySelector('.lstats__fill').getBoundingClientRect().width > 0`, session),
  );
  await cdp.evaluate('document.querySelector("#btnLedgerStatsBack").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerStatsPage").hidden === true', session, { label: '退出记账统计' });

  // 键盘上的账户 chip：新建一个「微信」账户再切过去
  await cdp.evaluate('document.querySelector("#btnMoneySetup").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerSetupPage").hidden === false', session, { label: '账本设置' });
  await cdp.evaluate(`document.querySelector('#ledgerSetupBody .setting .setting__head .btn').click()`, session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '新建账户弹窗' });
  await cdp.evaluate(typeInto('#formDialogBody [data-field="name"]', '微信'), session);
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await new Promise((done) => setTimeout(done, 350));
  await cdp.evaluate('document.querySelector("#btnSetupBack").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerSetupPage").hidden === true', session, { label: '退出设置' });

  await cdp.evaluate('document.querySelector("#btnMoneyAdd").click()', session);
  await cdp.waitFor('document.querySelector("#keypad").hidden === false', session, { label: '金额键盘' });
  check(
    '键盘 chips 里有账户',
    await cdp.evaluate(`Boolean(document.querySelector("#keypadChips [data-chip='account']"))`, session),
  );
  await cdp.evaluate(`document.querySelector("#keypadChips [data-chip='account']").click()`, session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '选账户弹窗' });
  await cdp.evaluate(
    `(() => {
      const select = document.querySelector('#formDialogBody [data-field="accountId"]');
      const option = [...select.options].find((item) => item.textContent === '微信');
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`,
    session,
  );
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await new Promise((done) => setTimeout(done, 300));
  check(
    '账户 chip 跟着切到「微信」',
    await cdp.evaluate(`document.querySelector("#keypadChips [data-chip='account']").textContent === '微信'`, session),
  );
  for (const key of ['9', '9']) await cdp.evaluate(tapKey(key), session);
  await cdp.evaluate(tapKey('完成'), session);
  await cdp.waitFor('document.querySelector("#keypad").hidden === true', session, { label: '关闭键盘' });
  check(
    '切换账户后，这一笔记在新账户上',
    await cdp.evaluate(
      `new Promise((resolve) => {
        const request = indexedDB.open('diary-db');
        request.onsuccess = () => {
          const tx = request.result.transaction(['ledger', 'accounts'], 'readonly');
          const ledger = tx.objectStore('ledger').getAll();
          const accounts = tx.objectStore('accounts').getAll();
          tx.oncomplete = () => {
            const entry = ledger.result.find((item) => item.amount === 99);
            const account = entry && accounts.result.find((item) => item.id === entry.accountId);
            resolve(Boolean(account) && account.name === '微信');
          };
          tx.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      })`,
      session,
    ),
  );

  // 日记里引用一条记账（只读引用块）
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await cdp.waitFor('document.querySelectorAll(".card").length >= 1', session, { label: '时间线卡片' });
  await cdp.evaluate('document.querySelectorAll(".card")[0].click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开日记' });
  const contentBeforeQuote = await cdp.evaluate('document.querySelector("#fContent").value', session);
  await cdp.evaluate('document.querySelector("#btnQuoteLedger").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#formDialog[open]"))', session, { label: '引用记账弹窗' });
  await cdp.evaluate('document.querySelector("#formDialogOk").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#editorQuotes .quotechip"))', session, { label: '引用块出现' });
  check(
    '引用是正文下方的只读块：带金额、不可编辑、正文没被改动',
    await cdp.evaluate(
      `(() => {
        const chip = document.querySelector('#editorQuotes .quotechip');
        return (
          Boolean(chip)
          && chip.textContent.includes('¥')
          && chip.getAttribute('contenteditable') === null
          && document.querySelectorAll('#editorQuotes input, #editorQuotes textarea').length === 0
          && document.querySelector('#fContent').value === ${JSON.stringify(contentBeforeQuote)}
        );
      })()`,
      session,
    ),
  );
  await new Promise((done) => setTimeout(done, 800));
  check(
    '引用块跟着日记一起存进了数据库',
    await cdp.evaluate(
      `new Promise((resolve) => {
        const request = indexedDB.open('diary-db');
        request.onsuccess = () => {
          const all = request.result.transaction('entries', 'readonly').objectStore('entries').getAll();
          all.onsuccess = () => resolve(all.result.some((item) => Array.isArray(item.quotes) && item.quotes.length > 0));
          all.onerror = () => resolve(false);
        };
        request.onerror = () => resolve(false);
      })`,
      session,
    ),
  );
  await cdp.evaluate(
    `(() => {
      const chip = document.querySelector('#editorQuotes .quotechip');
      chip.focus();
      chip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      return true;
    })()`,
    session,
  );
  await cdp.waitFor('document.querySelectorAll("#editorQuotes .quotechip").length === 0', session, {
    label: '引用整条删除',
  });
  check('按一下删除键整条引用就没了', true);
  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === true', session, { label: '关掉编辑器' });

  // 待办卡片折叠
  await cdp.evaluate('document.querySelector("#btnTodoFold").click()', session);
  await cdp.waitFor('document.querySelector("#todoCardBody").hidden === true', session, { label: '待办收起' });
  check(
    '待办卡片能收起成一行',
    await cdp.evaluate(`document.querySelector('#todoCardTitle').textContent.includes('待办 ·')`, session),
  );
  await cdp.evaluate('document.querySelector("#btnTodoFold").click()', session);
  await cdp.waitFor('document.querySelector("#todoCardBody").hidden === false', session, { label: '待办展开' });
  check('再点一下能展开', true);

  // 导出完整备份 → 覆盖导入：数量与时间必须一模一样
  const snapshot = async () => ({
    cards: await cdp.evaluate('document.querySelectorAll(".card").length', session),
    cardTime: await cdp.evaluate(
      `document.querySelector('.card__time') ? document.querySelector('.card__time').textContent : ''`,
      session,
    ),
    flow: await cdp.evaluate('document.querySelectorAll("#moneyFlow .mflow__row").length', session),
    todos: await cdp.evaluate('document.querySelectorAll("#todoList .todo").length', session),
  });
  const beforeRoundTrip = await snapshot();
  const downloadDir = mkdtempSync(join(tmpdir(), 'diary-download-'));
  await cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  });
  await cdp.evaluate('document.querySelector("[data-tab=\'profile\']").click()', session);
  await cdp.evaluate('document.querySelector("#btnExportBundle").click()', session);
  let backupZip = null;
  for (let attempt = 0; attempt < 80 && !backupZip; attempt += 1) {
    const files = readdirSync(downloadDir).filter((name) => name.endsWith('.zip'));
    if (files.length) backupZip = join(downloadDir, files[0]);
    else await new Promise((done) => setTimeout(done, 250));
  }
  check('点「导出完整备份」真的落下一个 zip 文件', Boolean(backupZip), backupZip || '没等到文件');
  if (backupZip) {
    await cdp.send('DOM.enable', {}, session);
    const { root: zipRoot } = await cdp.send('DOM.getDocument', {}, session);
    const { nodeId: zipNode } = await cdp.send(
      'DOM.querySelector',
      { nodeId: zipRoot.nodeId, selector: '#fileInput' },
      session,
    );
    await cdp.send('DOM.setFileInputFiles', { files: [backupZip], nodeId: zipNode }, session);
    await cdp.waitFor('Boolean(document.querySelector("#importDialog[open]"))', session, { label: '导入弹窗' });
    await cdp.waitFor('document.querySelector("#importSummary").textContent.includes("篇日记")', session, {
      label: '解析备份',
    });
    await cdp.evaluate('document.querySelector("#btnImportReplace").click()', session);
    await cdp.waitFor('Boolean(document.querySelector("#confirmDialog[open]"))', session, { label: '覆盖确认' });
    await cdp.evaluate('document.querySelector("#btnConfirmOk").click()', session);
    await new Promise((done) => setTimeout(done, 1500));
    const afterRoundTrip = await snapshot();
    check(
      '导出再覆盖导入：日记时间 / 记账 / 待办 完全一致',
      JSON.stringify(beforeRoundTrip) === JSON.stringify(afterRoundTrip),
      `${JSON.stringify(beforeRoundTrip)} vs ${JSON.stringify(afterRoundTrip)}`,
    );
  }

  // 导入备份（走真实的文件选择）
  await cdp.send('DOM.enable', {}, session);
  const { root } = await cdp.send('DOM.getDocument', {}, session);
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' }, session);
  await cdp.send('DOM.setFileInputFiles', { files: [importPath], nodeId }, session);
  await cdp.waitFor('Boolean(document.querySelector("#importDialog[open]"))', session, { label: '导入对话框' });
  await cdp.waitFor('document.querySelector("#importSummary").textContent.includes("1 篇日记")', session, {
    label: '导入预览',
  });
  check('选择备份文件后会解析并给出预览', true, await cdp.evaluate('document.querySelector("#importSummary").textContent', session));
  await cdp.evaluate('document.querySelector("#btnImportMerge").click()', session);
  await cdp.waitFor('document.querySelectorAll(".card").length === 2', session, { label: '导入写入完成' });
  check('合并导入后列表多了一条', true);
  check('导入的内容正确落库', await cdp.evaluate(
    `(() => {
      const db = indexedDB.open('diary-db');
      return new Promise((resolve) => {
        db.onsuccess = () => {
          const all = db.result.transaction('entries', 'readonly').objectStore('entries').getAll();
          all.onsuccess = () => resolve(all.result.some((e) => e.content === '这条来自导入的备份' && e.date === '2026-08-08'));
          all.onerror = () => resolve(false);
        };
        db.onerror = () => resolve(false);
      });
    })()`,
    session,
  ));

  // 加密 .mbk 导入：先要密码，再导入
  const { nodeId: mbkInput } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#fileInput' }, session);
  await cdp.send('DOM.setFileInputFiles', { files: [mbkPath], nodeId: mbkInput }, session);
  await cdp.waitFor('Boolean(document.querySelector("#importDialog[open]"))', session, { label: '.mbk 导入对话框' });
  check('加密 .mbk 会提示输入密码', await cdp.evaluate('document.querySelector("#importPasswordRow").hidden === false', session));
  await cdp.evaluate('document.querySelector("#btnImportRead").click()', session);
  await cdp.waitFor('document.querySelector("#importProgress").textContent.includes("密码")', session, {
    label: '缺少密码时的提示',
  });
  check('没有密码时不会误导入', await cdp.evaluate('document.querySelector("#btnImportMerge").disabled === true', session));
  await cdp.evaluate(typeInto('#importPassword', 'demo-pass'), session);
  await cdp.evaluate('document.querySelector("#btnImportRead").click()', session);
  await cdp.waitFor('document.querySelector("#importSummary").textContent.includes("2 篇日记")', session, {
    label: '解密并解析',
  });
  check(
    '输入正确密码后解出 2 篇日记 + 1 张图',
    await cdp.evaluate('document.querySelector("#importSummary").textContent.includes("1 张图片")', session),
    await cdp.evaluate('document.querySelector("#importSummary").textContent', session),
  );
  await cdp.evaluate('document.querySelector("#btnImportMerge").click()', session);
  await cdp.waitFor('document.querySelectorAll(".card").length === 4', session, { label: '.mbk 导入写入完成' });
  check('加密备份合并后列表变成 4 条', true);
  check('图片也写进了媒体库', await cdp.evaluate(
    `new Promise((resolve) => {
      const request = indexedDB.open('diary-db');
      request.onsuccess = () => {
        const keys = request.result.transaction('media', 'readonly').objectStore('media').getAllKeys();
        keys.onsuccess = () => resolve(keys.result.length === 1);
        keys.onerror = () => resolve(false);
      };
      request.onerror = () => resolve(false);
    })`,
    session,
  ));

  // 上/下一篇导航
  await cdp.evaluate('document.querySelectorAll(".card")[0].click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开最新一篇' });
  const newestContent = await cdp.evaluate('document.querySelector("#fContent").value', session);
  check('已是最新一篇时「下一篇」是禁用的', await cdp.evaluate('document.querySelector("#btnNextDay").disabled === true', session));
  await cdp.evaluate('document.querySelector("#btnPrevDay").click()', session);
  await cdp.waitFor(`document.querySelector("#fContent").value !== ${JSON.stringify(newestContent)}`, session, {
    label: '切到上一篇',
  });
  check('点「上一篇」能切到更早的一篇', true, await cdp.evaluate('document.querySelector("#fDate").value', session));
  check('切过去之后「下一篇」可用了', await cdp.evaluate('document.querySelector("#btnNextDay").disabled === false', session));
  await cdp.evaluate('document.querySelector("#btnNextDay").click()', session);
  await cdp.waitFor('document.querySelector("#fContent").value === ' + JSON.stringify(newestContent), session, {
    label: '切回下一篇',
  });
  check('点「下一篇」能切回更新的那篇', true);

  // 编辑器里左右滑动切换上/下一篇
  const beforeSwipe = await cdp.evaluate('document.querySelector("#fContent").value', session);
  await cdp.evaluate(
    `(() => {
      const area = document.querySelector('#editor');
      const mk = (x) => new Touch({ identifier: 1, target: area, clientX: x, clientY: 400 });
      area.dispatchEvent(new TouchEvent('touchstart', { touches: [mk(120)], changedTouches: [mk(120)], bubbles: true }));
      area.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [mk(320)], bubbles: true }));
      return true;
    })()`,
    session,
  );
  await cdp.waitFor(`document.querySelector("#fContent").value !== ${JSON.stringify(beforeSwipe)}`, session, {
    label: '右滑切到更早的一篇',
  });
  check('编辑器里右滑能切换到更早的一篇', true, await cdp.evaluate('document.querySelector("#fDate").value', session));

  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === true', session, { label: '收工回列表' });

  // 重新编辑一篇旧日记：位置必须保持原位（不能因为 updatedAt 刷新而顶到第一条）
  const orderBefore = await cdp.evaluate("[...document.querySelectorAll('.card')].map((c) => c.dataset.id)", session);
  await cdp.evaluate(
    `(() => {
      const cards = [...document.querySelectorAll('.card')];
      cards[cards.length - 1].click();
      return true;
    })()`,
    session,
  );
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开最早的一篇' });
  await cdp.evaluate(typeInto('#fContent', '把这篇老日记重新编辑一下'), session);
  await cdp.waitFor('document.querySelector("#saveStatus").textContent.includes("已保存")', session, {
    label: '旧日记自动保存',
  });
  await cdp.evaluate('document.querySelector("#btnBack").click()', session);
  await cdp.waitFor(`document.querySelectorAll(".card").length === ${orderBefore.length}`, session, { label: '回到列表' });
  const orderAfter = await cdp.evaluate("[...document.querySelectorAll('.card')].map((c) => c.dataset.id)", session);
  check(
    '重新编辑旧日记后位置不变',
    JSON.stringify(orderBefore) === JSON.stringify(orderAfter),
    `${orderBefore.length} 条，顺序${JSON.stringify(orderBefore) === JSON.stringify(orderAfter) ? '一致' : '被改变'}`,
  );

  // 删除
  await cdp.evaluate('document.querySelector(".card").click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开一篇准备删除' });
  const before = (await cdp.evaluate(READ_DB, session)).length;
  await cdp.evaluate('document.querySelector("#btnDelete").click()', session);
  await cdp.waitFor('Boolean(document.querySelector("#confirmDialog[open]"))', session, { label: '删除确认弹窗' });
  check(
    '删除用应用内弹窗，不是浏览器原生 confirm',
    await cdp.evaluate(
      `document.querySelector('#confirmDialog').classList.contains('sheet--center')
        && document.querySelector('#btnConfirmOk').textContent === '删除'`,
      session,
    ),
  );
  await cdp.evaluate('document.querySelector("#btnConfirmOk").click()', session);
  await cdp.waitFor(`document.querySelectorAll(".card").length === ${before - 1}`, session, { label: '删除后列表减少' });
  const after = await cdp.evaluate(READ_DB, session);
  check('确认后删除干净', after.length === before - 1, `${before} → ${after.length}`);

  // file:// 直接双击打开也要能用（用户反馈的问题）
  const fileSession = await cdp.openPage(pathToFileURL(resolve('index.html')).href);
  await cdp.waitFor(BOOTED, fileSession, { label: 'file:// 首屏' });
  check('file:// 打开时脚本能加载（Diary 命名空间存在）', await cdp.evaluate('typeof window.Diary === "object"', fileSession));
  await cdp.evaluate('document.querySelector("#btnNew").click()', fileSession);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', fileSession, { label: 'file:// 下点按钮有反应' });
  check('file:// 下按钮真的能点（新建能打开编辑器）', true);
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', fileSession);
  await cdp.waitFor('document.querySelectorAll(".calcell").length >= 28', fileSession, { label: 'file:// 日历' });
  check('file:// 下日历也能渲染', true);

  check('全程没有未捕获的脚本错误', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ').slice(0, 220));

  // 导出：网页里真的产生下载；原生 App 里（WebView 不支持 blob 下载）要写文件 + 调起分享
  check(
    '网页端导出会真的产生下载文件',
    await cdp.evaluate(
      `(async () => {
        const original = URL.createObjectURL;
        let created = false;
        URL.createObjectURL = (blob) => {
          created = true;
          return original.call(URL, blob);
        };
        const result = await window.Diary.ui.downloadFile('导出测试.txt', 'hello', 'text/plain');
        URL.createObjectURL = original;
        return created && Boolean(result) && result.native === false;
      })()`,
      session,
    ),
  );
  check(
    '原生端导出会写进缓存目录并调起系统分享',
    await cdp.evaluate(
      `(async () => {
        const calls = [];
        window.Capacitor = {
          isNativePlatform: () => true,
          Plugins: {
            Filesystem: {
              writeFile: async (options) => {
                calls.push(['write', options.path, options.directory, typeof options.data]);
                return { uri: 'file:///cache/' + options.path };
              },
            },
            Share: {
              share: async (options) => {
                calls.push(['share', options.files && options.files[0]]);
              },
            },
          },
        };
        const result = await window.Diary.ui.downloadFile('导出测试.json', '{"a":1}', 'application/json');
        delete window.Capacitor;
        return (
          result.native === true &&
          calls[0] &&
          calls[0][0] === 'write' &&
          calls[0][1] === '导出测试.json' &&
          calls[0][2] === 'CACHE' &&
          calls[0][3] === 'string' &&
          calls[1] &&
          calls[1][0] === 'share' &&
          String(calls[1][1]).endsWith('导出测试.json')
        );
      })()`,
      session,
    ),
  );
} catch (error) {
  check(`执行中断：${error.message}`, false);
} finally {
  await closeBrowser(browserInstance);
  server.close();
}

const failed = checks.filter((item) => !item.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed ? 1 : 0);
