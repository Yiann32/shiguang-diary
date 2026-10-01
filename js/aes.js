/**
 * 极简 AES（只做加密方向），用于解开 .mbk 里的 WinZip AES 加密条目。
 *
 * 为什么自己写：WebCrypto 的 AES-CTR 只按大端递增计数器，而 WinZip AES / Zip4j /
 * 7-Zip 用的是小端计数器（counter[0] 先加），也没有 ECB 可以自己搭 CTR。
 * 这里只需要 128 位块加密，代码量很小，而且可以用标准测试向量验证。
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  /* ------------------------------------------------------------ S 盒生成 */

  const expTable = new Uint8Array(256);
  const logTable = new Uint8Array(256);
  (function buildTables() {
    let value = 1;
    for (let i = 0; i < 255; i += 1) {
      expTable[i] = value;
      logTable[value] = i;
      // 乘 3（= x + 1）
      value ^= (value << 1) ^ (value & 0x80 ? 0x11b : 0);
      value &= 0xff;
    }
    expTable[255] = expTable[0];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return expTable[(logTable[a] + logTable[b]) % 255];
  }

  function ginv(a) {
    return a === 0 ? 0 : expTable[(255 - logTable[a]) % 255];
  }

  const SBOX = new Uint8Array(256);
  (function buildSbox() {
    for (let i = 0; i < 256; i += 1) {
      const inverse = ginv(i);
      let x = inverse;
      let result = inverse;
      for (let bit = 0; bit < 4; bit += 1) {
        x = ((x << 1) | (x >>> 7)) & 0xff;
        result ^= x;
      }
      SBOX[i] = result ^ 0x63;
    }
  })();

  const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d];

  const xtime = (a) => ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff;

  /* ---------------------------------------------------------- 密钥扩展 */

  function expandKey(key) {
    const nk = key.length / 4; // 4 / 6 / 8
    const rounds = nk + 6;
    const totalWords = 4 * (rounds + 1);
    const words = [];
    for (let i = 0; i < nk; i += 1) {
      words.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    }
    for (let i = nk; i < totalWords; i += 1) {
      let temp = words[i - 1].slice();
      if (i % nk === 0) {
        temp = [temp[1], temp[2], temp[3], temp[0]].map((byte) => SBOX[byte]);
        temp[0] ^= RCON[i / nk - 1];
      } else if (nk > 6 && i % nk === 4) {
        temp = temp.map((byte) => SBOX[byte]);
      }
      const prev = words[i - nk];
      words.push([prev[0] ^ temp[0], prev[1] ^ temp[1], prev[2] ^ temp[2], prev[3] ^ temp[3]]);
    }
    return { words, rounds };
  }

  /* -------------------------------------------------------------- 加密块 */

  /** 加密一个 16 字节块，返回新的 Uint8Array。 */
  function encryptBlock(schedule, input) {
    const state = new Uint8Array(16);
    for (let i = 0; i < 16; i += 1) state[i] = input[i] ^ schedule.words[i >> 2][i & 3];

    for (let round = 1; round <= schedule.rounds; round += 1) {
      // SubBytes
      for (let i = 0; i < 16; i += 1) state[i] = SBOX[state[i]];

      // ShiftRows（state[r + 4c]，第 r 行左移 r 格）
      let temp = state[1];
      state[1] = state[5];
      state[5] = state[9];
      state[9] = state[13];
      state[13] = temp;

      temp = state[2];
      state[2] = state[10];
      state[10] = temp;
      temp = state[6];
      state[6] = state[14];
      state[14] = temp;

      temp = state[15];
      state[15] = state[11];
      state[11] = state[7];
      state[7] = state[3];
      state[3] = temp;

      // MixColumns（最后一轮不做）
      if (round !== schedule.rounds) {
        for (let c = 0; c < 16; c += 4) {
          const a0 = state[c];
          const a1 = state[c + 1];
          const a2 = state[c + 2];
          const a3 = state[c + 3];
          const t = a0 ^ a1 ^ a2 ^ a3;
          state[c] = a0 ^ t ^ xtime(a0 ^ a1);
          state[c + 1] = a1 ^ t ^ xtime(a1 ^ a2);
          state[c + 2] = a2 ^ t ^ xtime(a2 ^ a3);
          state[c + 3] = a3 ^ t ^ xtime(a3 ^ a0);
        }
      }

      // AddRoundKey
      for (let i = 0; i < 16; i += 1) state[i] ^= schedule.words[round * 4 + (i >> 2)][i & 3];
    }

    return state;
  }

  /**
   * WinZip AES 的 CTR：计数器从 1 开始，按小端逐块递增。
   * 加解密同一套操作（异或密钥流）。
   */
  function ctrXor(key, data) {
    const schedule = expandKey(key);
    const counter = new Uint8Array(16);
    counter[0] = 1;
    const out = new Uint8Array(data.length);
    for (let offset = 0; offset < data.length; offset += 16) {
      const keystream = encryptBlock(schedule, counter);
      const limit = Math.min(16, data.length - offset);
      for (let i = 0; i < limit; i += 1) out[offset + i] = data[offset + i] ^ keystream[i];
      for (let i = 0; i < 16; i += 1) {
        counter[i] = (counter[i] + 1) & 0xff;
        if (counter[i] !== 0) break;
      }
    }
    return out;
  }

  /** 大端计数器版本，万一遇到别的实现可以用它兜底。 */
  function ctrXorBigEndian(key, data) {
    const schedule = expandKey(key);
    const counter = new Uint8Array(16);
    counter[15] = 1;
    const out = new Uint8Array(data.length);
    for (let offset = 0; offset < data.length; offset += 16) {
      const keystream = encryptBlock(schedule, counter);
      const limit = Math.min(16, data.length - offset);
      for (let i = 0; i < limit; i += 1) out[offset + i] = data[offset + i] ^ keystream[i];
      for (let i = 15; i >= 0; i -= 1) {
        counter[i] = (counter[i] + 1) & 0xff;
        if (counter[i] !== 0) break;
      }
    }
    return out;
  }

  Diary.aes = { ctrXor, ctrXorBigEndian, encryptBlock, expandKey, gmul, SBOX };
})(typeof globalThis !== 'undefined' ? globalThis : this);
