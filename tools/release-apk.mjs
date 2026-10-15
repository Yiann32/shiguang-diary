/**
 * 把最新 APK 发到「固定下载网址」。
 *
 * 网址固定不变，永远给最新一版：
 *   下载页：https://yiann32.github.io/shiguang-diary/
 *   直链　：https://yiann32.github.io/shiguang-diary/shiguang-diary.apk
 *
 * 原理：另起一条 `apk` 分支，永远只保留一个提交（每次强推覆盖），里面只有
 * `index.html` + `shiguang-diary.apk`，所以主仓库历史不会被 4 MB 的包撑大。
 * GitHub Pages 指向这条分支的根目录即可。
 *
 *   node tools/release-apk.mjs                 # 生成并推送到 origin 的 apk 分支
 *   node tools/release-apk.mjs --dry           # 只在本地 .release/ 生成，不碰 git
 *   node tools/release-apk.mjs --no-push       # 本地提交，但不推送
 *   node tools/release-apk.mjs --apk=D:\下载\拾光日记-最新.apk
 *
 * 环境变量：
 *   SHIGUANG_PAGES_URL       下载页前缀（默认 https://yiann32.github.io/shiguang-diary）
 *   SHIGUANG_RELEASE_REMOTE  推送地址（默认公开仓库的 https 地址）
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeQr, qrToSvg, selfCheck } from './make-qr.mjs';
import { buildPage } from './release-page.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIR = join(ROOT, '.release');
const DEFAULT_APK = join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

const PAGES_BASE = (process.env.SHIGUANG_PAGES_URL || 'https://yiann32.github.io/shiguang-diary').replace(/\/+$/, '');
const PAGE_URL = `${PAGES_BASE}/`;
const APK_URL = `${PAGES_BASE}/shiguang-diary.apk`;
const REPO_URL = 'https://github.com/Yiann32/shiguang-diary';
const APK_NAME = 'shiguang-diary.apk';
const REMOTE = process.env.SHIGUANG_RELEASE_REMOTE || 'https://github.com/Yiann32/shiguang-diary.git';

/* ------------------------------------------------------------- 参数 */

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const hit = args.find((item) => item.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};

const dryRun = flag('--dry');
const noPush = flag('--no-push');
const apkPath = resolve(value('--apk', DEFAULT_APK));

/* --------------------------------------------------------- 读取信息 */

if (!existsSync(apkPath)) {
  console.error(`找不到 APK：${apkPath}`);
  console.error('先打包：npm run build:native → npx cap sync android → gradlew.bat assembleDebug');
  process.exit(1);
}

const apkStat = statSync(apkPath);
const sizeText = `${(apkStat.size / 1048576).toFixed(2)} MB`;
const stamp = formatStamp(apkStat.mtime);
const version = value('--version', readVersionName());

function formatStamp(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 版本号：优先取 App「关于」里显示的 `js/app.js` → VERSION（用户能对上号），
 * 其次 android 工程的 versionName，最后 package.json。
 */
function readVersionName() {
  try {
    const app = readFileSync(join(ROOT, 'js', 'app.js'), 'utf8');
    const hit = app.match(/const\s+VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (hit) return hit[1];
  } catch {
    /* 忽略 */
  }
  const gradle = join(ROOT, 'android', 'app', 'build.gradle');
  try {
    const text = readFileSync(gradle, 'utf8');
    const names = [...text.matchAll(/versionName\s+["']([^"']+)["']/g)].map((match) => match[1]);
    if (names.length) return names[names.length - 1];
  } catch {
    /* 没有 android 工程：回落到 package.json */
  }
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/* ------------------------------------------------------------- 二维码 */

const qr = encodeQr(APK_URL);
const check = selfCheck(APK_URL, qr);
if (!check.ok) {
  console.error(`二维码自检失败：${check.reason}`);
  process.exit(1);
}
const qrSvg = qrToSvg(qr, { size: 196, quiet: 3, label: '扫码下载拾光日记' });

/* ------------------------------------------------------------- 页面 */

const html = buildPage({ version, stamp, sizeText, qrSvg, apkUrl: APK_URL, pageUrl: PAGE_URL, repoUrl: REPO_URL });

/* ------------------------------------------------------------- 落地 */

mkdirSync(RELEASE_DIR, { recursive: true });
writeFileSync(join(RELEASE_DIR, 'index.html'), html, 'utf8');
copyFileSync(apkPath, join(RELEASE_DIR, APK_NAME));

console.log(`APK　：${apkPath}`);
console.log(`版本：v${version} · ${stamp} · ${sizeText}`);
console.log(`页面：${join(RELEASE_DIR, 'index.html')}`);
console.log(`二维码自检：通过（版本 ${qr.version}，掩码 ${qr.mask}）`);
console.log(`下载页：${PAGE_URL}`);
console.log(`直　链：${APK_URL}`);

if (dryRun) {
  console.log('\n--dry：已生成文件，未执行 git 操作。');
  process.exit(0);
}

/* --------------------------------------------------------- 推送分支 */

const git = (gitArgs, options = {}) =>
  execFileSync('git', gitArgs, { cwd: RELEASE_DIR, encoding: 'utf8', ...options });
const gitQuiet = (gitArgs) => {
  try {
    git(gitArgs);
    return true;
  } catch {
    return false;
  }
};

if (!existsSync(join(RELEASE_DIR, '.git'))) {
  git(['init', '-q']);
  git(['remote', 'add', 'origin', REMOTE]);
} else {
  gitQuiet(['remote', 'set-url', 'origin', REMOTE]);
}
gitQuiet(['config', 'user.name', '拾光日记发布']);
gitQuiet(['config', 'user.email', 'yiann32@users.noreply.github.com']);

// 单提交：每次都用 orphan 分支重建，最后重命名为 apk
gitQuiet(['branch', '-D', 'publish']);
git(['checkout', '-q', '--orphan', 'publish']);
git(['add', '-A']);
git(['commit', '-q', '-m', `拾光日记 APK v${version}（${stamp}）`]);
git(['branch', '-M', 'publish', 'apk']);

const commit = git(['rev-parse', '--short', 'HEAD']).trim();
const files = git(['ls-tree', '-r', '--name-only', 'apk']).trim().split('\n').filter(Boolean);
console.log(`\napk 分支：${commit} · 文件 ${files.join('、')}`);

if (noPush) {
  console.log('--no-push：已本地提交，未推送。');
  process.exit(0);
}

git(['push', '-f', 'origin', 'apk'], { stdio: 'inherit' });
console.log('\n已推送。等 Pages 生效后（通常 1 分钟内）：');
console.log(`  下载页 ${PAGE_URL}`);
console.log(`  直　链 ${APK_URL}`);
console.log('首次还需要在仓库 Settings → Pages 里把 Source 设为 apk / (root)。');
