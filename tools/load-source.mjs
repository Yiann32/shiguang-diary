/**
 * 测试用的加载器：在 Node 里把浏览器用的经典脚本读进来执行（挂到 globalThis.Diary）。
 * 这样同一份源码既能被浏览器直接 <script> 引入，也能被单元测试使用。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function loadSource(...files) {
  for (const file of files) {
    const code = readFileSync(join(root, file), 'utf8');
    new Function(code)();
  }
  return globalThis.Diary;
}

export const projectRoot = root;
