/**
 * 极简 QR 编码器（只用内置能力，不依赖任何第三方库）。
 *
 * 支持范围刚好够下载页用：字节模式、版本 1–6（21×21 ~ 41×41）、纠错等级 M、
 * 8 种掩码按标准罚分选优。版本 < 7 不需要写版本信息，实现因此短很多。
 *
 *   node tools/make-qr.mjs "https://example.com/a.apk" [out.svg]
 *
 * 生成前会自检：把矩阵按标准反解回来，必须和原文本逐字节一致。
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ------------------------------------------------------------ 编码表 */

// 版本 → { 数据码字, 每块纠错码字, 分块数 }（纠错等级 M；1–3 单块，4–5 两块，6 四块）
const VERSIONS = {
  1: { data: 16, ec: 10, blocks: 1 },
  2: { data: 28, ec: 16, blocks: 1 },
  3: { data: 44, ec: 26, blocks: 1 },
  4: { data: 64, ec: 18, blocks: 2 },
  5: { data: 86, ec: 24, blocks: 2 },
  6: { data: 108, ec: 16, blocks: 4 },
};

const EC_LEVEL_M = 0b00;

// 版本 2–6 的码字后面还有 7 个「余数位」（恒为 0，再参与掩码），版本 1 没有
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 };

/* ------------------------------------------------------- GF(256) 运算 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** 纠错用的生成多项式（最高次在前） */
function rsGenerator(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    const factor = EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

/** 取 data 的 RS 余数（即纠错码字） */
function rsRemainder(data, degree) {
  const gen = rsGenerator(degree);
  const work = new Uint8Array(data.length + degree);
  work.set(data, 0);
  for (let i = 0; i < data.length; i += 1) {
    const factor = work[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j += 1) work[i + j] ^= mul(gen[j], factor);
  }
  return work.slice(data.length);
}

/* ---------------------------------------------------------- 数据编码 */

function pickVersion(byteLength) {
  for (let version = 1; version <= 6; version += 1) {
    const capacity = VERSIONS[version].data * 8;
    if (4 + 8 + byteLength * 8 <= capacity) return version;
  }
  throw new Error(`内容太长（${byteLength} 字节），放不进版本 1–6`);
}

function buildCodewords(bytes, version) {
  const info = VERSIONS[version];
  const bits = [];
  const put = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  put(0b0100, 4); // 字节模式
  put(bytes.length, 8); // 版本 1–9 用 8 位长度
  for (const byte of bytes) put(byte, 8);

  const capacityBits = info.data * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0); // 结束符
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  // 交替填充 0xEC / 0x11
  for (let i = 0; data.length < info.data; i += 1) data.push(i % 2 === 0 ? 0xec : 0x11);

  // 分块 → 每块算纠错 → 交织
  const perBlock = info.data / info.blocks;
  const blocks = [];
  for (let b = 0; b < info.blocks; b += 1) {
    const chunk = Uint8Array.from(data.slice(b * perBlock, (b + 1) * perBlock));
    blocks.push({ data: chunk, ec: rsRemainder(chunk, info.ec) });
  }
  const out = [];
  for (let i = 0; i < perBlock; i += 1) for (const block of blocks) out.push(block.data[i]);
  for (let i = 0; i < info.ec; i += 1) for (const block of blocks) out.push(block.ec[i]);
  return Uint8Array.from(out);
}

/* ---------------------------------------------------------- 矩阵构建 */

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(0));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (x, y, dark) => {
    modules[y][x] = dark ? 1 : 0;
    isFunction[y][x] = true;
  };

  // 定时图案：必须先画，后面画定位图案时会把穿过它的那几格覆盖回来
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // 定位图案（含分隔符）
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // 校正图案：版本 2–6 只有一个，中心在 (size-7, size-7)
  if (version >= 2) {
    const cx = size - 7;
    const cy = size - 7;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, dist !== 1);
      }
    }
  }

  // 预留格式信息区（先占位，稍后写入真实值）
  for (let i = 0; i <= 8; i += 1) {
    if (!isFunction[8][i]) set(i, 8, false);
    if (!isFunction[i][8]) set(8, i, false);
  }
  for (let i = 0; i < 8; i += 1) {
    if (!isFunction[8][size - 1 - i]) set(size - 1 - i, 8, false);
    if (!isFunction[size - 1 - i][8]) set(8, size - 1 - i, false);
  }
  set(8, size - 8, true); // 固定黑模块

  return { size, modules, isFunction, set };
}

