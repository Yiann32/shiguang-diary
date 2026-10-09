/**
 * 给 Capacitor 生成的 Android 工程做两件在国内几乎必须的事：
 *   1. 换上自己的应用图标（含 Android 8+ 的自适应图标）
 *   2. 把 Gradle / 依赖仓库换成国内镜像，否则 Android Studio 同步会卡在下载上
 *
 * 用法（每次 npx cap add android 之后跑一次即可）：
 *   node tools/setup-android.mjs
 */

import { cp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const androidDir = join(root, 'android');
const resDir = join(androidDir, 'app', 'src', 'main', 'res');
const iconDir = join(root, 'android-icons');

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    return false;
  }
};

if (!(await exists(androidDir))) {
  console.error('还没生成 Android 工程，先执行：npx cap add android');
  process.exit(1);
}

/* ------------------------------------------------------------ 1. 应用图标 */

if (!(await exists(iconDir))) {
  console.error('缺少 android-icons/，先执行：npm run icons');
  process.exit(1);
}

for (const entry of await readdir(iconDir)) {
  await cp(join(iconDir, entry), join(resDir, entry), { recursive: true, force: true });
}
// 模板自带的矢量图标已经没人引用了（我们的 anydpi-v26 用的是 @color + @mipmap），删掉免得混淆
for (const stale of ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']) {
  await rm(join(resDir, stale), { force: true });
}
console.log('图标已写入 android/app/src/main/res（含自适应图标）');

/* -------------------------------------------------------- 2. 国内 Gradle 镜像 */

const mirrors = (indent) =>
  [
    `${indent}maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }`,
    `${indent}maven { url 'https://maven.aliyun.com/repository/google' }`,
    `${indent}maven { url 'https://maven.aliyun.com/repository/public' }`,
    '',
  ].join('\n');

const gradleFile = join(androidDir, 'build.gradle');
let gradleText = await readFile(gradleFile, 'utf8');
if (gradleText.includes('maven.aliyun.com')) {
  console.log('build.gradle 里已经有国内镜像，跳过');
} else {
  // 两个 repositories 块（buildscript 与 allprojects）都在 google() 前插镜像
  gradleText = gradleText.replace(/repositories\s*\{\s*\n(\s*)google\(\)/g, (match, indent) => {
    return `repositories {\n${mirrors(indent)}${indent}google()`;
  });
  await writeFile(gradleFile, gradleText, 'utf8');
  console.log('build.gradle 已插入阿里云镜像（优先于 google() / mavenCentral()）');
}

const wrapperFile = join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
let wrapperText = await readFile(wrapperFile, 'utf8');
const version = /gradle-([\d.]+)-(?:all|bin)\.zip/.exec(wrapperText)?.[1];
if (version) {
  wrapperText = wrapperText.replace(
    /distributionUrl=.*/,
    `distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/gradle-${version}-bin.zip`,
  );
  await writeFile(wrapperFile, wrapperText, 'utf8');
  console.log(`Gradle 分发已换成腾讯镜像（gradle-${version}-bin.zip）`);
} else {
  console.log('没识别出 Gradle 版本，wrapper 保持原样');
}

console.log('\n完成。接下来：');
console.log('  1. npx cap sync android');
console.log('  2. 用 Android Studio 打开 android/ 目录，等 Gradle 同步完，Build → Build APK(s)');

/* --------------------------------------------------- 3. 固定 debug 签名钥匙 */

/**
 * 默认的 ~/.android/debug.keystore 会因为换 JDK / 换环境目录而重新生成，
 * 钥匙一变，新包就再也覆盖安装不上已装的版本（INSTALL_FAILED_UPDATE_INCOMPATIBLE），
 * 手机上只能卸载重装 = 日记和账本全丢。所以把钥匙固定在 signing/debug.keystore。
 */
const appGradleFile = join(androidDir, 'app', 'build.gradle');
const keystore = join(root, 'signing', 'debug.keystore');
if (!(await exists(keystore))) {
  console.log('没有 signing/debug.keystore，跳过签名固定');
} else {
  let appGradle = await readFile(appGradleFile, 'utf8');
  if (appGradle.includes('signingConfigs')) {
    console.log('app/build.gradle 里已经有 signingConfigs，跳过');
  } else {
    const signingLines = [
      '    signingConfigs {',
      '        // 固定用项目里这把 debug 钥匙：和手机上已安装的版本一致。',
      '        // 换了钥匙就再也覆盖安装不上，只能卸载重装（会丢数据），所以别删、别换。',
      '        debug {',
      "            storeFile file('../../signing/debug.keystore')",
      "            storePassword 'android'",
      "            keyAlias 'androiddebugkey'",
      "            keyPassword 'android'",
      '        }',
      '    }',
      '',
    ];
    appGradle = appGradle.replace('    buildTypes {\n', `${signingLines.join('\n')}    buildTypes {\n`);
    appGradle = appGradle.replace(
      '    buildTypes {\n        release {',
      '    buildTypes {\n        debug {\n            signingConfig signingConfigs.debug\n        }\n        release {',
    );
    await writeFile(appGradleFile, appGradle, 'utf8');
    console.log('app/build.gradle 已固定 debug 签名为 signing/debug.keystore');
  }
}
