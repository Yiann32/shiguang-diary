/**
 * 生成界面预览图（README 用），顺便做视觉自查：
 *   npm run screenshots
 * 会先往（临时）数据库写入几条示例日记，图片用 canvas 现画，再分别截图。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findBrowser, launchBrowser } from './cdp.mjs';
import { createStaticServer } from './serve.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = join(root, 'screenshots');

const browser = findBrowser();
if (!browser) {
  console.log('没找到 Chrome / Edge，跳过截图（可用 DIARY_BROWSER=路径 指定）。');
  process.exit(0);
}

/** 在页面里造示例数据；顺手用 canvas 画两张图当配图。 */
const SEED = `(async () => {
  const pad = (value) => String(value).padStart(2, '0');
  const dayKey = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  };
  const make = (offset, time, title, content, tags, pinned) => {
    const createdAt = Date.parse(dayKey(offset) + 'T' + time + ':00');
    return { id: 'demo-' + offset, date: dayKey(offset), time, title, content, tags, pinned,
      media: [], source: '', createdAt, updatedAt: createdAt + 900000 };
  };

  const paint = (from, to, label) => new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#fff8e7';
    ctx.beginPath();
    ctx.arc(430, 150, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '500 34px -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(label, 40, canvas.height - 46);
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });

  const entries = [
    make(0, '21:10', '傍晚的散步', '今天下班早，绕着小区后面的河堤走了四十分钟。\\n\\n风有点凉，河面上全是碎金子一样的晚霞。\\n\\n- 散步时想通了方案里卡住的那一环\\n- 顺手买了两根玉米', ['生活', '散步'], false),
    make(1, '22:40', '读书笔记：慢思考', '## 第二章\\n\\n> 把注意力当成有限的预算来花。\\n\\n**结论**：不是时间不够，是可用的专注不够。今天试着把手机放到另一个房间，效率确实不一样。', ['读书'], true),
    make(3, '08:05', '周末计划', '这个周末想做的事：\\n\\n1. 把阳台的花修一遍\\n2. 写一份旅行清单\\n3. 什么都不做，睡到自然醒', ['计划'], false),
    make(12, '19:30', '雨', '下了一整天的雨，伞骨断了一根。\\n\\n不过楼下那棵桂花开了，闻着心里好了一点。', ['随笔'], false),
    make(25, '12:00', '老朋友', '中午和大学室友吃饭，聊了快三个小时。\\n\\n十年过去，他说话的语气还和当年一样。', ['朋友', '纪念'], false),
  ];

  // 给第一条日记配上两张图
  const ids = [];
  const blobs = [await paint('#f7b267', '#7b83c4', '河堤的晚霞'), await paint('#6d8bb5', '#2c3a52', '傍晚的风')];
  const stamp = Date.parse(dayKey(0) + 'T21:10:00');
  blobs.forEach((blob, index) => {
    const id = 'demo-0:' + (index + 1);
    ids.push(id);
    entries[0].media.push(id);
  });

  await new Promise((resolve, reject) => {
    const request = indexedDB.open('diary-db');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(['entries', 'media'], 'readwrite');
      const store = transaction.objectStore('entries');
      for (const entry of entries) store.put(entry);
      const mediaStore = transaction.objectStore('media');
      ids.forEach((id, index) => mediaStore.put({ id, blob: blobs[index] }));
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    };
  });

  // 再塞一点记账与待办的示例数据（用仓库层写，省得手工拼新表）
  const store = Diary.createStore();
  await store.init();
  const account = store.accounts()[0];
  const card = await store.addAccount({ name: '招行卡', kind: 'debit', initialBalance: 12000 });
  const expense = store.categories('expense');
  const income = store.categories('income');
  const pick = (list, name) => (list.find((item) => item.name === name) || list[0]).id;
  await store.addLedger({ type: 'expense', amount: 32.5, categoryId: pick(expense, '餐饮'), accountId: account.id, note: '楼下的面馆', date: dayKey(0), time: '12:20' });
  await store.addLedger({ type: 'expense', amount: 6, categoryId: pick(expense, '交通'), accountId: account.id, note: '地铁', date: dayKey(0), time: '08:40' });
  await store.addLedger({ type: 'expense', amount: 268, categoryId: pick(expense, '购物'), accountId: card.id, note: '一双跑鞋', date: dayKey(1), time: '20:05' });
  await store.addLedger({ type: 'expense', amount: 18, categoryId: pick(expense, '餐饮'), accountId: account.id, note: '早饭', date: dayKey(2), time: '07:50' });
  await store.addLedger({ type: 'income', amount: 1200, categoryId: pick(income, '兼职'), accountId: card.id, note: '稿费', date: dayKey(4), time: '15:00' });
  await store.setBudget('month-total', 3000);
  await store.addTodo({ text: '交房租', dueDate: dayKey(-3), priority: 2, note: '记得带票据' });
  await store.addTodo({ text: '买牛奶', priority: 0 });
  await store.addTodo({ text: '把阳台的花修一遍', priority: 1, done: true, doneAt: Date.now() });
  return ids.length + Date.parse(String(stamp));
})()`;

mkdirSync(outDir, { recursive: true });

const server = createStaticServer();
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`浏览器：${browser}`);

