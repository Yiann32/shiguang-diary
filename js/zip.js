/**
 * ZIP 读写（只实现用得到的部分）：
 *  - 读：中央目录解析、stored/deflate、WinZip AES（AE-1/AE-2，Zip4j 用的就是它）
 *  - 写：把若干文件打包成一个 zip（用于「完整备份」，把图片一起带走）
 * 压缩/解压交给浏览器内置的 CompressionStream / DecompressionStream，不引第三方库。
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  const SIG_LOCAL = 0x04034b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_EOCD = 0x06054b50;
  const SIG_ZIP64_EOCD = 0x06064b50;
  const SIG_ZIP64_LOCATOR = 0x07064b50;

  class ZipError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ZipError';
      this.code = code || 'FORMAT';
    }
  }

  const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder('utf-8');

  function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new ZipError('当前浏览器不支持解压（需要 Chrome 103+ / Safari 16.4+）', 'UNSUPPORTED');
    }
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function') {
      throw new ZipError('当前浏览器不支持压缩备份', 'UNSUPPORTED');
    }
    return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  }

  function isZip(bytes) {
    if (!bytes || bytes.length < 4) return false;
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return view[0] === 0x50 && view[1] === 0x4b && (view[2] === 0x03 || view[2] === 0x05 || view[2] === 0x07);
  }

  function findEocd(view) {
    const min = Math.max(0, view.length - 66000);
    for (let i = view.length - 22; i >= min; i -= 1) {
      if (view[i] === 0x50 && view[i + 1] === 0x4b && view[i + 2] === 0x05 && view[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function readExtraFields(view, start, length) {
    const fields = new Map();
    let offset = start;
    const end = start + length;
    while (offset + 4 <= end) {
      const id = view[offset] | (view[offset + 1] << 8);
      const size = view[offset + 2] | (view[offset + 3] << 8);
      fields.set(id, view.subarray(offset + 4, offset + 4 + size));
      offset += 4 + size;
    }
    return fields;
  }

  /** 解析中央目录，返回所有条目（不解压）。 */
  function listEntries(input) {
    const view = input instanceof Uint8Array ? input : new Uint8Array(input);
    const eocd = findEocd(view);
    if (eocd < 0) throw new ZipError('不是有效的 ZIP 文件（找不到目录结尾）', 'FORMAT');

    let count = view[eocd + 10] | (view[eocd + 11] << 8);
    let cdOffset = view[eocd + 16] | (view[eocd + 17] << 8) | (view[eocd + 18] << 16) | (view[eocd + 19] << 24);

    // Zip64：条目数或偏移溢出时改读 Zip64 记录
    if (count === 0xffff || cdOffset === 0xffffffff) {
      for (let i = eocd - 20; i >= 0; i -= 1) {
        if (view[i] !== 0x50 || view[i + 1] !== 0x4b || view[i + 2] !== 0x06 || view[i + 3] !== 0x07) continue;
        const zip64Offset = Number(new DataView(view.buffer, view.byteOffset + i + 8, 8).getBigUint64(0, true));
        if (view[zip64Offset] === (SIG_ZIP64_EOCD & 0xff) && view[zip64Offset + 1] === (SIG_ZIP64_EOCD >> 8 & 0xff)) {
          const data = new DataView(view.buffer, view.byteOffset + zip64Offset + 32, 16);
          count = Number(data.getBigUint64(0, true));
          cdOffset = Number(data.getBigUint64(8, true));
        }
        break;
      }
    }

    const entries = [];
    let offset = cdOffset;
    for (let i = 0; i < count; i += 1) {
      if (offset + 46 > view.length) break;
      const signature = view[offset] | (view[offset + 1] << 8) | (view[offset + 2] << 16) | (view[offset + 3] << 24);
      if (signature !== SIG_CENTRAL) break;
      const flags = view[offset + 8] | (view[offset + 9] << 8);
      const method = view[offset + 10] | (view[offset + 11] << 8);
      const dosTime = view[offset + 12] | (view[offset + 13] << 8);
      const dosDate = view[offset + 14] | (view[offset + 15] << 8);
      const crc = (view[offset + 16] | (view[offset + 17] << 8) | (view[offset + 18] << 16) | (view[offset + 19] << 24)) >>> 0;
      const compressedSize = view[offset + 20] | (view[offset + 21] << 8) | (view[offset + 22] << 16) | (view[offset + 23] << 24);
      const uncompressedSize = view[offset + 24] | (view[offset + 25] << 8) | (view[offset + 26] << 16) | (view[offset + 27] << 24);
      const nameLength = view[offset + 28] | (view[offset + 29] << 8);
      const extraLength = view[offset + 30] | (view[offset + 31] << 8);
      const commentLength = view[offset + 32] | (view[offset + 33] << 8);
      const localOffset = view[offset + 42] | (view[offset + 43] << 8) | (view[offset + 44] << 16) | (view[offset + 45] << 24);
      const name = textDecoder.decode(view.subarray(offset + 46, offset + 46 + nameLength));
      const extra = readExtraFields(view, offset + 46 + nameLength, extraLength);
      entries.push({
        name,
        flags,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        localOffset,
        extra,
        encrypted: (flags & 0x1) === 1,
        date: dosDateToDate(dosDate, dosTime),
        isDirectory: name.endsWith('/'),
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  function dosDateToDate(dosDate, dosTime) {
    const year = 1980 + ((dosDate >> 9) & 0x7f);
    const month = ((dosDate >> 5) & 0x0f) - 1;
    const day = dosDate & 0x1f;
    const hours = (dosTime >> 11) & 0x1f;
    const minutes = (dosTime >> 5) & 0x3f;
    const seconds = (dosTime & 0x1f) * 2;
    return new Date(year, Math.max(month, 0), day || 1, hours, minutes, seconds).getTime();
  }

  function dateToDos(date) {
    const year = Math.max(1980, date.getFullYear());
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return { dosDate, dosTime };
  }

  function rawEntryData(view, entry) {
    const local = entry.localOffset;
    if (view.length < local + 30) throw new ZipError(`条目 ${entry.name} 的本地头超出范围`, 'FORMAT');
    const signature = view[local] | (view[local + 1] << 8) | (view[local + 2] << 16) | (view[local + 3] << 24);
    if (signature !== SIG_LOCAL) throw new ZipError(`条目 ${entry.name} 的本地头签名不对`, 'FORMAT');
    const nameLength = view[local + 26] | (view[local + 27] << 8);
    const extraLength = view[local + 28] | (view[local + 29] << 8);
    const start = local + 30 + nameLength + extraLength;
    let size = entry.compressedSize;
    if (!size || (entry.flags & 0x8) === 0x8) {
      // 数据描述符形式：用中央目录里的长度一般也够，兜底用剩余长度
      size = size || view.length - start - 16;
    }
    return view.subarray(start, Math.min(start + size, view.length));
  }

  /** WinZip AES 的额外信息。 */
  function aesInfo(entry) {
    const field = entry.extra && entry.extra.get(0x9901);
    if (!field || field.length < 7) return null;
    const version = field[0] | (field[1] << 8);
    const vendor = String.fromCharCode(field[2], field[3]);
    const strength = field[4];
    const realMethod = field[5] | (field[6] << 8);
    const keyLength = strength === 1 ? 16 : strength === 2 ? 24 : 32;
    return { version, vendor, strength, realMethod, keyLength, saltLength: keyLength === 16 ? 8 : keyLength === 24 ? 12 : 16 };
  }

  async function deriveAesKey(password, salt, keyLength) {
    const subtle = root.crypto && root.crypto.subtle;
    if (!subtle) throw new ZipError('当前环境不支持解密（缺少 WebCrypto）', 'UNSUPPORTED');
    const baseKey = await subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-1' },
      baseKey,
      (keyLength * 2 + 2) * 8,
    );
    return new Uint8Array(bits);
  }

  /** 判断这个 zip 是否需要密码。 */
  function needsPassword(input) {
    return listEntries(input).some((entry) => entry.encrypted || entry.method === 99);
  }

  async function readEntry(input, entry, options) {
    const config = options || {};
    const view = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (entry.isDirectory) return new Uint8Array(0);
    const raw = rawEntryData(view, entry);

    // 未加密：直接读取
    if (entry.method === 0 && !entry.encrypted) return raw.slice();
    if (entry.method === 8 && !entry.encrypted) return new Uint8Array(await inflateRaw(raw));

    if (entry.method !== 99) {
      throw new ZipError(`暂不支持的压缩方式：${entry.method}`, 'UNSUPPORTED');
    }

    const info = aesInfo(entry);
    if (!info) throw new ZipError('加密条目缺少 AES 信息', 'FORMAT');

    const password = config.password;
    if (password === undefined || password === null) throw new ZipError('这个备份需要密码', 'PASSWORD');

    const salt = raw.subarray(0, info.saltLength);
    const verify = raw.subarray(info.saltLength, info.saltLength + 2);
    const payload = raw.subarray(info.saltLength + 2, raw.length - 10);
    const derived = await deriveAesKey(password, salt, info.keyLength);

    if (derived[info.keyLength * 2] !== verify[0] || derived[info.keyLength * 2 + 1] !== verify[1]) {
      throw new ZipError('密码不对，解不开这个备份', 'PASSWORD');
    }

    const key = derived.subarray(0, info.keyLength);
    const aes = Diary.aes;
    if (!aes) throw new ZipError('AES 模块没有加载', 'UNSUPPORTED');

    const candidates = [() => aes.ctrXor(key, payload), () => aes.ctrXorBigEndian(key, payload)];
    let lastError = null;
    for (const decrypt of candidates) {
      const plain = decrypt();
      try {
        const result = info.realMethod === 8 ? new Uint8Array(await inflateRaw(plain)) : plain;
        if (info.realMethod === 0 && entry.crc && crc32(result) !== entry.crc) {
          throw new ZipError('校验不一致', 'INTEGRITY');
        }
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw new ZipError(`解密后的数据无法解析：${lastError ? lastError.message : '未知原因'}`, 'INTEGRITY');
  }

  /* ------------------------------------------------------------- 打包 */

  function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value instanceof Blob) return value.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    return textEncoder.encode(String(value));
  }

  /**
   * 把文件列表打包成 zip。
   * files: [{ name, data: Uint8Array|ArrayBuffer|Blob|string }]
   */
  async function createZip(files) {
    const now = new Date();
    const { dosDate, dosTime } = dateToDos(now);
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const data = await toBytes(file.data);
      const nameBytes = textEncoder.encode(file.name);
      const compressed = new Uint8Array(await deflateRaw(data));
      const useStored = compressed.length >= data.length;
      const payload = useStored ? data : compressed;
      const method = useStored ? 0 : 8;
      const crc = crc32(data);

      const header = new Uint8Array(30 + nameBytes.length);
      const hv = new DataView(header.buffer);
      hv.setUint32(0, SIG_LOCAL, true);
      hv.setUint16(4, 20, true);
      hv.setUint16(6, 0x0800, true); // UTF-8 文件名
      hv.setUint16(8, method, true);
      hv.setUint16(10, dosTime, true);
      hv.setUint16(12, dosDate, true);
      hv.setUint32(14, crc, true);
      hv.setUint32(18, payload.length, true);
      hv.setUint32(22, data.length, true);
      hv.setUint16(26, nameBytes.length, true);
      header.set(nameBytes, 30);

      chunks.push(header, payload);

      const record = new Uint8Array(46 + nameBytes.length);
      const rv = new DataView(record.buffer);
      rv.setUint32(0, SIG_CENTRAL, true);
      rv.setUint16(4, 20, true);
      rv.setUint16(6, 20, true);
      rv.setUint16(8, 0x0800, true);
      rv.setUint16(10, method, true);
      rv.setUint16(12, dosTime, true);
      rv.setUint16(14, dosDate, true);
      rv.setUint32(16, crc, true);
      rv.setUint32(20, payload.length, true);
      rv.setUint32(24, data.length, true);
      rv.setUint16(28, nameBytes.length, true);
      rv.setUint32(42, offset, true);
      record.set(nameBytes, 46);
      central.push(record);

      offset += header.length + payload.length;
    }

    const centralSize = central.reduce((sum, item) => sum + item.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, SIG_EOCD, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total = offset + centralSize + end.length;
    const output = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) {
      output.set(chunk, cursor);
      cursor += chunk.length;
    }
    for (const record of central) {
      output.set(record, cursor);
      cursor += record.length;
    }
    output.set(end, cursor);
    return output;
  }

  Diary.zip = {
    ZipError,
    createZip,
    crc32,
    deflateRaw,
    inflateRaw,
    isZip,
    listEntries,
    needsPassword,
    readEntry,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
