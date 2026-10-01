/**
 * 打包给 Capacitor 用的静态目录（www/）。
 * 只复制运行时需要的文件，测试、工具脚本、说明文档不会进 App 包。
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = join(root, 'www');
const ASSETS = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'];

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let copied = 0;
for (const asset of ASSETS) {
  const from = join(root, asset);
  try {
    await stat(from);
  } catch {
    console.warn(`跳过不存在的文件：${asset}`);
    continue;
  }
  await cp(from, join(outDir, asset), { recursive: true });
  copied += 1;
}

console.log(`已生成 ${outDir} （${copied} 项资源）`);
console.log('下一步：npx cap sync android  或  npx cap sync ios');
