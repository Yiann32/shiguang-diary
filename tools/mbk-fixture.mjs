/**
 * 造测试用的 ZIP / .mbk 备份（含 WinZip AES 加密条目），
 * 单元测试和浏览器冒烟测试共用，避免两处各写一份。
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

import { loadSource } from './load-source.mjs';

const { aes, zip } = loadSource('js/aes.js', 'js/zip.js');

/** 手工拼一个 ZIP（支持 method 0/8/99 与自定义 extra 字段）。 */
export function assembleZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const extra = entry.extra || Buffer.alloc(0);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags || 0, 6);
    header.writeUInt16LE(entry.method, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0x2821, 12);
    header.writeUInt32LE(entry.crc >>> 0, 14);
    header.writeUInt32LE(entry.payload.length, 18);
    header.writeUInt32LE(entry.uncompressedSize, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(extra.length, 28);
    chunks.push(header, nameBytes, extra, entry.payload);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(entry.flags || 0, 8);
    record.writeUInt16LE(entry.method, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(0x2821, 14);
    record.writeUInt32LE(entry.crc >>> 0, 16);
    record.writeUInt32LE(entry.payload.length, 20);
    record.writeUInt32LE(entry.uncompressedSize, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt16LE(extra.length, 30);
    record.writeUInt32LE(0, 36);
    record.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([record, nameBytes, extra]));
    offset += header.length + nameBytes.length + extra.length + entry.payload.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

export function plainEntry(name, content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return {
    name,
    method: 8,
    crc: zip.crc32(new Uint8Array(data)),
    payload: deflateRawSync(data),
    uncompressedSize: data.length,
  };
}

/** WinZip AES-256（Zip4j 用的方案）：salt + 2 字节校验 + 密文 + 10 字节校验码。 */
export function aesEntry(name, content, password) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, 1000, 66, 'sha1');
  const deflated = deflateRawSync(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  const cipher = Buffer.from(aes.ctrXor(new Uint8Array(derived.subarray(0, 32)), new Uint8Array(deflated)));
  return {
    name,
    method: 99,
    flags: 0x0801,
    crc: 0,
    uncompressedSize: deflated.length,
    payload: Buffer.concat([salt, derived.subarray(64, 66), cipher, Buffer.alloc(10)]),
    extra: Buffer.from('0199070002004145030800', 'hex'),
  };
}

/** 一个最小可用的 .mbk：2 篇加密日记，其中一篇带 1 张图片。口令默认用拾光日记的默认口令。 */
export function buildDemoMbk(password = 'timenotes') {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7]);
  return new Uint8Array(
    assembleZip([
      aesEntry('LockTimeDiaryData/aaa/DiaryContent', JSON.stringify({ content: '第一天的加密日记', date: '2026-08-01 20:00:00' }), password),
      aesEntry('LockTimeDiaryData/aaa/Pic_0', png, password),
      aesEntry('LockTimeDiaryData/bbb/DiaryContent', JSON.stringify({ content: '第二天的加密日记', date: '2026-08-02 09:30:00' }), password),
    ]),
  );
}