const { child, cdp } = await launchBrowser(browser);

const setViewport = (sessionId, { width, height, scale, mobile = false }) =>
  cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile }, sessionId);

const save = (name, buffer) => {
  writeFileSync(join(outDir, name), buffer);
  console.log(`已生成 screenshots/${name}  ${(buffer.length / 1024).toFixed(0)} KB`);
};

const settle = (ms) => new Promise((done) => setTimeout(done, ms));

/** 每次刷新后都要等启动画面退场，否则截到的是深灰启动页 */
const waitReady = async (sessionId) => {
  await cdp.waitFor('Boolean(window.Diary) && document.querySelectorAll("#tabbar svg").length === 4', sessionId, {
    label: '就绪',
  });
  await cdp.waitFor('!document.querySelector("#bootSplash")', sessionId, { label: '启动画面退场' });
};

try {
  const session = await cdp.openPage(`${base}/index.html`);
  await waitReady(session);
  await cdp.evaluate(SEED, session);
  await cdp.send('Page.reload', {}, session);
  await waitReady(session);
  await cdp.waitFor('document.querySelectorAll(".card").length >= 5', session, { label: '示例日记载入' });

  // 手机端：时间线
  await setViewport(session, { width: 390, height: 844, scale: 3, mobile: true });
  await cdp.send('Page.reload', {}, session);
  await waitReady(session);
  await cdp.waitFor('document.querySelectorAll(".card").length >= 5', session, { label: '时间线就绪' });
  await cdp.waitFor('document.querySelectorAll(".card__thumb").length >= 2', session, { label: '缩略图加载' });
  await settle(400);
  save('mobile-timeline.png', await cdp.screenshot(session));

  // 手机端：日历
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  await cdp.waitFor('document.querySelectorAll(".calcell").length >= 28', session, { label: '日历就绪' });
  await settle(400);
  save('mobile-calendar.png', await cdp.screenshot(session));

  // 手机端：记账首页
  await cdp.evaluate('document.querySelector("[data-tab=\'money\']").click()', session);
  await cdp.waitFor('document.querySelectorAll(".mflow__row").length >= 1', session, { label: '记账页就绪' });
  await settle(400);
  save('mobile-money.png', await cdp.screenshot(session));

  // 手机端：记一笔（全屏金额键盘 + 分类九宫格）
  await cdp.evaluate('document.querySelector("#btnMoneyAdd").click()', session);
  await cdp.waitFor('document.querySelector("#keypad").hidden === false', session, { label: '金额键盘就绪' });
  for (const key of ['3', '2', '.', '5']) {
    await cdp.evaluate(
      `[...document.querySelectorAll('#keypadPad .key')].find((node) => node.textContent === '${key}').click()`,
      session,
    );
  }
  await settle(400);
  save('mobile-keypad.png', await cdp.screenshot(session));
  await cdp.evaluate('document.querySelector("#btnKeypadClose").click()', session);
  await settle(320);

  // 手机端：账本设置（账户 / 预算 / 分类 / 周期记账）
  await cdp.evaluate('document.querySelector("#btnMoneySetup").click()', session);
  await cdp.waitFor('document.querySelector("#ledgerSetupPage").hidden === false', session, { label: '账本设置就绪' });
  await settle(400);
  save('mobile-setup.png', await cdp.screenshot(session));
  await cdp.evaluate('document.querySelector("#btnSetupBack").click()', session);
  await settle(320);

  // 手机端：日历的记账模式（格子里显示当天支出）
  await cdp.evaluate('document.querySelector("[data-tab=\'calendar\']").click()', session);
  await cdp.evaluate('document.querySelector("[data-cal-mode=\'money\']").click()', session);
  await settle(400);
  save('mobile-calendar-money.png', await cdp.screenshot(session));
  await cdp.evaluate('document.querySelector("[data-cal-mode=\'diary\']").click()', session);

  // 手机端：编辑界面（参考图那套：✕ 退出 / 保存 / 大号日期 / 标签 · 字数）
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await cdp.evaluate('document.querySelectorAll(".card")[1].click()', session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '打开编辑器' });
  await settle(400);
  save('mobile-editor.png', await cdp.screenshot(session));

  // 桌面端：列表 + 编辑器
  await setViewport(session, { width: 1280, height: 820, scale: 2 });
  await cdp.send('Page.reload', {}, session);
  await waitReady(session);
  await cdp.waitFor('document.querySelector("#editor").hidden === false', session, { label: '桌面端自动打开' });
  await cdp.waitFor('document.querySelectorAll(".card").length >= 4', session, { label: '桌面列表' });
  await settle(400);
  save('desktop.png', await cdp.screenshot(session));

  // 深色模式的时间线（参考截图就是这个风格）
  await cdp.evaluate('document.querySelector("[data-tab=\'profile\']").click()', session);
  await cdp.evaluate('document.querySelector("[data-theme-value=\'dark\']").click()', session);
  await cdp.evaluate('document.querySelector("[data-tab=\'timeline\']").click()', session);
  await settle(400);
  save('desktop-dark.png', await cdp.screenshot(session));
} finally {
  child.kill();
  server.close();
}

// 浏览器是子进程 + keep-alive 连接，事件循环不一定自己排空，显式退出
process.exit(0);
