/**
 * 在单个进程里跑完所有测试，不需要再 fork 子进程
 * （有些受限环境 / CI 沙箱不允许 spawn，用 node --test 也能跑，但这里更稳）。
 */

import './../tests/model.test.mjs';
import './../tests/store.test.mjs';
import './../tests/zip.test.mjs';
import './../tests/ledger.test.mjs';
