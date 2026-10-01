/**
 * 存储适配层：优先 IndexedDB，退化为 localStorage，最后退化为内存。
 * 三者接口一致（含图片、记账、待办），所以 store.js 不关心底层是什么。
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  const DB_NAME = 'diary-db';
  const DB_VERSION = 5;
  const ENTRY_STORE = 'entries';
  const MEDIA_STORE = 'media';
  const TODO_STORE = 'todos';
  const TODO_GROUP_STORE = 'todoGroups';
  const BOOK_STORE = 'books';
  const LEDGER_STORE = 'ledger';
  const CATEGORY_STORE = 'categories';
  const ACCOUNT_STORE = 'accounts';
  const BUDGET_STORE = 'budgets';
  const RECURRING_STORE = 'recurring';

  const LS_KEYS = {
    entries: 'diary:entries',
    media: 'diary:media',
    todos: 'diary:todos',
    todoGroups: 'diary:todoGroups',
    books: 'diary:books',
    ledger: 'diary:ledger',
    categories: 'diary:categories',
    accounts: 'diary:accounts',
    budgets: 'diary:budgets',
    recurring: 'diary:recurring',
  };

  /** 除条目、图片外，其余都是「一个 id 一条记录」的简单表 */
  const SIMPLE_STORES = [
    ['todos', TODO_STORE],
    ['todoGroups', TODO_GROUP_STORE],
    ['books', BOOK_STORE],
    ['ledger', LEDGER_STORE],
    ['categories', CATEGORY_STORE],
    ['accounts', ACCOUNT_STORE],
    ['budgets', BUDGET_STORE],
    ['recurring', RECURRING_STORE],
  ];

  const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
    });
  }

  function createIndexedDBAdapter() {
    let dbPromise = null;

    const open = () => {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(ENTRY_STORE)) {
            const store = db.createObjectStore(ENTRY_STORE, { keyPath: 'id' });
            store.createIndex('date', 'date', { unique: false });
          }
          if (!db.objectStoreNames.contains(MEDIA_STORE)) {
            db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
          }
          // v4 那版记账按「收入 / 尾款」两分类存，v5 换成完整记账模型，直接重建（旧数据不要）
          if (db.objectStoreNames.contains(LEDGER_STORE)) db.deleteObjectStore(LEDGER_STORE);
          // 待办从 v4 起就有，v5 只是多了几个字段，结构（按 id）不变，原地保留
          for (const [, name] of SIMPLE_STORES) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('无法打开 IndexedDB'));
        request.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用'));
      });
      return dbPromise;
    };

    const run = (storeName, mode, work) =>
      open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, mode);
            Promise.resolve(work(transaction.objectStore(storeName))).then(
              (value) => {
                transaction.oncomplete = () => resolve(value);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error || new Error('事务被中止'));
              },
              (error) => {
                try {
                  transaction.abort();
                } catch (ignored) {
                  /* 忽略重复 abort */
                }
                reject(error);
              },
            );
          }),
      );

    const simpleApi = (storeName) => ({
      getAll: () => run(storeName, 'readonly', (store) => requestToPromise(store.getAll())),
      put: (record) =>
        run(storeName, 'readwrite', (store) => requestToPromise(store.put(record))).then(() => undefined),
      putMany: (records) =>
        run(storeName, 'readwrite', (store) => {
          for (const record of records) store.put(record);
        }).then(() => undefined),
      remove: (id) =>
        run(storeName, 'readwrite', (store) => requestToPromise(store.delete(id))).then(() => undefined),
      clear: () => run(storeName, 'readwrite', (store) => requestToPromise(store.clear())).then(() => undefined),
    });

    const adapter = {
      kind: 'indexeddb',
      getAll: () => run(ENTRY_STORE, 'readonly', (store) => requestToPromise(store.getAll())),
      put: (entry) =>
        run(ENTRY_STORE, 'readwrite', (store) => requestToPromise(store.put(entry))).then(() => undefined),
      putMany: (entries) =>
        run(ENTRY_STORE, 'readwrite', (store) => {
          for (const entry of entries) store.put(entry);
        }).then(() => undefined),
      remove: (id) =>
        run(ENTRY_STORE, 'readwrite', (store) => requestToPromise(store.delete(id))).then(() => undefined),
      clear: () => run(ENTRY_STORE, 'readwrite', (store) => requestToPromise(store.clear())).then(() => undefined),
      getMedia: (id) =>
        run(MEDIA_STORE, 'readonly', (store) => requestToPromise(store.get(id))).then((record) =>
          record ? record.blob : null,
        ),
      putMedia: (id, blob) =>
        run(MEDIA_STORE, 'readwrite', (store) => requestToPromise(store.put({ id, blob }))).then(() => undefined),
      removeMedia: (ids) =>
        run(MEDIA_STORE, 'readwrite', (store) => {
          for (const id of ids) store.delete(id);
        }).then(() => undefined),
      clearMedia: () => run(MEDIA_STORE, 'readwrite', (store) => requestToPromise(store.clear())).then(() => undefined),
      mediaKeys: () => run(MEDIA_STORE, 'readonly', (store) => requestToPromise(store.getAllKeys())),
    };

    for (const [key, name] of SIMPLE_STORES) {
      const api = simpleApi(name);
      adapter[`getAll${capitalize(key)}`] = api.getAll;
      adapter[`put${capitalize(key)}`] = api.put;
      adapter[`putMany${capitalize(key)}`] = api.putMany;
      adapter[`remove${capitalize(key)}`] = api.remove;
      adapter[`clear${capitalize(key)}`] = api.clear;
    }
    return adapter;
  }

  /* ----------------------------------------------- 降级方案：localStorage */

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : fallback;
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      /* 容量满了就悄悄放弃 */
    }
  }

  async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function dataUrlToBlob(dataUrl) {
    const response = await fetch(dataUrl);
    return response.blob();
  }

  function createLocalStorageAdapter() {
    const adapter = {
      kind: 'localstorage',
      async getAll() {
        const entries = readJson(LS_KEYS.entries, []);
        return Array.isArray(entries) ? entries : [];
      },
      async put(entry) {
        const entries = (await this.getAll()).filter((item) => item.id !== entry.id);
        entries.push(entry);
        writeJson(LS_KEYS.entries, entries);
      },
      async putMany(list) {
        const ids = new Set(list.map((item) => item.id));
        const entries = (await this.getAll()).filter((item) => !ids.has(item.id));
        writeJson(LS_KEYS.entries, [...entries, ...list]);
      },
      async remove(id) {
        const entries = (await this.getAll()).filter((item) => item.id !== id);
        writeJson(LS_KEYS.entries, entries);
      },
      async clear() {
        writeJson(LS_KEYS.entries, []);
        writeJson(LS_KEYS.media, {});
      },
      async getMedia(id) {
        const map = readJson(LS_KEYS.media, {});
        const dataUrl = map[id];
        return dataUrl ? dataUrlToBlob(dataUrl) : null;
      },
      async putMedia(id, blob) {
        const map = readJson(LS_KEYS.media, {});
        map[id] = await blobToDataUrl(blob);
        writeJson(LS_KEYS.media, map);
      },
      async removeMedia(ids) {
        const map = readJson(LS_KEYS.media, {});
        for (const id of ids) delete map[id];
        writeJson(LS_KEYS.media, map);
      },
      async clearMedia() {
        writeJson(LS_KEYS.media, {});
      },
      async mediaKeys() {
        return Object.keys(readJson(LS_KEYS.media, {}));
      },
    };

    for (const [key] of SIMPLE_STORES) {
      const lsKey = LS_KEYS[key];
      const getAll = async () => {
        const list = readJson(lsKey, []);
        return Array.isArray(list) ? list : [];
      };
      adapter[`getAll${capitalize(key)}`] = getAll;
      adapter[`put${capitalize(key)}`] = async (record) => {
        const list = (await getAll()).filter((item) => item.id !== record.id);
        list.push(record);
        writeJson(lsKey, list);
      };
      adapter[`putMany${capitalize(key)}`] = async (records) => {
        const ids = new Set(records.map((item) => item.id));
        const list = (await getAll()).filter((item) => !ids.has(item.id));
        writeJson(lsKey, [...list, ...records]);
      };
      adapter[`remove${capitalize(key)}`] = async (id) => {
        const list = (await getAll()).filter((item) => item.id !== id);
        writeJson(lsKey, list);
      };
      adapter[`clear${capitalize(key)}`] = async () => {
        writeJson(lsKey, []);
      };
    }
    return adapter;
  }

  /* --------------------------------------------------- 兜底：内存（临时） */

  function createMemoryAdapter(seed = []) {
    const tables = new Map();
    for (const [key] of SIMPLE_STORES) tables.set(key, new Map());
    const entries = new Map(seed.map((entry) => [entry.id, { ...entry }]));
    const media = new Map();

    const adapter = {
      kind: 'memory',
      async getAll() {
        return [...entries.values()].map((entry) => ({ ...entry }));
      },
      async put(entry) {
        entries.set(entry.id, { ...entry });
      },
      async putMany(list) {
        for (const entry of list) entries.set(entry.id, { ...entry });
      },
      async remove(id) {
        entries.delete(id);
      },
      async clear() {
        entries.clear();
        media.clear();
      },
      async getMedia(id) {
        return media.get(id) || null;
      },
      async putMedia(id, blob) {
        media.set(id, blob);
      },
      async removeMedia(ids) {
        for (const id of ids) media.delete(id);
      },
      async clearMedia() {
        media.clear();
      },
      async mediaKeys() {
        return [...media.keys()];
      },
    };

    for (const [key] of SIMPLE_STORES) {
      const table = tables.get(key);
      adapter[`getAll${capitalize(key)}`] = async () => [...table.values()].map((item) => ({ ...item }));
      adapter[`put${capitalize(key)}`] = async (record) => {
        table.set(record.id, { ...record });
      };
      adapter[`putMany${capitalize(key)}`] = async (records) => {
        for (const record of records) table.set(record.id, { ...record });
      };
      adapter[`remove${capitalize(key)}`] = async (id) => {
        table.delete(id);
      };
      adapter[`clear${capitalize(key)}`] = async () => {
        table.clear();
      };
    }
    return adapter;
  }

  function localStorageUsable() {
    try {
      localStorage.setItem('diary:probe', '1');
      localStorage.removeItem('diary:probe');
      return true;
    } catch (error) {
      return false;
    }
  }

  function createStorage() {
    if (typeof indexedDB !== 'undefined' && indexedDB) {
      try {
        return createIndexedDBAdapter();
      } catch (ignored) {
        /* 继续尝试下一个 */
      }
    }
    if (typeof localStorage !== 'undefined' && localStorageUsable()) return createLocalStorageAdapter();
    return createMemoryAdapter();
  }

  /** IndexedDB 用不了时的第二选择。 */
  function createFallbackStorage() {
    if (typeof localStorage !== 'undefined' && localStorageUsable()) return createLocalStorageAdapter();
    return createMemoryAdapter();
  }

  Diary.db = {
    DB_NAME,
    DB_VERSION,
    SIMPLE_STORES,
    createFallbackStorage,
    createIndexedDBAdapter,
    createLocalStorageAdapter,
    createMemoryAdapter,
    createStorage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
