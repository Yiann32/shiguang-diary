/**
 * 生成全套图标，零依赖：手写 PNG 编码 + 超采样抗锯齿。
 *   node tools/make-icons.mjs
 *
 * 产出：
 *   icons/                    网页用的（favicon / PWA / iOS）
 *   assets/                   Android Studio「Image Asset」和在线打包工具用的源图
 *   android-icons/            原生工程可直接覆盖的 res/ 目录（含自适应图标）
 * 图形定义在这里和 icons/icon.svg 保持一致，改图标时两边一起改。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* ---------------------------------------------------------------- PNG 编码 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: none
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ 图形 */

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];

// 白底 + 深灰描边的纸页：底色和纸页都是白的，靠描边把形状区分开
const BG = hex('#ffffff');
const PAGE = hex('#ffffff');
const STROKE = hex('#3f434a');
const FOLD = hex('#e4e8ef');
const BAR_STRONG = hex('#7c8494');
const BAR_SOFT = hex('#b9c0cc');
const STROKE_W = 0.009;

function inRoundedRect(x, y, x0, y0, x1, y1, radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
  const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

const BARS = [
  [0.365, 0.45, 0.635, 0.478, BAR_STRONG],
  [0.365, 0.535, 0.635, 0.563, BAR_SOFT],
  [0.365, 0.62, 0.545, 0.648, BAR_SOFT],
];

/** 把图形整体缩放：浏览器 maskable 和 Android 自适应图标都要留安全边距。 */
function glyphPoint(x, y, scale) {
  if (!scale || scale === 1) return [x, y];
  return [(x - 0.5) / scale + 0.5, (y - 0.5) / scale + 0.5];
}

/**
 * mode:
 *   any        网页普通图标（圆角方块 + 纸页）
 *   maskable   网页 maskable（铺满，图形缩小留边）
 *   background Android 自适应图标的背景层（只有渐变）
 *   foreground Android 自适应图标的前景层（透明底 + 缩小纸页）
 *   splash     启动图（大画布 + 居中图形）
 */
function sample(x, y, mode) {
  if (mode === 'background') return BG;
  if (mode === 'any' && !inRoundedRect(x, y, 0, 0, 1, 1, 0.226)) return null;

  const scale = mode === 'foreground' ? 0.55 : mode === 'maskable' ? 0.78 : mode === 'splash' ? 0.3 : 1;
  const [gx, gy] = glyphPoint(x, y, scale);
  const s = STROKE_W;
  if (inRoundedRect(gx, gy, 0.29, 0.235, 0.71, 0.765, 0.05)) {
    // 纸页外框：贴着边界的那一圈上描边色
    if (!inRoundedRect(gx, gy, 0.29 + s, 0.235 + s, 0.71 - s, 0.765 - s, 0.05 - s)) return STROKE;
    // 折角是右上角那个小三角：对角线 (0.585,0.36) → (0.71,0.235)
    const inFold = gx >= 0.585 && gy <= 0.36 && gy >= 0.945 - gx;
    const onFoldLine = gx >= 0.585 - s * 2 && Math.abs(gx + gy - 0.945) <= s * 1.4;
    if (onFoldLine) return STROKE;
    if (inFold) return FOLD;
    for (const [x0, y0, x1, y1, color] of BARS) {
      if (inRoundedRect(gx, gy, x0, y0, x1, y1, 0.014)) return color;
    }
    return PAGE;
  }

  if (mode === 'foreground') return null;
  return BG;
}

function render(size, mode) {
  const samples = size <= 512 ? 4 : 2; // 大图降低超采样，控制在几秒内
  const pixels = Buffer.alloc(size * size * 4);
  const total = samples * samples;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          const color = sample(x, y, mode);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 255;
        }
      }
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / (a / 255));
        pixels[offset + 1] = Math.round(g / (a / 255));
        pixels[offset + 2] = Math.round(b / (a / 255));
      }
      pixels[offset + 3] = Math.round(a / total);
    }
  }
  return encodePng(size, pixels);
}

function write(relativePath, size, mode) {
  const file = join(root, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  const bytes = render(size, mode);
  writeFileSync(file, bytes);
  console.log(`  ${relativePath}  ${size}×${size}  ${(bytes.length / 1024).toFixed(1)} KB`);
}

/* ------------------------------------------------------------- 网页图标 */

console.log('网页图标 icons/');
write('icons/icon-180.png', 180, 'any');
write('icons/icon-192.png', 192, 'any');
write('icons/icon-512.png', 512, 'any');
write('icons/icon-maskable-512.png', 512, 'maskable');

/* ------------------------------------------- Android 打包用源图 assets/ */

console.log('\n打包源图 assets/（Android Studio / 在线打包工具都用得上）');
write('assets/icon.png', 1024, 'any'); // 通用源图：带底 + 图形
write('assets/icon-square-1024.png', 1024, 'maskable'); // 满幅方形（交给工具自己裁圆角）
write('assets/icon-foreground.png', 1024, 'foreground'); // 自适应图标的前景层（透明底）
write('assets/icon-background.png', 1024, 'background'); // 自适应图标的背景层
write('assets/splash.png', 2732, 'splash'); // 启动图

/* ------------------------------------ 原生工程可直接覆盖的 android-icons/ */

const LEGACY = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];
const ADAPTIVE = [
  ['mdpi', 108],
  ['hdpi', 162],
  ['xhdpi', 216],
  ['xxhdpi', 324],
  ['xxxhdpi', 432],
];

console.log('\n原生工程图标 android-icons/（覆盖到 android/app/src/main/res/）');
for (const [density, size] of LEGACY) {
  write(`android-icons/mipmap-${density}/ic_launcher.png`, size, 'any');
  write(`android-icons/mipmap-${density}/ic_launcher_round.png`, size, 'any');
}
for (const [density, size] of ADAPTIVE) {
  write(`android-icons/mipmap-${density}/ic_launcher_foreground.png`, size, 'foreground');
}

const backgroundXml = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<resources>',
  '    <color name="ic_launcher_background">#FFFFFF</color>',
  '</resources>',
  '',
].join('\n');
const adaptiveXml = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <background android:drawable="@color/ic_launcher_background" />',
  '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />',
  '</adaptive-icon>',
  '',
].join('\n');

for (const name of ['values/ic_launcher_background.xml', 'mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
  const file = join(root, 'android-icons', name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, name.startsWith('values') ? backgroundXml : adaptiveXml, 'utf8');
  console.log(`  android-icons/${name}`);
}