function drawData(modules, isFunction, codewords) {
  const size = modules.length;
  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((byte >>> i) & 1);

  let index = 0;
  let upward = true;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1; // 跳过竖直定时图案
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (const x of [column, column - 1]) {
        if (isFunction[row][x]) continue;
        modules[row][x] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    upward = !upward;
  }
  return index;
}

const MASK_RULES = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

function applyMask(modules, isFunction, maskIndex) {
  const size = modules.length;
  const rule = MASK_RULES[maskIndex];
  const next = modules.map((row) => row.slice());
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isFunction[y][x]) continue;
      if (rule(y, x)) next[y][x] ^= 1;
    }
  }
  return next;
}

function formatBits(maskIndex) {
  const data = (EC_LEVEL_M << 3) | maskIndex;
  let remainder = data << 10;
  const generator = 0b10100110111;
  while (Math.floor(Math.log2(remainder)) >= 10) remainder ^= generator << (Math.floor(Math.log2(remainder)) - 10);
  return ((data << 10) | remainder) ^ 0b101010000010010;
}

function drawFormat(modules, maskIndex) {
  const size = modules.length;
  const bits = formatBits(maskIndex);
  const bit = (index) => (bits >>> index) & 1;

  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = 1;
}

/* ------------------------------------------------------------ 罚分 */

function penalty(matrix) {
  const size = matrix.length;
  let score = 0;
  const at = (x, y) => matrix[y][x];

  // 规则 1：同行/同列连续 5 个以上同色
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (x === 0 || at(x, y) !== at(x - 1, y)) {
        let run = 1;
        while (x + run < size && at(x + run, y) === at(x, y)) run += 1;
        if (run >= 5) score += 3 + (run - 5);
      }
      if (y === 0 || at(x, y) !== at(x, y - 1)) {
        let run = 1;
        while (y + run < size && at(x, y + run) === at(x, y)) run += 1;
        if (run >= 5) score += 3 + (run - 5);
      }
    }
  }

  // 规则 2：2×2 同色块
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const value = at(x, y);
      if (value === at(x + 1, y) && value === at(x, y + 1) && value === at(x + 1, y + 1)) score += 3;
    }
  }

  // 规则 3：类似定位图案的 1:1:3:1:1（两侧各 4 个同色）
  const pattern = [1, 0, 1, 1, 1, 0, 1];
  const hasPattern = (line, start) => {
    for (let i = 0; i < pattern.length; i += 1) if (line[start + i] !== pattern[i]) return false;
    const before = start >= 4 && line.slice(start - 4, start).every((value) => value === 0);
    const after = start + 11 <= line.length && line.slice(start + 7, start + 11).every((value) => value === 0);
    return before || after;
  };
  for (let y = 0; y < size; y += 1) {
    const row = matrix[y];
    for (let x = 0; x + 7 <= size; x += 1) if (hasPattern(row, x)) score += 40;
  }
  for (let x = 0; x < size; x += 1) {
    const column = matrix.map((row) => row[x]);
    for (let y = 0; y + 7 <= size; y += 1) if (hasPattern(column, y)) score += 40;
  }

  // 规则 4：黑块比例偏离 50%
  let dark = 0;
  for (const row of matrix) for (const value of row) dark += value;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/* ------------------------------------------------------------ 对外接口 */

export function encodeQr(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);
  const base = createMatrix(version);
  drawData(base.modules, base.isFunction, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    // 带正确格式信息的完整矩阵参与罚分（格式位本身也是图案的一部分）
    const finished = applyMask(base.modules, base.isFunction, mask);
    drawFormat(finished, mask);
    const score = penalty(finished);
    if (!best || score < best.score) best = { mask, matrix: finished, score };
  }
  return { size: base.size, version, mask: best.mask, modules: best.matrix };
}

