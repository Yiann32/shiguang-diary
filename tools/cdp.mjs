/**
 * 极简 Chrome DevTools 协议客户端：给冒烟测试和截图脚本共用。
 * 只用 Node 内置能力（child_process + 全局 WebSocket），不需要任何依赖。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BROWSER_CANDIDATES = [
  process.env.DIARY_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findBrowser() {
  return BROWSER_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP 超时：${method}`));
      }, 20000);
    });
  }

  on(listener) {
    this.listeners.add(listener);
  }

  async evaluate(expression, sessionId) {
    const result = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`页面内执行出错：${detail}`);
    }
    return result.result.value;
  }

  /** 轮询等待页面达到某个状态。 */
  async waitFor(expression, sessionId, { timeout = 8000, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const ready = await this.evaluate(
        `(() => { try { return Boolean(${expression}); } catch (error) { return false; } })()`,
        sessionId,
      );
      if (ready) return true;
      if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async openPage(url) {
    const { targetId } = await this.send('Target.createTarget', { url });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    await this.send('Runtime.enable', {}, sessionId);
    await this.send('Page.enable', {}, sessionId);
    return sessionId;
  }

  async screenshot(sessionId) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    return Buffer.from(data, 'base64');
  }
}

export async function launchBrowser(browser, extraArgs = []) {
  const profile = mkdtempSync(join(tmpdir(), 'diary-browser-'));
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  // 有的版本（Windows 上的 Edge）启动器会立刻退出、把真正的浏览器进程留在后台，
  // 这时 stderr 拿不到「DevTools listening on …」。所以同时轮询 profile 里的
  // DevToolsActivePort 文件，两条路谁先到用谁。
  const portFile = join(profile, 'DevToolsActivePort');
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    let exitCode = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poller);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      finish(
        new Error(
          exitCode === null ? '浏览器没有在 20 秒内启动 DevTools' : `浏览器提前退出，退出码 ${exitCode}`,
        ),
      );
    }, 20000);
    const poller = setInterval(() => {
      try {
        const [port, path] = readFileSync(portFile, 'utf8').split('\n');
        if (port && path) finish(null, `ws://127.0.0.1:${Number(port)}${path.trim()}`);
      } catch (error) {
        /* 文件还没写出来，继续等 */
      }
    }, 150);
    child.stderr.on('data', (chunk) => {
      buffer += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) finish(null, match[1]);
    });
    child.on('error', (error) => finish(error));
    child.on('exit', (code) => {
      exitCode = code;
    });
  });

  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('无法连接 DevTools')), { once: true });
  });

  return { child, cdp: new Cdp(socket) };
}
