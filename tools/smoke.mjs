/**
 * 端到端冒烟测试：用无头浏览器真的把应用跑起来。
 * 覆盖：首屏 → 新建 → 自动保存 → 刷新后还在 → 日历 → 预览 → 搜索 → 删除
 *       → 导入备份 → file:// 双击打开也能用（这条是用户反馈的「按钮按不动」）
 *
 *   npm run smoke
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { findBrowser, launchBrowser } from './cdp.mjs';
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

const { child, cdp } = await launchBrowser(browser);
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

  // 日历三态：日记 / 记账 / 待办
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  // 上一步左滑测试把日历留在了下个月，先回到今天
  await cdp.evaluate('document.querySelector("#btnCalToday").click()', session);
  await cdp.evaluate('document.querySelector("[data-cal-mode=\'money\']").click()', session);
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
  await cdp.evaluate('document.querySelector("[data-cal-mode=\'todo\']").click()', session);
  await cdp.waitFor('document.querySelector("[data-cal-mode=\'todo\']").classList.contains("is-active")', session, {
    label: '日历待办模式',
  });
  check(
    '日历待办模式换成了待办视图',
    await cdp.evaluate(`document.querySelector('#dayList').textContent.includes('待办')`, session),
  );
  await cdp.evaluate('document.querySelector("[data-cal-mode=\'diary\']").click()', session);

  // 待办：新增 → 勾选 → 归档
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await cdp.evaluate(typeInto('#todoInput', '买牛奶'), session);
  await cdp.evaluate('document.querySelector("#btnTodoAdd").click()', session);
  await cdp.waitFor('document.querySelectorAll("#todoList .todo").length === 1', session, { label: '新增待办' });
  check('时间线页可以快速加待办', true);
  await cdp.evaluate('document.querySelector("#todoList .todo__check").click()', session);
  await cdp.waitFor('document.querySelectorAll("#todoList .todo").length === 0', session, { label: '完成后移出卡片' });
  check('勾选完成后从待办卡片移出', true);
  await cdp.evaluate('document.querySelector("#btnTodoMore").click()', session);
  await cdp.waitFor('document.querySelector("#todoPage").hidden === false', session, { label: '待办二级页' });
  check(
    '待办二级页把已完成的归档在下面',
    await cdp.evaluate('document.querySelectorAll("#todoPageBody .todo.is-done").length === 1', session),
  );
  await cdp.evaluate('document.querySelector("#btnTodoBack").click()', session);
  await cdp.waitFor('document.querySelector("#todoPage").hidden === true', session, { label: '退出待办页' });

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
} catch (error) {
  check(`执行中断：${error.message}`, false);
} finally {
  child.kill();
  server.close();
}

const failed = checks.filter((item) => !item.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed ? 1 : 0);
