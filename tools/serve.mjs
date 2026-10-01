/**
 * 零依赖静态服务器，只为本地开发/手机联调：
 *   npm start            → http://localhost:5173
 *   npm start -- 8080    → 换端口
 * 手机连同一 Wi-Fi 时，用 http://<电脑局域网 IP>:5173 就能打开，也能装到主屏。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** 静态服务器，tools/smoke.mjs 也会复用它。 */
export function createStaticServer(baseDir = root) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';

      const target = resolve(join(baseDir, normalize(pathname)));
      if (target !== baseDir && !target.startsWith(baseDir + sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      let file = target;
      try {
        const info = await stat(file);
        if (info.isDirectory()) file = join(file, 'index.html');
      } catch {
        response.writeHead(404).end('Not found');
        return;
      }

      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500).end(`Server error: ${error.message}`);
    }
  });
}

function localAddresses() {
  const found = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === 'IPv4' && !item.internal) found.push(item.address);
    }
  }
  return found;
}

// 直接 `node tools/serve.mjs` 运行时才监听端口；被 import 时只导出工厂函数
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 5173);
  createStaticServer(root).listen(port, () => {
    console.log('拾光日记已启动：');
    console.log(`  本机   http://localhost:${port}`);
    for (const address of localAddresses()) {
      console.log(`  手机   http://${address}:${port}   (需与电脑同一 Wi-Fi)`);
    }
    console.log('按 Ctrl+C 停止。');
  });
}