/** 把矩阵画成紧凑的 SVG（一个 path 装下所有黑块） */
export function qrToSvg(qr, options) {
  const config = options || {};
  const quiet = config.quiet === undefined ? 4 : config.quiet;
  const total = qr.size + quiet * 2;
  const commands = [];
  for (let y = 0; y < qr.size; y += 1) {
    for (let x = 0; x < qr.size; x += 1) {
      if (!qr.modules[y][x]) continue;
      commands.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  const size = config.size || 168;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" role="img" aria-label="${config.label || '二维码'}">`,
    `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
    `<path d="${commands.join('')}" fill="#000000"/>`,
    '</svg>',
  ].join('');
}

/** 自检：把矩阵按标准反解回字节串，必须和原文一致 */
export function selfCheck(text, qr) {
  const size = qr.size;
  // 格式信息位对照标准表（纠错等级 M 的 8 种掩码），用来独立验证放置位置
  const EXPECTED_FORMAT = [
    0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
    0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
  ];
  const readCopy1 = () => {
    const bits = [];
    for (let i = 0; i <= 5; i += 1) bits.push(qr.modules[i][8]);
    bits.push(qr.modules[7][8], qr.modules[8][8], qr.modules[8][7]);
    for (let i = 9; i < 15; i += 1) bits.push(qr.modules[8][14 - i]);
    let value = 0;
    for (let i = 0; i < 15; i += 1) value |= bits[i] << i;
    return value;
  };
  const readCopy2 = () => {
    const bits = [];
    for (let i = 0; i < 8; i += 1) bits.push(qr.modules[8][size - 1 - i]);
    for (let i = 8; i < 15; i += 1) bits.push(qr.modules[size - 15 + i][8]);
    let value = 0;
    for (let i = 0; i < 15; i += 1) value |= bits[i] << i;
    return value;
  };

  const raw1 = readCopy1();
  const raw2 = readCopy2();
  if (raw1 !== raw2) return { ok: false, reason: '两份格式信息的位不一致' };
  if (raw1 !== EXPECTED_FORMAT[qr.mask]) return { ok: false, reason: '格式信息位和标准表不一致' };
  if (formatBits(qr.mask) !== raw1) return { ok: false, reason: '格式信息位和计算结果不一致' };
  const unmasked = raw1 ^ 0b101010000010010;
  const format = { ecLevel: (unmasked >> 13) & 0b11, mask: (unmasked >> 10) & 0b111 };
  if (format.ecLevel !== EC_LEVEL_M) return { ok: false, reason: '格式信息里的纠错等级不对' };
  if (format.mask !== qr.mask) return { ok: false, reason: '格式信息里的掩码和实际不一致' };

  // 定位图案检查
  const finderAt = (ox, oy) => {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const dist = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        const expected = dist !== 2 ? 1 : 0;
        if (qr.modules[oy + y][ox + x] !== expected) return false;
      }
    }
    return true;
  };
  if (!finderAt(0, 0) || !finderAt(size - 7, 0) || !finderAt(0, size - 7)) {
    return { ok: false, reason: '定位图案不完整' };
  }

  // 分隔符：三个定位图案外围那一圈必须是浅色
  for (let i = 0; i < 8; i += 1) {
    if (qr.modules[7][i] || qr.modules[i][7]) return { ok: false, reason: '定位图案分隔符不是浅色' };
    if (qr.modules[7][size - 1 - i] || qr.modules[i][size - 8]) return { ok: false, reason: '定位图案分隔符不是浅色' };
    if (qr.modules[size - 8][i] || qr.modules[size - 1 - i][7]) return { ok: false, reason: '定位图案分隔符不是浅色' };
  }

  // 定时图案：第 6 行 / 第 6 列黑白交替
  for (let i = 8; i < size - 8; i += 1) {
    const expected = i % 2 === 0 ? 1 : 0;
    if (qr.modules[6][i] !== expected) return { ok: false, reason: '横向定时图案不对' };
    if (qr.modules[i][6] !== expected) return { ok: false, reason: '纵向定时图案不对' };
  }

  // 校正图案：版本 ≥ 2 右下角一个，外圈深、内圈浅、中心深
  if (qr.version >= 2) {
    const cx = size - 7;
    const cy = size - 7;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const expected = dist === 2 || dist === 0 ? 1 : 0;
        if (qr.modules[cy + dy][cx + dx] !== expected) return { ok: false, reason: '校正图案不对' };
      }
    }
  }

  // 去掩码 → 按 zigzag 读回码字
  const rule = MASK_RULES[format.mask];
  const functionMask = buildFunctionMask(size, qr.version);
  const bits = [];
  let upward = true;
  for (let column = size - 1; column > 0; column -= 2) {
    if (column === 6) column -= 1;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (const x of [column, column - 1]) {
        if (functionMask[row][x]) continue;
        const value = qr.modules[row][x] ^ (rule(row, x) ? 1 : 0);
        bits.push(value);
      }
    }
    upward = !upward;
  }

  const info = VERSIONS[qr.version];
  const totalCodewords = info.data + info.ec * info.blocks;
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length && codewords.length < totalCodewords; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  // 反交织 → 取回数据码字
  const perBlock = info.data / info.blocks;
  const dataBlocks = Array.from({ length: info.blocks }, () => []);
  for (let i = 0; i < perBlock; i += 1) {
    for (let b = 0; b < info.blocks; b += 1) dataBlocks[b].push(codewords[i * info.blocks + b]);
  }
  const data = dataBlocks.flat();

  // 解析字节模式
  const readBits = [];
  for (const byte of data) for (let i = 7; i >= 0; i -= 1) readBits.push((byte >>> i) & 1);
  const take = (count, offset) => {
    let value = 0;
    for (let i = 0; i < count; i += 1) value = (value << 1) | readBits[offset + i];
    return value;
  };
  const mode = take(4, 0);
  if (mode !== 0b0100) return { ok: false, reason: '模式不是字节模式' };
  const length = take(8, 4);
  const bytes = [];
  for (let i = 0; i < length; i += 1) bytes.push(take(8, 12 + i * 8));
  const decoded = new TextDecoder().decode(Uint8Array.from(bytes));
  if (decoded !== String(text)) return { ok: false, reason: `解出来是「${decoded}」` };

  // 数据模块总数必须正好等于「总码字数 × 8 + 余数位」，否则说明功能图案或布局有偏差
  const mask2 = buildFunctionMask(size, qr.version);
  let dataModules = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!mask2[y][x]) dataModules += 1;
  const info2 = VERSIONS[qr.version];
  const expectedModules = (info2.data + info2.ec * info2.blocks) * 8 + REMAINDER_BITS[qr.version];
  if (dataModules !== expectedModules) {
    return { ok: false, reason: `数据模块数 ${dataModules} ≠ 标准值 ${expectedModules}` };
  }

  return { ok: true, version: qr.version, mask: qr.mask, dataModules };
}

function buildFunctionMask(size, version) {
  const square = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && y >= 0 && x < size && y < size) square[y][x] = true;
  };
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) for (let dx = -4; dx <= 4; dx += 1) mark(cx + dx, cy + dy);
  }
  if (version >= 2) {
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) mark(size - 7 + dx, size - 7 + dy);
  }
  for (let i = 0; i < size; i += 1) {
    mark(6, i);
    mark(i, 6);
  }
  for (let i = 0; i <= 8; i += 1) {
    mark(i, 8);
    mark(8, i);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  mark(8, size - 8);
  return square;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const text = process.argv[2] || 'https://yiann32.github.io/shiguang-diary/shiguang-diary.apk';
  const qr = encodeQr(text);
  const check = selfCheck(text, qr);
  console.log(`内容：${text}`);
  console.log(`版本 ${qr.version}（${qr.size}×${qr.size}），掩码 ${qr.mask}，自检：${check.ok ? '通过' : `失败（${check.reason}）`}`);
  const svg = qrToSvg(qr, { label: '下载二维码' });
  if (process.argv[3]) {
    writeFileSync(process.argv[3], svg, 'utf8');
    console.log(`已写出 ${process.argv[3]}`);
  } else {
    console.log(svg.slice(0, 120) + '…');
  }
  process.exit(check.ok ? 0 : 1);
}
