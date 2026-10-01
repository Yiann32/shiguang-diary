/**
 * 数据仓库：内存缓存 + 存储适配器，对外只暴露完成业务语义的方法。
 * 单机日记的数据量很小，全量载入内存再筛选足够快，逻辑也更简单。
 *
 * 记账相关的表（流水 / 分类 / 账户 / 预算 / 周期记账）都按「当前账本」隔离，
 * 日记与待办不分账本，全局共享。
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  function createStore(adapter) {
    const model = Diary.model;
    let current = adapter || Diary.db.createStorage();
    let entries = [];
    let todos = [];
    let todoGroups = [];
    let books = [];
    let categories = [];
    let accounts = [];
    let budgets = [];
    let recurring = [];
    let ledger = [];
    let activeBookId = '';
    let ready = false;
    let degraded = false;
    const listeners = new Set();

    const emit = () => {
      for (const listener of listeners) {
        try {
          listener(entries, current);
        } catch (error) {
          console.error('[store] 监听器出错', error);
        }
      }
    };

    const sort = (mode) => {
      entries = model.sortEntries(entries, mode || 'desc');
    };

    const call = (name, ...args) => (current[name] ? current[name](...args) : Promise.resolve(undefined));

    /** 读一张表；适配器没有这个方法时当作空表 */
    const readTable = async (key) => {
      try {
        const raw = await call(`getAll${key}`);
        return Array.isArray(raw) ? raw : [];
      } catch (error) {
        return [];
      }
    };

    const writeTable = async (key, list) => {
      if (!list || !list.length) return;
      try {
        if (current[`putMany${key}`]) await current[`putMany${key}`](list);
        else for (const item of list) await call(`put${key}`, item);
      } catch (error) {
        console.warn(`[store] 写入 ${key} 失败`, error);
      }
    };

    const writeOne = async (key, record) => {
      try {
        await call(`put${key}`, record);
      } catch (error) {
        console.warn(`[store] 写入 ${key} 失败`, error);
      }
    };

    /** 首次使用（或账本被删光）时建默认账本，并把内置分类 / 现金账户一起落库 */
    const ensureBook = async () => {
      if (!books.length) {
        const book = model.normalizeBook({ name: '日常账本' });
        const seededCategories = model.createDefaultCategories(book.id);
        const seededAccounts = model.createDefaultAccounts(book.id);
        books = [book];
        categories = [...categories, ...seededCategories];
        accounts = [...accounts, ...seededAccounts];
        activeBookId = book.id;
        await writeOne('Books', book);
        await writeTable('Categories', seededCategories);
        await writeTable('Accounts', seededAccounts);
        return;
      }
      if (!books.some((book) => book.id === activeBookId)) activeBookId = books[0].id;
      // 新账本或缺数据的账本补齐默认分类 / 账户，避免九宫格是空的
      if (!categories.some((item) => item.bookId === activeBookId)) {
        const seeded = model.createDefaultCategories(activeBookId);
        categories = [...categories, ...seeded];
        await writeTable('Categories', seeded);
      }
      if (!accounts.some((item) => item.bookId === activeBookId)) {
        const seeded = model.createDefaultAccounts(activeBookId);
        accounts = [...accounts, ...seeded];
        await writeTable('Accounts', seeded);
      }
    };

    const loadCollections = async () => {
      todos = (await readTable('Todos')).map((item) => model.normalizeTodo(item)).filter((item) => item.text);
      todoGroups = (await readTable('TodoGroups')).map((item) => model.normalizeTodoGroup(item));
      books = (await readTable('Books')).map((item) => model.normalizeBook(item));
      categories = (await readTable('Categories')).map((item) => model.normalizeCategory(item));
      accounts = (await readTable('Accounts')).map((item) => model.normalizeAccount(item));
      budgets = (await readTable('Budgets')).map((item) => model.normalizeBudget(item));
      recurring = (await readTable('Recurring')).map((item) => model.normalizeRecurring(item));
      ledger = model.sortLedger(
        (await readTable('Ledger'))
          .map((item) => model.normalizeLedger(item))
          .filter((item) => !model.isEmptyLedger(item)),
        'desc',
      );
      await ensureBook();
    };

    const scoped = (list) => list.filter((item) => item.bookId === activeBookId);
    const activeLedger = () => ledger.filter((item) => item.bookId === activeBookId);

    const store = {
      get kind() {
        return current.kind;
      },
      get degraded() {
        return degraded;
      },
      get ready() {
        return ready;
      },

      async init() {
        try {
          const stored = await current.getAll();
          entries = (Array.isArray(stored) ? stored : []).map((item) => model.normalizeEntry(item));
        } catch (error) {
          console.warn('[store] IndexedDB 不可用，尝试降级存储', error);
          const fallback = Diary.db.createFallbackStorage();
          try {
            const stored = await fallback.getAll();
            entries = (Array.isArray(stored) ? stored : []).map((item) => model.normalizeEntry(item));
            current = fallback;
            degraded = current.kind !== 'indexeddb';
          } catch (innerError) {
            console.warn('[store] 降级存储也不可用，本次只存在内存中', innerError);
            current = Diary.db.createMemoryAdapter();
            degraded = true;
            entries = [];
          }
        }
        sort();
        await loadCollections();
        // 打开 App 时先把周期记账该补的那几次补上（幂等，重复调用不会重复记账）
        await store.materializeRecurring(model.todayKey());
        ready = true;
        emit();
        return entries;
      },

      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },

      /* ------------------------------------------------------------ 条目 */

      list() {
        return entries;
      },

      get(id) {
        return entries.find((entry) => entry.id === id) || null;
      },

      async save(rawEntry) {
        const entry = model.normalizeEntry(rawEntry);
        const index = entries.findIndex((item) => item.id === entry.id);
        if (index >= 0) entries[index] = entry;
        else entries.unshift(entry);
        sort();
        await current.put(entry);
        emit();
        return entry;
      },

      async remove(id) {
        const entry = store.get(id);
        entries = entries.filter((item) => item.id !== id);
        await current.remove(id);
        if (entry && entry.media && entry.media.length) await store.removeMedia(entry.media);
        emit();
      },

      /** 清空全部：日记、图片、记账、待办一起清 */
      async clear() {
        entries = [];
        todos = [];
        todoGroups = [];
        ledger = [];
        budgets = [];
        recurring = [];
        await current.clear();
        if (current.clearMedia) await current.clearMedia();
        for (const key of [
          'Todos',
          'TodoGroups',
          'Ledger',
          'Budgets',
          'Recurring',
          'Categories',
          'Accounts',
          'Books',
        ]) {
          await call(`clear${key}`);
        }
        books = [];
        categories = [];
        accounts = [];
        await ensureBook();
        emit();
      },

      async replaceAll(rawEntries) {
        const next = (rawEntries || []).map((item) => model.normalizeEntry(item));
        await current.clear();
        if (current.clearMedia) await current.clearMedia();
        await current.putMany(next);
        entries = next;
        sort();
        emit();
        return next.length;
      },

      /** 合并导入：同 id 时保留更新时间较新的那份，避免覆盖刚写的内容。 */
      async mergeAll(rawEntries) {
        let added = 0;
        let updated = 0;
        let skipped = 0;
        const toWrite = [];
        for (const item of rawEntries || []) {
          const incoming = model.normalizeEntry(item);
          const existing = entries.find((entry) => entry.id === incoming.id);
          if (!existing) {
            entries.push(incoming);
            toWrite.push(incoming);
            added += 1;
            continue;
          }
          if ((incoming.updatedAt || 0) > (existing.updatedAt || 0)) {
            entries = entries.map((entry) => (entry.id === incoming.id ? incoming : entry));
            toWrite.push(incoming);
            updated += 1;
          } else {
            skipped += 1;
          }
        }
        if (toWrite.length) await current.putMany(toWrite);
        sort();
        emit();
        return { added, updated, skipped };
      },

      /* ------------------------------------------------------------ 图片 */

      async putMedia(id, blob) {
        return current.putMedia(id, blob);
      },

      getMedia(id) {
        return current.getMedia(id);
      },

      async removeMedia(ids) {
        if (!ids || !ids.length || !current.removeMedia) return;
        await current.removeMedia(ids);
      },

      /** 导入用：一次性写入条目与图片。 */
      async importResult(result, mode) {
        const summary =
          mode === 'replace'
            ? { replaced: await store.replaceAll(result.entries) }
            : await store.mergeAll(result.entries);

        if (result.media && result.media.length && current.putMedia) {
          for (const item of result.media) {
            try {
              await current.putMedia(item.id, item.blob);
            } catch (error) {
              console.warn('[store] 图片写入失败', item.id, error);
            }
          }
        }
        await store.importCollections(result, mode);
        return summary;
      },

      /** 导入备份里的记账 / 待办数据（v3 备份才有） */
      async importCollections(payload, mode) {
        if (!payload) return;
        const incomingBooks = (payload.books || []).map((item) => model.normalizeBook(item));
        const incomingCategories = (payload.categories || []).map((item) => model.normalizeCategory(item));
        const incomingAccounts = (payload.accounts || []).map((item) => model.normalizeAccount(item));
        const incomingBudgets = (payload.budgets || []).map((item) => model.normalizeBudget(item));
        const incomingRecurring = (payload.recurring || []).map((item) => model.normalizeRecurring(item));
        const incomingLedger = (payload.ledger || [])
          .map((item) => model.normalizeLedger(item))
          .filter((item) => !model.isEmptyLedger(item));
        const incomingTodos = (payload.todos || [])
          .map((item) => model.normalizeTodo(item))
          .filter((item) => item.text);
        const incomingGroups = (payload.todoGroups || []).map((item) => model.normalizeTodoGroup(item));

        const merge = (list, incoming) => {
          const known = new Set(list.map((item) => item.id));
          return [...list, ...incoming.filter((item) => !known.has(item.id))];
        };

        if (mode === 'replace') {
          books = incomingBooks;
          categories = incomingCategories;
          accounts = incomingAccounts;
          budgets = incomingBudgets;
          recurring = incomingRecurring;
          ledger = incomingLedger;
          todos = incomingTodos;
          todoGroups = incomingGroups;
          activeBookId = books.length ? books[0].id : '';
          for (const key of [
            'Books',
            'Categories',
            'Accounts',
            'Budgets',
            'Recurring',
            'Ledger',
            'Todos',
            'TodoGroups',
          ]) {
            await call(`clear${key}`);
          }
        } else {
          books = merge(books, incomingBooks);
          categories = merge(categories, incomingCategories);
          accounts = merge(accounts, incomingAccounts);
          budgets = merge(budgets, incomingBudgets);
          recurring = merge(recurring, incomingRecurring);
          todos = merge(todos, incomingTodos);
          todoGroups = merge(todoGroups, incomingGroups);
          ledger = merge(ledger, incomingLedger);
        }

        ledger = model.sortLedger(ledger, 'desc');
        await store.persistLedgerDomain();
        await writeTable('Todos', todos);
        await writeTable('TodoGroups', todoGroups);
        await ensureBook();
        emit();
      },

      async persistLedgerDomain() {
        await writeTable('Books', books);
        await writeTable('Categories', categories);
        await writeTable('Accounts', accounts);
        await writeTable('Budgets', budgets);
        await writeTable('Recurring', recurring);
        await writeTable('Ledger', ledger);
      },

      stats() {
        const payload = store.exportPayload();
        const words = entries.reduce(
          (sum, entry) => sum + model.wordCount(entry.content) + model.wordCount(entry.title),
          0,
        );
        const mediaCount = entries.reduce((sum, entry) => sum + (entry.media ? entry.media.length : 0), 0);
        const streak = model.computeStreak(entries);
        return {
          count: entries.length,
          mediaCount,
          words,
          bytes: model.utf8Length(JSON.stringify(payload)),
          storage: current.kind,
          degraded,
          ...streak,
        };
      },

      /* ------------------------------------------------------------ 账本 */

      books() {
        return [...books].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      },

      get activeBookId() {
        return activeBookId;
      },

      activeBook() {
        return books.find((book) => book.id === activeBookId) || books[0] || null;
      },

      async setActiveBook(id) {
        if (!books.some((book) => book.id === id) || id === activeBookId) return false;
        activeBookId = id;
        await ensureBook();
        emit();
        return true;
      },

      async addBook(name) {
        const book = model.normalizeBook({ name: name || `账本 ${books.length + 1}` });
        const seededCategories = model.createDefaultCategories(book.id);
        const seededAccounts = model.createDefaultAccounts(book.id);
        books = [...books, book];
        categories = [...categories, ...seededCategories];
        accounts = [...accounts, ...seededAccounts];
        activeBookId = book.id;
        await writeOne('Books', book);
        await writeTable('Categories', seededCategories);
        await writeTable('Accounts', seededAccounts);
        emit();
        return book;
      },

      async renameBook(id, name) {
        const book = books.find((item) => item.id === id);
        if (!book) return null;
        const next = model.normalizeBook({ ...book, name });
        books = books.map((item) => (item.id === id ? next : item));
        await writeOne('Books', next);
        emit();
        return next;
      },

      async removeBook(id) {
        if (books.length <= 1) return false;
        const doomedLedger = ledger.filter((item) => item.bookId === id);
        const doomedCategories = categories.filter((item) => item.bookId === id);
        const doomedAccounts = accounts.filter((item) => item.bookId === id);
        books = books.filter((book) => book.id !== id);
        categories = categories.filter((item) => item.bookId !== id);
        accounts = accounts.filter((item) => item.bookId !== id);
        budgets = budgets.filter((item) => item.bookId !== id);
        recurring = recurring.filter((item) => item.bookId !== id);
        ledger = ledger.filter((item) => item.bookId !== id);
        if (activeBookId === id) activeBookId = books[0].id;
        await call('removeBooks', id);
        for (const item of doomedLedger) await call('removeLedger', item.id);
        for (const item of doomedCategories) await call('removeCategories', item.id);
        for (const item of doomedAccounts) await call('removeAccounts', item.id);
        await call('clearBudgets');
        await call('clearRecurring');
        await writeTable('Budgets', budgets);
        await writeTable('Recurring', recurring);
        await ensureBook();
        emit();
        return true;
      },

      /* ------------------------------------------------------------ 分类 */

      categories(kind) {
        const list = categories.filter((item) => item.bookId === activeBookId);
        const filtered = kind ? list.filter((item) => item.kind === kind) : list;
        return filtered.sort(
          (a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || '', 'zh-Hans-CN'),
        );
      },

      categoryById(id) {
        return categories.find((item) => item.id === id) || null;
      },

      async addCategory(raw) {
        const list = store.categories(raw && raw.kind);
        const category = model.normalizeCategory(
          { ...raw, bookId: activeBookId, order: ((list[list.length - 1] || {}).order || 0) + 1 },
          Date.now(),
          activeBookId,
        );
        categories = [...categories, category];
        await writeOne('Categories', category);
        emit();
        return category;
      },

      async updateCategory(id, patch) {
        const existing = store.categoryById(id);
        if (!existing) return null;
        const next = model.normalizeCategory({ ...existing, ...(patch || {}), id }, Date.now(), activeBookId);
        categories = categories.map((item) => (item.id === id ? next : item));
        await writeOne('Categories', next);
        emit();
        return next;
      },

      /** 删除分类：它名下的流水改成「未分类」，不连流水一起删 */
      async removeCategory(id) {
        const category = store.categoryById(id);
        if (!category) return false;
        categories = categories.filter((item) => item.id !== id);
        budgets = budgets.filter((item) => item.scope !== id);
        const touched = ledger.filter((item) => item.categoryId === id).map((item) => ({ ...item, categoryId: '' }));
        const touchedIds = new Set(touched.map((item) => item.id));
        ledger = ledger.map((item) => (touchedIds.has(item.id) ? { ...item, categoryId: '' } : item));
        await call('removeCategories', id);
        await writeTable('Budgets', budgets);
        await writeTable('Ledger', touched);
        emit();
        return true;
      },

      /* ------------------------------------------------------------ 账户 */

      accounts() {
        return accounts
          .filter((item) => item.bookId === activeBookId)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
      },

      accountById(id) {
        return accounts.find((item) => item.id === id) || null;
      },

      accountBalances() {
        return model.accountBalances(store.accounts(), activeLedger());
      },

      async addAccount(raw) {
        const list = store.accounts();
        const account = model.normalizeAccount(
          { ...raw, bookId: activeBookId, order: ((list[list.length - 1] || {}).order || 0) + 1 },
          Date.now(),
          activeBookId,
        );
        accounts = [...accounts, account];
        await writeOne('Accounts', account);
        emit();
        return account;
      },

      async updateAccount(id, patch) {
        const existing = store.accountById(id);
        if (!existing) return null;
        const next = model.normalizeAccount({ ...existing, ...(patch || {}), id }, Date.now(), activeBookId);
        accounts = accounts.map((item) => (item.id === id ? next : item));
        await writeOne('Accounts', next);
        emit();
        return next;
      },

      /** 删除账户：它名下的流水保留，账户指向改到另一个账户上，避免流水悬空 */
      async removeAccount(id) {
        if (!store.accountById(id)) return false;
        const fallback = store.accounts().find((item) => item.id !== id);
        accounts = accounts.filter((item) => item.id !== id);
        const touched = [];
        ledger = ledger.map((item) => {
          if (item.accountId !== id && item.toAccountId !== id) return item;
          const next = {
            ...item,
            accountId: item.accountId === id ? (fallback ? fallback.id : '') : item.accountId,
            toAccountId: item.toAccountId === id ? (fallback ? fallback.id : '') : item.toAccountId,
          };
          touched.push(next);
          return next;
        });
        await call('removeAccounts', id);
        await writeTable('Ledger', touched);
        emit();
        return true;
      },

      /* ------------------------------------------------------------ 预算 */

      budgets() {
        return scoped(budgets);
      },

      monthlyBudget() {
        return store.budgets().find((item) => item.scope === 'month-total') || null;
      },

      categoryBudget(categoryId) {
        return store.budgets().find((item) => item.scope === categoryId) || null;
      },

      /** 设预算；金额为 0 等于删掉这条预算 */
      async setBudget(scope, amount) {
        const key = scope || 'month-total';
        const existing = store.budgets().find((item) => item.scope === key);
        const value = model.toMoney(amount);
        if (!(value > 0)) {
          if (!existing) return null;
          budgets = budgets.filter((item) => item.id !== existing.id);
          await call('removeBudgets', existing.id);
          emit();
          return null;
        }
        const next = model.normalizeBudget(
          { ...(existing || {}), scope: key, amount: value, enabled: true, bookId: activeBookId },
          Date.now(),
          activeBookId,
        );
        budgets = existing ? budgets.map((item) => (item.id === existing.id ? next : item)) : [...budgets, next];
        await writeOne('Budgets', next);
        emit();
        return next;
      },

      /** 本月预算进度（总预算 + 已花） */
      budgetProgress(year, month) {
        const budget = store.monthlyBudget();
        const totals = store.ledgerMonthTotals(year, month);
        return model.budgetProgress(budget, totals.expense);
      },

      /* -------------------------------------------------------- 周期记账 */

      recurringRules() {
        return scoped(recurring);
      },

      async addRecurring(raw) {
        const rule = model.normalizeRecurring({ ...raw, bookId: activeBookId }, Date.now(), activeBookId);
        recurring = [...recurring, rule];
        await writeOne('Recurring', rule);
        emit();
        return rule;
      },

      async updateRecurring(id, patch) {
        const existing = recurring.find((item) => item.id === id);
        if (!existing) return null;
        const next = model.normalizeRecurring({ ...existing, ...(patch || {}), id }, Date.now(), activeBookId);
        recurring = recurring.map((item) => (item.id === id ? next : item));
        await writeOne('Recurring', next);
        emit();
        return next;
      },

      /** 删规则时顺手删掉它自动生成的那几笔流水 */
      async removeRecurring(id) {
        const existed = recurring.some((item) => item.id === id);
        recurring = recurring.filter((item) => item.id !== id);
        const doomed = ledger.filter((item) => item.ruleId === id);
        ledger = ledger.filter((item) => item.ruleId !== id);
        await call('removeRecurring', id);
        for (const item of doomed) await call('removeLedger', item.id);
        emit();
        return existed;
      },

      /**
       * 补生成：把每条规则「到今天为止、还没生成过」的那几次写成真实流水。
       * 靠 ruleId + occurrenceKey 幂等，重复调用不会重复记账。
       */
      async materializeRecurring(today = model.todayKey()) {
        const created = [];
        const rules = store.recurringRules();
        for (const rule of rules) {
          if (!rule.enabled) continue;
          const dates = model.pendingRecurringDates(rule, today);
          if (!dates.length) continue;
          let last = rule.lastGeneratedDate;
          for (const date of dates) {
            const exists = ledger.some(
              (item) => item.ruleId === rule.id && item.occurrenceKey === date && item.bookId === rule.bookId,
            );
            if (!exists) {
              const record = model.normalizeLedger(
                {
                  bookId: rule.bookId,
                  type: rule.type,
                  amount: rule.amount,
                  date,
                  time: rule.time,
                  categoryId: rule.type === 'transfer' ? '' : rule.categoryId,
                  accountId: rule.accountId,
                  toAccountId: rule.type === 'transfer' ? rule.toAccountId : '',
                  note: rule.note,
                  ruleId: rule.id,
                  occurrenceKey: date,
                },
                Date.now(),
                rule.bookId,
              );
              if (!model.isEmptyLedger(record)) {
                ledger.push(record);
                created.push(record);
                await call('putLedger', record);
              }
            }
            if (date > (last || '')) last = date;
          }
          if (last && last !== rule.lastGeneratedDate) {
            const next = { ...rule, lastGeneratedDate: last };
            recurring = recurring.map((item) => (item.id === rule.id ? next : item));
            await writeOne('Recurring', next);
          }
        }
        if (created.length) {
          ledger = model.sortLedger(ledger, 'desc');
          emit();
        }
        return created;
      },

      /* ------------------------------------------------------------ 流水 */

      ledgerList() {
        return model.sortLedger(activeLedger(), 'desc');
      },

      ledgerOf(date) {
        return model.sortLedger(activeLedger().filter((item) => item.date === date), 'desc');
      },

      ledgerRange(from, to) {
        return model.sortLedger(
          activeLedger().filter((item) => (!from || item.date >= from) && (!to || item.date <= to)),
          'desc',
        );
      },

      /** 传 year + month 时只看那一个月，否则看全部 */
      categoryStats(kind, year, month) {
        const list =
          Number.isInteger(year) && Number.isInteger(month)
            ? store.ledgerRange(`${model.monthKey(year, month)}-01`, `${model.monthKey(year, month)}-31`)
            : store.ledgerList();
        return model.categoryStats(list, kind, store.categories());
      },

      ledgerTotals() {
        return model.ledgerTotals(store.ledgerList());
      },

      ledgerMonthTotals(year, month) {
        return model.monthLedgerTotals(store.ledgerList(), year, month);
      },

      ledgerYearTotals(year) {
        return model.yearLedgerTotals(store.ledgerList(), year);
      },

      ledgerDayTotals(date) {
        return model.dayLedgerTotals(store.ledgerList(), date);
      },

      ledgerGroups(mode) {
        return model.groupLedger(store.ledgerList(), mode || 'desc');
      },

      dayLedgerMap(year, month) {
        return model.dayLedgerMap(store.ledgerList(), year, month);
      },

      /** 新增一笔；金额为 0 就不记 */
      async addLedger(rawRecord) {
        const record = model.normalizeLedger({ ...rawRecord, bookId: activeBookId }, Date.now(), activeBookId);
        if (model.isEmptyLedger(record)) return null;
        if (!record.accountId && store.accounts().length) record.accountId = store.accounts()[0].id;
        ledger.push(record);
        ledger = model.sortLedger(ledger, 'desc');
        await call('putLedger', record);
        emit();
        return record;
      },

      /** 改某一笔（金额改成 0 等于删掉） */
      async updateLedger(id, patch) {
        const existing = ledger.find((item) => item.id === id);
        if (!existing) return null;
        const merged = model.normalizeLedger(
          { ...existing, ...(patch || {}), id: existing.id },
          Date.now(),
          existing.bookId,
        );
        if (model.isEmptyLedger(merged)) return store.removeLedger(id);
        ledger = ledger.map((item) => (item.id === id ? merged : item));
        ledger = model.sortLedger(ledger, 'desc');
        await call('putLedger', merged);
        emit();
        return merged;
      },

      async removeLedger(id) {
        const existed = ledger.some((item) => item.id === id);
        ledger = ledger.filter((item) => item.id !== id);
        await call('removeLedger', id);
        emit();
        return existed;
      },

      /* ------------------------------------------------------------ 待办 */

      todoList() {
        return model.sortTodos(todos);
      },

      todosDueOn(date) {
        return model.sortTodos(todos.filter((item) => item.dueDate === date && !item.done));
      },

      todoGroupsList() {
        return model.sortTodoGroups(todoGroups);
      },

      todoStats() {
        return model.todoStats(todos, model.todayKey());
      },

      async addTodo(raw) {
        const payload = typeof raw === 'string' ? { text: raw } : raw || {};
        const pending = store.todoList().filter((item) => !item.done);
        const base = ((pending[pending.length - 1] || {}).order || 0) + 1;
        const todo = model.normalizeTodo({ ...payload, order: base }, Date.now());
        if (!todo.text) return null;
        todos = [...todos, todo];
        await writeOne('Todos', todo);
        emit();
        return todo;
      },

      async updateTodo(id, patch) {
        const existing = todos.find((item) => item.id === id);
        if (!existing) return null;
        const next = model.normalizeTodo({ ...existing, ...(patch || {}), id }, Date.now());
        if (!next.text) return store.removeTodo(id);
        todos = todos.map((item) => (item.id === id ? next : item));
        await writeOne('Todos', next);
        emit();
        return next;
      },

      async toggleTodo(id) {
        const todo = todos.find((item) => item.id === id);
        if (!todo) return null;
        return store.updateTodo(id, { done: !todo.done, doneAt: todo.done ? null : Date.now() });
      },

      async removeTodo(id) {
        const existed = todos.some((item) => item.id === id);
        todos = todos.filter((item) => item.id !== id);
        await call('removeTodos', id);
        emit();
        return existed;
      },

      /** 拖拽排序：按传进来的 id 顺序重排 */
      async reorderTodos(ids) {
        const order = new Map(ids.map((id, index) => [id, index + 1]));
        const touched = [];
        todos = todos.map((item) => {
          if (!order.has(item.id)) return item;
          const next = { ...item, order: order.get(item.id) };
          touched.push(next);
          return next;
        });
        await writeTable('Todos', touched);
        emit();
        return touched.length;
      },

      async addTodoGroup(name) {
        const list = store.todoGroupsList();
        const group = model.normalizeTodoGroup({ name, order: ((list[list.length - 1] || {}).order || 0) + 1 }, Date.now());
        todoGroups = [...todoGroups, group];
        await writeOne('TodoGroups', group);
        emit();
        return group;
      },

      async renameTodoGroup(id, name) {
        const existing = todoGroups.find((item) => item.id === id);
        if (!existing) return null;
        const next = model.normalizeTodoGroup({ ...existing, name }, Date.now());
        todoGroups = todoGroups.map((item) => (item.id === id ? next : item));
        await writeOne('TodoGroups', next);
        emit();
        return next;
      },

      /** 删除分组：组里的待办回到「默认清单」，不跟着删 */
      async removeTodoGroup(id) {
        if (!todoGroups.some((item) => item.id === id)) return false;
        todoGroups = todoGroups.filter((item) => item.id !== id);
        const touched = todos.filter((item) => item.groupId === id).map((item) => ({ ...item, groupId: '' }));
        const touchedIds = new Set(touched.map((item) => item.id));
        todos = todos.map((item) => (touchedIds.has(item.id) ? { ...item, groupId: '' } : item));
        await call('removeTodoGroups', id);
        await writeTable('Todos', touched);
        emit();
        return true;
      },

      async clearDoneTodos() {
        const doneIds = todos.filter((item) => item.done).map((item) => item.id);
        if (!doneIds.length) return 0;
        todos = todos.filter((item) => !item.done);
        for (const id of doneIds) await call('removeTodos', id);
        emit();
        return doneIds.length;
      },

      /* -------------------------------------------------------- 导入导出 */

      exportPayload() {
        return model.buildExportPayload(entries, {
          books,
          categories,
          accounts,
          budgets,
          recurring,
          ledger,
          todos,
          todoGroups,
        });
      },

      exportMarkdown() {
        return model.toMarkdown(entries);
      },

      exportPlainText() {
        return model.toPlainText(entries);
      },

      exportLedgerCsv() {
        return model.ledgerToCsv(store.ledgerList(), { categories, accounts, books });
      },

      /** 完整备份：entries.json（v3，含记账与待办）+ media/，可再次导入。 */
      async exportBundle(onProgress) {
        const zip = Diary.zip;
        const payload = store.exportPayload();
        const files = [{ name: 'entries.json', data: JSON.stringify(payload, null, 1) }];
        let index = 0;
        for (const entry of entries) {
          for (const mediaId of entry.media || []) {
            index += 1;
            if (onProgress) onProgress({ done: index, total: undefined, name: mediaId });
            const blob = await current.getMedia(mediaId);
            if (!blob) continue;
            const buffer = new Uint8Array(await blob.arrayBuffer());
            const kind = Diary.importer.sniffImage(buffer);
            files.push({ name: `media/${mediaId.replace(/[:#]/g, '_')}.${kind.ext}`, data: buffer });
          }
        }
        return zip.createZip(files);
      },
    };

    return store;
  }

  Diary.createStore = createStore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
