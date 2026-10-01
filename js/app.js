/**
 * 界面控制器：把 model / store / importer 和 DOM 接起来。
 * 约定——输入停下 500ms 自动保存，没有「保存按钮」。
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});
  const VERSION = '3.0.0';
  const AUTOSAVE_DELAY = 500;

  function start() {
    const model = Diary.model;
    const ui = Diary.ui;
    const { $, $$, el, icon, toast, debounce, downloadFile, openDialog, closeDialog } = ui;

    const store = Diary.createStore();
    let settings = Diary.settings.loadSettings();

    const state = {
      entries: [],
      // v2 的「统计」页签在 v3 并进了「我的」下面的二级页
      tab: settings.tab === 'stats' ? 'profile' : settings.tab || 'timeline',
      query: '',
      filter: settings.timelineFilter || 'all',
      tag: null,
      selectedId: null,
      draft: null,
      preview: false,
      dirty: false,
      searchOpen: false,
      filterOpen: false,
      calYear: 0,
      calMonth: 0,
      calSelected: '',
      calendarMode: settings.calendarMode || 'diary',
      moneyYear: 0,
      moneyMonth: 0,
      ledgerRange: 'month',
      subpage: null,
      pendingImport: null,
      installPrompt: null,
      actionEntryId: null,
      formResolve: null,
      keypad: null,
    };

    const objectUrls = [];
    const dom = {
      body: document.body,
      timeline: $('#timeline'),
      filterLabel: $('#filterLabel'),
      filterBar: $('#filterBar'),
      filterOptions: $('#filterOptions'),
      filterTags: $('#filterTags'),
      searchBar: $('#searchBar'),
      search: $('#search'),
      calDateMain: $('#calDateMain'),
      calDateYear: $('#calDateYear'),
      calHead: $('#calHead'),
      calGrid: $('#calGrid'),
      dayList: $('#dayList'),
      statsGrid: $('#statsGrid'),
      heatmap: $('#heatmap'),
      monthBars: $('#monthBars'),
      editor: $('#editor'),
      fDate: $('#fDate'),
      fTitle: $('#fTitle'),
      fContent: $('#fContent'),
      fTags: $('#fTags'),
      editorMedia: $('#editorMedia'),
      preview: $('#preview'),
      status: $('#saveStatus'),
      editorMeta: $('#editorMeta'),
      dateDay: $('#dateDay'),
      dateWeekday: $('#dateWeekday'),
      dateYearMonth: $('#dateYearMonth'),
      wordCount: $('#wordCount'),
      btnSaveMobile: $('#btnSaveMobile'),
      btnPickDate: $('#btnPickDate'),
      tagSummary: $('#tagSummary'),
      btnEditTags: $('#btnEditTags'),
      todoList: $('#todoList'),
      todoInput: $('#todoInput'),
      todoEmpty: $('#todoEmpty'),
      btnTodoAdd: $('#btnTodoAdd'),
      btnClearDoneTodos: $('#btnClearDoneTodos'),
      todoCard: $('#todoCard'),
      todoCount: $('#todoCount'),
      btnTodoMore: $('#btnTodoMore'),
      todoPage: $('#todoPage'),
      todoPageBody: $('#todoPageBody'),
      todoPageInput: $('#todoPageInput'),
      todoPageEmpty: $('#todoPageEmpty'),
      btnTodoPageAdd: $('#btnTodoPageAdd'),
      btnTodoPageClear: $('#btnTodoPageClear'),
      btnTodoBack: $('#btnTodoBack'),
      btnTodoGroups: $('#btnTodoGroups'),
      calModeGroup: $('#calModeGroup'),
      bookLabel: $('#bookLabel'),
      btnBookSwitch: $('#btnBookSwitch'),
      btnMoneyStats: $('#btnMoneyStats'),
      btnMoneySetup: $('#btnMoneySetup'),
      btnMoneyAdd: $('#btnMoneyAdd'),
      moneyOverview: $('#moneyOverview'),
      moneyChart: $('#moneyChart'),
      moneyRank: $('#moneyRank'),
      moneyFlow: $('#moneyFlow'),
      ledgerStatsPage: $('#ledgerStatsPage'),
      ledgerStatsBody: $('#ledgerStatsBody'),
      ledgerStatsRange: $('#ledgerStatsRange'),
      btnLedgerStatsBack: $('#btnLedgerStatsBack'),
      ledgerSetupPage: $('#ledgerSetupPage'),
      ledgerSetupBody: $('#ledgerSetupBody'),
      btnSetupBack: $('#btnSetupBack'),
      btnBookManage: $('#btnBookManage'),
      statsPage: $('#statsPage'),
      btnStatsBack: $('#btnStatsBack'),
      statsRowIcon: $('#statsRowIcon'),
      btnOpenStats: $('#btnOpenStats'),
      btnExportCsv: $('#btnExportCsv'),
      editorTodos: $('#editorTodos'),
      keypad: $('#keypad'),
      btnKeypadClose: $('#btnKeypadClose'),
      keypadTypeGroup: $('#keypadTypeGroup'),
      keypadValue: $('#keypadValue'),
      keypadChips: $('#keypadChips'),
      keypadPicker: $('#keypadPicker'),
      keypadPad: $('#keypadPad'),
      btnKeypadDelete: $('#btnKeypadDelete'),
      formDialog: $('#formDialog'),
      formDialogTitle: $('#formDialogTitle'),
      formDialogBody: $('#formDialogBody'),
      formDialogOk: $('#formDialogOk'),
      formDialogDelete: $('#formDialogDelete'),
      tagDialog: $('#tagDialog'),
      tagDialogInput: $('#tagDialogInput'),
      btnTagSave: $('#btnTagSave'),
      btnPin: $('#btnPin'),
      btnPreview: $('#btnPreview'),
      importDialog: $('#importDialog'),
      importSummary: $('#importSummary'),
      importPasswordRow: $('#importPasswordRow'),
      importPassword: $('#importPassword'),
      importMedia: $('#importMedia'),
      importProgress: $('#importProgress'),
      fileInput: $('#fileInput'),
      themeGroup: $('#themeGroup'),
      fontGroup: $('#fontGroup'),
      installRow: $('#installRow'),
      btnInstall: $('#btnInstall'),
      aboutBox: $('#aboutBox'),
      lightbox: $('#lightbox'),
      lightboxImage: $('#lightboxImage'),
      cardDialog: $('#cardDialog'),
      cardDialogTitle: $('#cardDialogTitle'),
      confirmDialog: $('#confirmDialog'),
      confirmTitle: $('#confirmTitle'),
      confirmMessage: $('#confirmMessage'),
      btnConfirmOk: $('#btnConfirmOk'),
    };

    const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
    const today = () => model.todayKey(Date.now());

    const visibleEntries = () =>
      model.filterEntries(state.entries, {
        query: state.query,
        tag: state.tag,
        filter: state.filter,
        today: today(),
        sort: 'desc',
      });

    /** 把细线图标注入到按钮里（SVG 描边，风格参考截图）。 */
    function paintIcons() {
      const map = {
        btnNew: ['plus', 26],
        btnRandom: ['bulb', 21],
        btnSearch: ['search', 20],
        btnClearSearch: ['close', 16],
        // 左上角统一用「返回」箭头（手机端也是）
        btnBack: ['back', 22],
        btnPrevDay: ['chevronLeft', 17],
        btnNextDay: ['chevronRight', 17],
        btnPin: ['star', 19],
        btnPreview: ['eye', 20],
        btnDelete: ['trash', 19],
        btnPrevMonth: ['chevronLeft', 17],
        btnNextMonth: ['chevronRight', 17],
        btnCalToday: ['calendar', 20],
        btnCalPick: ['shuffle', 20],
        btnTodoBack: ['back', 22],
        btnStatsBack: ['back', 22],
        btnLedgerStatsBack: ['back', 22],
        btnSetupBack: ['back', 22],
        btnMoneyStats: ['chart', 20],
        btnMoneySetup: ['lines', 20],
        btnMoneyAdd: ['plus', 24],
        btnKeypadClose: ['close', 20],
        statsRowIcon: ['chart', 20],
        tagRowIcon: ['tag', 18],
        wordRowIcon: ['lines', 18],
        cardPinIcon: ['star', 18],
        cardDeleteIcon: ['trash', 18],
      };
      for (const [id, [name, size]] of Object.entries(map)) {
        const node = document.getElementById(id);
        if (!node) continue;
        node.textContent = '';
        node.append(icon(name, size));
      }
      const tabs = { timeline: 'book', calendar: 'calendar', money: 'wallet', profile: 'person' };
      for (const button of $$('[data-tab]')) {
        if (button.querySelector('svg')) continue;
        button.append(icon(tabs[button.dataset.tab] || 'book', 22));
      }
    }

    /** 手机端不要文字引导：搜索框和正文都不显示占位提示 */
    function applyPlatformText() {
      const phone = isMobile();
      dom.search.placeholder = phone ? '' : '搜索标题、正文、标签…';
      dom.fContent.placeholder = phone
        ? ''
        : '今天发生了什么？支持 Markdown：**加粗**、# 标题、- 列表、> 引用';
    }

    /* ------------------------------------------------------------ 启动 */

    function boot() {
      const bootAt = Date.now();
      Diary.settings.applySettings(settings);
      paintIcons();
      applyPlatformText();
      setTab(state.tab, { silent: true });
      renderEditor();
      renderTimeline();
      renderTodoCard();
      renderMoney();
      bindEvents();

      store.subscribe((entries) => {
        state.entries = entries;
        renderTimeline();
        renderTodoCard();
        renderMoney();
        renderEditorTodos();
        if (state.subpage === 'todo') renderTodoPage();
        if (state.subpage === 'stats') renderStats();
        if (state.subpage === 'ledgerStats') renderLedgerStats();
        if (state.subpage === 'ledgerSetup') renderLedgerSetup();
        if (state.tab === 'calendar') renderCalendar();
      });

      store.init().then(() => {
        state.entries = store.list();
        if (settings.activeBookId) store.setActiveBook(settings.activeBookId);
        renderTimeline();
        renderCalendar();
        renderMoney();
        renderEditorTodos();
        restoreLastEntry();
        if (store.degraded) {
          toast(
            store.kind === 'memory'
              ? '本地存储不可用，这次记录只保存在内存中'
              : '已降级到浏览器存储，建议定期导出备份',
            { tone: 'error', duration: 5200 },
          );
        }
        // 启动画面至少停 500ms，然后图标淡出、主界面从右滑入（避免加载时闪一下白屏）
        setTimeout(hideBootSplash, Math.max(0, 500 - (Date.now() - bootAt)));
      });
    }

    function hideBootSplash() {
      const splash = $('#bootSplash');
      const shell = $('.app');
      if (shell) {
        shell.classList.add('is-entering');
        setTimeout(() => shell.classList.remove('is-entering'), 460);
      }
      if (splash) {
        splash.classList.add('is-leaving');
        setTimeout(() => splash.remove(), 360);
      }
    }

    function restoreLastEntry() {
      const params = new URLSearchParams(location.search);
      if (params.get('action') === 'new') {
        history.replaceState(null, '', location.pathname);
        startNewEntry();
        return;
      }
      // 手机端打开就停在时间线（和参考 App 一致），桌面端才自动打开上次那篇
      if (isMobile()) {
        renderEditor();
        return;
      }
      const last = settings.lastEntryId ? store.get(settings.lastEntryId) : null;
      const fallback = state.entries.length ? visibleEntries()[0] : null;
      const target = last || fallback;
      if (target) selectEntry(target.id);
      else renderEditor();
    }

    /* ------------------------------------------------------------ 标签页 */

    function setTab(name, options) {
      if (state.subpage) closeSubpage();
      state.tab = name;
      if (!options || !options.silent) settings = Diary.settings.saveSettings({ tab: name });
      dom.body.dataset.tab = name;
      for (const screen of $$('.screen')) screen.hidden = screen.dataset.screen !== name;
      for (const button of $$('[data-tab]', $('#tabbar'))) {
        button.setAttribute('aria-selected', String(button.dataset.tab === name));
      }
      if (name === 'calendar') renderCalendar();
      if (name === 'money') {
        renderMoney();
        // 进记账页时先把周期记账该补的那几次补上（幂等）
        store.materializeRecurring(model.todayKey()).then(() => renderMoney());
      }
      if (name === 'profile') renderProfile();
    }

    /* ------------------------------------------------------------ 时间线 */

    function renderTimeline() {
      const items = visibleEntries();
      releaseObjectUrls();
      dom.timeline.textContent = '';
      dom.filterLabel.textContent =
        (Diary.settings.FILTERS.find((item) => item.key === state.filter) || { label: '全部' }).label +
        (state.tag ? ` · ${state.tag}` : '');

      if (!items.length) {
        dom.timeline.append(
          el('div', { class: 'empty' }, [
            el('div', { class: 'empty__art' }, [icon('book', 30)]),
            el('p', { class: 'empty__title', text: emptyMessage() }),
            el('p', { class: 'empty__hint', text: '点右下角的「＋」写一篇新的，支持 Markdown 与图片。' }),
          ]),
        );
        return;
      }

      for (const entry of items.slice(0, 300)) dom.timeline.append(renderCard(entry));
    }

    function emptyMessage() {
      if (state.query.trim()) return `没有找到「${state.query.trim()}」`;
      if (state.tag) return `没有带「${state.tag}」的日记`;
      if (state.filter !== 'all') return '这个筛选下还没有日记';
      return '还没有日记，写下今天的第一句吧';
    }

    function renderCard(entry) {
      const date = model.cardDate(entry.date);
      const title = entry.title.trim();
      const excerpt = model.entryExcerpt(entry, 160);
      const card = el('article', {
        class: 'card',
        tabindex: '0',
        role: 'button',
        dataset: { id: entry.id },
        onclick: (event) => {
          // 长按之后紧跟的那一次 click 要吃掉，否则会顺手把日记打开
          if (suppressCardClick) {
            suppressCardClick = false;
            return;
          }
          selectEntry(entry.id, { fromPoint: pointFromEvent(event, event.currentTarget) });
        },
        onkeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectEntry(entry.id);
          }
        },
      });
      attachLongPress(card, entry);

      card.append(
        el('div', { class: 'card__head' }, [
          el('span', { class: 'card__day', text: date.day }),
          el('span', { class: 'card__week', text: date.weekday }),
          el('span', { class: 'card__spacer' }),
          el('span', { class: 'card__time', text: entry.time }),
          entry.pinned ? el('span', { class: 'card__pin' }, [icon('star', 13)]) : null,
        ]),
      );

      if (title) card.append(el('p', { class: 'card__title', text: title }));
      if (excerpt) card.append(el('p', { class: 'card__text', text: excerpt }));
      else if (!title && (entry.media || []).length) {
        card.append(el('p', { class: 'card__text card__text--muted', text: '（图片）' }));
      }

      if ((entry.media || []).length) {
        const thumbs = el('div', { class: 'card__thumbs' });
        card.append(thumbs);
        loadThumbs(entry, thumbs, 3);
      }

      if (entry.tags.length) {
        card.append(
          el('div', { class: 'card__meta' }, [
            el('span', { class: 'card__tags', text: entry.tags.map((tag) => `#${tag}`).join('  ') }),
          ]),
        );
      }
      return card;
    }

    /* ------------------------------------------------ 长按卡片：收藏 / 删除 */
    let longPressTimer = null;
    let suppressCardClick = false;

    function attachLongPress(node, entry) {
      const cancel = () => {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = null;
      };
      node.addEventListener('pointerdown', (event) => {
        if (typeof event.button === 'number' && event.button > 0) return;
        suppressCardClick = false;
        cancel();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          suppressCardClick = true;
          openCardActions(entry);
        }, 500);
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, cancel);
      // 手机浏览器长按会弹系统菜单，这里屏蔽掉
      node.addEventListener('contextmenu', (event) => event.preventDefault());
    }

    function openCardActions(entry) {
      state.actionEntryId = entry.id;
      dom.cardDialogTitle.textContent = model.entryTitle(entry);
      $('#cardPinLabel').textContent = entry.pinned ? '取消收藏' : '收藏';
      openDialog(dom.cardDialog);
    }

    async function loadThumbs(entry, container, limit) {
      const ids = (entry.media || []).slice(0, limit);
      for (const id of ids) {
        let blob = null;
        try {
          blob = await store.getMedia(id);
        } catch (error) {
          continue;
        }
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        container.append(
          el('img', {
            class: 'card__thumb',
            src: url,
            alt: '日记图片',
            loading: 'lazy',
            onclick: (event) => {
              event.stopPropagation();
              showLightbox(url);
            },
          }),
        );
      }
      const total = (entry.media || []).length;
      if (total > limit) container.append(el('span', { class: 'card__more', text: `+${total - limit}` }));
    }

    function releaseObjectUrls() {
      while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop());
    }

    function showLightbox(url) {
      dom.lightboxImage.src = url;
      dom.lightbox.hidden = false;
    }

    /* -------------------------------------------------------------- 日历 */

    function setCalendarMonth(year, month) {
      const normalized = model.addMonths(year, month, 0);
      state.calYear = normalized.year;
      state.calMonth = normalized.month;
    }

    /** 切月份：顺手把选中日期落到这个月第一篇（没有就落在 1 号），切过去就能看到那个月的内容 */
    function goToMonth(year, month) {
      const target = model.addMonths(year, month, 0);
      const current = state.calYear * 12 + state.calMonth;
      const next = target.year * 12 + target.month;
      setCalendarMonth(year, month);
      const prefix = model.monthKey(state.calYear, state.calMonth);
      const firstWithEntry = state.entries
        .map((entry) => entry.date)
        .filter((date) => date.startsWith(prefix))
        .sort()[0];
      state.calSelected = firstWithEntry || `${prefix}-01`;
      return next > current ? 1 : next < current ? -1 : 0;
    }

    /** 手机上左右滑动切换月份：左滑看下个月，右滑看上个月 */
    function bindCalendarSwipe() {
      const calendar = $('.calendar');
      if (!calendar) return;
      let startX = 0;
      let startY = 0;
      let tracking = false;
      calendar.addEventListener(
        'touchstart',
        (event) => {
          if (event.touches.length !== 1) return;
          tracking = true;
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
        },
        { passive: true },
      );
      calendar.addEventListener(
        'touchend',
        (event) => {
          if (!tracking) return;
          tracking = false;
          const touch = event.changedTouches && event.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;
          // 横向位移要够大、且明显大于纵向位移，避免和竖向滚动打架
          if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
          const direction = goToMonth(state.calYear, state.calMonth + (dx < 0 ? 1 : -1));
          renderCalendar(direction);
        },
        { passive: true },
      );
    }

    /** 编辑器里左右滑动切换上/下一篇：左滑看更新的一篇，右滑看更早的一篇 */
    function bindEditorSwipe() {
      const area = dom.editor;
      if (!area) return;
      let startX = 0;
      let startY = 0;
      let tracking = false;
      area.addEventListener(
        'touchstart',
        (event) => {
          if (event.touches.length !== 1) return;
          tracking = true;
          startX = event.touches[0].clientX;
          startY = event.touches[0].clientY;
        },
        { passive: true },
      );
      area.addEventListener(
        'touchend',
        (event) => {
          if (!tracking) return;
          tracking = false;
          const touch = event.changedTouches && event.changedTouches[0];
          if (!touch) return;
          const dx = touch.clientX - startX;
          const dy = touch.clientY - startY;
          // 横向位移要够大、且明显大于纵向，避免和上下滚动/光标拖动打架
          if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
          goToNeighbor(dx < 0 ? 1 : -1);
        },
        { passive: true },
      );
    }

    function renderCalendar(slideDirection) {
      if (!state.calYear) {
        const now = model.parseDateKey(today()) || new Date();
        setCalendarMonth(now.getFullYear(), now.getMonth());
        state.calSelected = state.calSelected || today();
      }
      const mode = state.calendarMode;
      for (const button of $$('[data-cal-mode]', dom.calModeGroup)) {
        button.classList.toggle('is-active', button.dataset.calMode === mode);
      }
      const counts = model.countByDate(state.entries);
      const header = model.headerDate(state.calSelected);
      dom.calDateMain.textContent = header.main;
      dom.calDateYear.textContent = header.year;
      $('#calMonthLabel').textContent = `${state.calYear} 年 ${state.calMonth + 1} 月`;

      dom.calHead.textContent = '';
      for (const label of model.MONTH_LABELS) {
        dom.calHead.append(el('span', { class: 'calendar__weekday', text: label }));
      }

      const moneyMap = mode === 'money' ? store.dayLedgerMap(state.calYear, state.calMonth) : null;
      const todoMap = mode === 'todo' ? model.todoDueMap(store.todoList(), state.calYear, state.calMonth) : null;

      dom.calGrid.textContent = '';
      for (const week of model.monthGrid(state.calYear, state.calMonth)) {
        for (const cell of week) {
          const classes = ['calcell'];
          let children = null;
          let title = cell.date;
          const label = cell.inMonth ? String(cell.day) : '';

          if (mode === 'diary') {
            const count = counts.get(cell.date) || 0;
            // 只在本月格子上显示「有日记」的灰底，避免相邻月份漏进来
            if (count && cell.inMonth) classes.push('has-entries');
            if (count) title = `${cell.date} · ${count} 篇`;
          } else if (mode === 'money') {
            classes.push('calcell--stacked');
            const day = moneyMap.get(cell.date);
            const amount = day ? day.expense : 0;
            children = [
              el('span', { class: 'calcell__num', text: label }),
              el('span', {
                class: `calmoney${amount > 0 ? '' : ' is-empty'}`,
                text: model.formatMoneyShort(amount) || '0',
              }),
              day && day.income > 0 ? el('span', { class: 'calcellsig' }) : null,
            ];
            title = day ? `${cell.date} · 支出 ${model.formatMoney(day.expense)} · 收入 ${model.formatMoney(day.income)}` : cell.date;
          } else {
            classes.push('calcell--stacked');
            const pending = todoMap.get(cell.date) || 0;
            children = [
              el('span', { class: 'calcell__num', text: label }),
              pending
                ? el('span', {
                    class: `caldot${cell.date < today() ? ' caldot--overdue' : ''}`,
                    text: String(pending),
                  })
                : el('span', { class: 'calmoney is-empty', text: '0' }),
            ];
            title = pending ? `${cell.date} · ${pending} 条待办` : cell.date;
          }
          if (cell.date === today()) classes.push('is-today');
          if (cell.date === state.calSelected) classes.push('is-selected');
          dom.calGrid.append(
            el('button', {
              type: 'button',
              class: classes.join(' '),
              text: children ? null : label,
              title,
              dataset: { date: cell.date },
              disabled: !cell.inMonth,
              onclick: () => {
                state.calSelected = cell.date;
                renderCalendar();
              },
            }, children),
          );
        }
      }
      renderDayList();
      // 翻月时网格横向滑动一下（1 = 下个月从右进，-1 = 上个月从左进）
      if (slideDirection) {
        dom.calGrid.classList.remove('is-sliding-next', 'is-sliding-prev');
        void dom.calGrid.offsetWidth;
        dom.calGrid.classList.add(slideDirection > 0 ? 'is-sliding-next' : 'is-sliding-prev');
        setTimeout(() => dom.calGrid.classList.remove('is-sliding-next', 'is-sliding-prev'), 320);
      }
    }

    /** 当天详情：跟着日历的三种模式走 */
    function renderDayList() {
      const date = state.calSelected || today();
      dom.dayList.textContent = '';
      if (state.calendarMode === 'money') {
        renderDayMoney(date);
        return;
      }
      if (state.calendarMode === 'todo') {
        renderDayTodos(date);
        return;
      }
      const items = model.sortEntries(
        state.entries.filter((entry) => entry.date === date),
        'asc',
      );
      if (!items.length) {
        dom.dayList.append(
          el('div', { class: 'daylist__empty' }, [
            el('p', { class: 'daylist__hint', text: '这天还没有记录' }),
            el('button', {
              type: 'button',
              class: 'btn btn--soft',
              text: '补写这一天',
              onclick: (event) => startNewEntry(date, pointFromEvent(event, event.currentTarget)),
            }),
          ]),
        );
        return;
      }
      for (const entry of items) {
        const excerpt = model.entryExcerpt(entry, 60);
        const mediaCount = (entry.media || []).length;
        dom.dayList.append(
          el('div', { class: 'dayrow' }, [
            el('span', { class: 'dayrow__time', text: entry.time }),
            el(
              'button',
              {
                type: 'button',
                class: 'dayrow__card',
                onclick: (event) => selectEntry(entry.id, { fromPoint: pointFromEvent(event, event.currentTarget) }),
              },
              [
                entry.title.trim() ? el('p', { class: 'dayrow__title', text: entry.title.trim() }) : null,
                el('p', { class: 'dayrow__text', text: excerpt || (mediaCount ? '（图片）' : '（无内容）') }),
                mediaCount
                  ? el('span', { class: 'dayrow__badge' }, [icon('image', 13), String(mediaCount)])
                  : null,
              ],
            ),
          ]),
        );
      }
    }

    /* -------------------------------------------------------------- 统计 */

    function renderStats() {
      const stats = store.stats();
      const storageLabels = { indexeddb: '设备数据库', localstorage: '浏览器存储', memory: '内存（临时）' };
      const cards = [
        ['日记', stats.count, '篇'],
        ['记录天数', stats.days, '天'],
        ['连续记录', stats.current, '天'],
        ['最长连续', stats.longest, '天'],
        ['总字数', stats.words, '字'],
        ['图片', stats.mediaCount || 0, '张'],
      ];
      dom.statsGrid.textContent = '';
      for (const [label, value, unit] of cards) {
        dom.statsGrid.append(
          el('div', { class: 'statcard' }, [
            el('span', { class: 'statcard__label', text: label }),
            el('span', { class: 'statcard__value' }, [String(value), el('small', { text: unit })]),
          ]),
        );
      }

      // 手机端转置成「7 列（周一到周日）× N 行（周）」，和日历一个方向；
      // 桌面端保持 GitHub 那种 13 列 × 7 行
      // 从左到右、从上到下排，最后一个格子就是今天（右下角）
      const days = model.activityDays(state.entries, { days: 91, today: today() });
      dom.heatmap.textContent = '';
      const grid = el('div', { class: 'heatmap__grid' });
      for (const day of days) {
        const level = Math.min(4, day.count);
        grid.append(
          el('span', {
            class: `heatcell level-${level}${day.today ? ' is-today' : ''}`,
            title: `${day.date} · ${day.count} 篇`,
          }),
        );
      }
      dom.heatmap.append(
        el('h3', { class: 'section__title', text: '最近 13 周' }),
        grid,
        el('div', { class: 'heatmap__legend' }, [
          el('span', { text: '少' }),
          ...[0, 1, 2, 3, 4].map((level) => el('span', { class: `heatcell level-${level}` })),
          el('span', { text: '多' }),
        ]),
      );

      const months = model.monthlyCounts(state.entries, 6, today());
      const max = Math.max(1, ...months.map((item) => item.count));
      dom.monthBars.textContent = '';
      const bars = el('div', { class: 'bars' });
      for (const item of months) {
        bars.append(
          el('div', { class: 'bars__item', title: `${item.label}：${item.count} 篇` }, [
            el('span', { class: 'bars__value', text: item.count ? String(item.count) : '' }),
            el('span', { class: 'bars__bar', style: { height: `${Math.round((item.count / max) * 100)}%` } }),
            el('span', { class: 'bars__label', text: item.label }),
          ]),
        );
      }
      dom.monthBars.append(el('h3', { class: 'section__title', text: '最近 6 个月' }), bars);

      dom.aboutBox.textContent = '';
      const rows = [
        ['存储位置', storageLabels[stats.storage] || stats.storage],
        ['数据大小', model.formatBytes(stats.bytes)],
        ['起始日期', stats.since ? model.dateLabel(stats.since, today()) : '—'],
        ['版本', `v${VERSION}`],
      ];
      for (const [label, value] of rows) {
        dom.aboutBox.append(
          el('div', { class: 'row' }, [
            el('span', { class: 'row__label', text: label }),
            el('span', { class: 'row__value', text: value }),
          ]),
        );
      }
    }

    /* -------------------------------------------------------------- 我的 */

    function renderProfile() {
      for (const button of $$('[data-theme-value]', dom.themeGroup)) {
        button.classList.toggle('is-active', button.dataset.themeValue === settings.theme);
      }
      for (const button of $$('[data-font-value]', dom.fontGroup)) {
        button.classList.toggle('is-active', button.dataset.fontValue === settings.fontSize);
      }
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      dom.installRow.hidden = standalone || !state.installPrompt;
      renderStats();
    }

    /* ------------------------------------------------------------ 编辑器 */

    function currentEntry() {
      if (state.draft) return state.draft;
      if (state.selectedId) return store.get(state.selectedId);
      return null;
    }

    /* ---------------------------------------------- 手机返回键 = 先退出编辑 */
    // 打开编辑器 / 二级页时压一条历史记录，这样系统返回键、侧滑返回只会收起这一层，
    // 而不是（因为页面里没有历史可退）直接把 App 关掉。
    const historyStack = [];
    let suppressPopUntil = 0;

    function pushHistoryEntry(kind) {
      if (!isMobile() || historyStack.includes(kind)) return;
      try {
        history.pushState({ diaryOverlay: kind }, '');
        historyStack.push(kind);
      } catch (error) {
        /* 少数 WebView 不让压历史，忽略即可 */
      }
    }

    /** UI 按钮主动关一层：先把自己的记录出栈，再让浏览器回退（回退触发的 popstate 会被忽略） */
    function goBackFrom(kind) {
      const index = historyStack.lastIndexOf(kind);
      if (index === -1) return;
      historyStack.splice(index, 1);
      suppressPopUntil = Date.now() + 500;
      try {
        history.back();
      } catch (error) {
        suppressPopUntil = 0;
      }
    }

    function handlePopState() {
      if (Date.now() < suppressPopUntil) return;
      const kind = historyStack.pop();
      if (kind === 'editor') {
        if (currentEntry()) closeEditor({ fromHistory: true });
      } else if (kind === 'subpage') {
        if (state.subpage) closeSubpage({ fromHistory: true });
      } else if (kind === 'keypad') {
        if (state.keypad) closeKeypad({ fromHistory: true });
      }
    }

    function renderEditor() {
      const active = Boolean(currentEntry());
      dom.editor.hidden = !active;
      dom.body.dataset.view = active ? 'editor' : 'list';
      if (active) pushHistoryEntry('editor');
    }

    function fillForm(entry) {
      dom.fDate.value = entry.date;
      dom.fTitle.value = entry.title;
      dom.fContent.value = entry.content;
      dom.fTags.value = entry.tags.join(', ');
      renderTagSummary();
      renderDateBlock(entry.date);
      dom.btnPin.setAttribute('aria-pressed', String(entry.pinned));
      dom.btnPin.classList.toggle('is-on', entry.pinned);
      renderEditorMeta(entry);
      renderEditorMedia(entry);
      renderPreview();
      renderEditorTodos();
      setStatus('');
      renderNavButtons();
    }

    function renderEditorMedia(entry) {
      const container = dom.editorMedia;
      container.textContent = '';
      const ids = entry.media || [];
      container.hidden = !ids.length;
      if (!ids.length) return;
      for (const id of ids) {
        const slot = el('div', { class: 'edmedia__slot' });
        container.append(slot);
        store
          .getMedia(id)
          .then((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            objectUrls.push(url);
            slot.append(
              el('img', { class: 'edmedia__img', src: url, alt: '日记图片', onclick: () => showLightbox(url) }),
            );
          })
          .catch(() => undefined);
      }
    }

    function renderEditorMeta(entry) {
      const words = model.wordCount(entry.title) + model.wordCount(entry.content);
      const pieces = [`${words} 字`];
      if ((entry.media || []).length) pieces.push(`${entry.media.length} 张图`);
      if (entry.tags.length) pieces.push(`${entry.tags.length} 个标签`);
      dom.editorMeta.textContent = pieces.join(' · ');
      if (dom.wordCount) dom.wordCount.textContent = `${words} 字`;
    }

    /** 手机端的大号日期块：27 / 周日 / 2026.9 */
    function renderDateBlock(dateKey) {
      const date = model.parseDateKey(dateKey);
      if (!date || !dom.dateDay) return;
      dom.dateDay.textContent = String(date.getDate());
      dom.dateWeekday.textContent = model.WEEKDAY_FULL[date.getDay()];
      dom.dateYearMonth.textContent = `${date.getFullYear()}.${date.getMonth() + 1}`;
    }

    /** 标签行只显示摘要，点一下弹居中悬浮窗输入 */
    function renderTagSummary() {
      if (!dom.tagSummary) return;
      const tags = model.normalizeTags(dom.fTags.value);
      dom.tagSummary.textContent = tags.length ? tags.map((tag) => `#${tag}`).join('  ') : '无';
    }

    /* ------------------------------------------------------ 通用表单弹窗 */

    let formContext = null;

    /** 一行「标签 + 控件」 */
    function formRow(label, control) {
      return el('label', { class: 'fieldrow fieldrow--stack' }, [
        el('span', { class: 'fieldrow__label', text: label }),
        control,
      ]);
    }

    function buildFormField(spec, refs) {
      const field = spec || {};
      if (field.type === 'note') return el('p', { class: 'hint', text: field.text });

      if (field.type === 'segmented') {
        const group = el('div', { class: 'segmented' });
        let current = field.value;
        for (const option of field.options || []) {
          group.append(
            el('button', {
              type: 'button',
              class: `segmented__item${String(option.value) === String(field.value) ? ' is-active' : ''}`,
              text: option.label,
              onclick: (event) => {
                current = option.value;
                for (const item of $$('.segmented__item', group)) item.classList.remove('is-active');
                event.currentTarget.classList.add('is-active');
              },
            }),
          );
        }
        refs[field.key] = () => current;
        return formRow(field.label, group);
      }

      if (field.type === 'swatches' || field.type === 'icons') {
        const isIcon = field.type === 'icons';
        const row = el('div', { class: isIcon ? 'iconchoices' : 'swatches' });
        let current = field.value;
        for (const item of field.items || []) {
          row.append(
            el('button', {
              type: 'button',
              class: `${isIcon ? 'iconchoice' : 'swatch'}${item === field.value ? ' is-active' : ''}`,
              text: isIcon ? item : null,
              style: isIcon ? null : { background: item },
              'aria-label': item,
              onclick: (event) => {
                current = item;
                for (const node of $$(`.${isIcon ? 'iconchoice' : 'swatch'}`, row)) {
                  node.classList.remove('is-active');
                }
                event.currentTarget.classList.add('is-active');
              },
            }),
          );
        }
        refs[field.key] = () => current;
        return formRow(field.label, row);
      }

      if (field.type === 'select') {
        const select = el('select', { class: 'input' });
        for (const option of field.options || []) {
          select.append(
            el('option', {
              value: option.value,
              text: option.label,
              selected: String(option.value) === String(field.value) ? true : null,
            }),
          );
        }
        refs[field.key] = select;
        if (!refs.__first) refs.__first = select;
        return formRow(field.label, select);
      }

      const input = el('input', {
        type: field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text',
        class: 'input',
        value: field.value === undefined || field.value === null ? '' : String(field.value),
        placeholder: field.placeholder || '',
        maxlength: field.maxLength,
        inputmode: field.inputMode || (field.type === 'number' ? 'decimal' : null),
        step: field.type === 'number' ? field.step || '0.01' : null,
      });
      refs[field.key] = input;
      if (!refs.__first) refs.__first = input;
      return formRow(field.label, input);
    }

    /** 打开通用表单；用户点「确定」返回字段值，取消返回 null，点删除返回 { __delete: true } */
    function openForm(options) {
      const config = options || {};
      return new Promise((resolve) => {
        const refs = {};
        const body = dom.formDialogBody;
        body.textContent = '';
        dom.formDialogTitle.textContent = config.title || '编辑';
        dom.formDialogOk.textContent = config.okText || '确定';
        dom.formDialogDelete.textContent = config.deleteText || '删除';
        dom.formDialogDelete.hidden = !config.onDelete;
        for (const field of config.fields || []) {
          const node = buildFormField(field, refs);
          if (node) body.append(node);
        }
        formContext = { config, refs, resolve };
        openDialog(dom.formDialog);
        if (refs.__first) setTimeout(() => refs.__first.focus(), 60);
      });
    }

    function closeForm(value) {
      const context = formContext;
      formContext = null;
      if (dom.formDialog.open) closeDialog(dom.formDialog);
      if (context) context.resolve(value);
    }

    function collectForm() {
      const values = {};
      if (!formContext) return values;
      for (const [key, ref] of Object.entries(formContext.refs)) {
        if (key.startsWith('__')) continue;
        values[key] = typeof ref === 'function' ? ref() : ref.value;
      }
      return values;
    }

    /* ------------------------------------------------------------- 待办 */

    /** 待办一行（时间线卡片和二级页共用） */
    function todoRow(todo, options) {
      const config = options || {};
      const overdue = Boolean(todo.dueDate) && !todo.done && todo.dueDate < today();
      const meta = [];
      if (todo.dueDate) {
        meta.push(`${model.dateLabel(todo.dueDate, today())}${overdue ? ' · 逾期' : ''}`);
      }
      if (todo.priority) meta.push(model.priorityLabel(todo.priority));

      const node = el('li', {
        class: `todo todo--p${todo.priority}${todo.done ? ' is-done' : ''}`,
        dataset: { id: todo.id },
      });
      if (config.handle) {
        node.append(
          el('button', {
            type: 'button',
            class: 'todo__handle',
            text: '⣿',
            'aria-label': '拖动排序',
            dataset: { handle: todo.id },
          }),
        );
      }
      node.append(
        el('button', {
          type: 'button',
          class: 'todo__check',
          'aria-label': todo.done ? '标记为未完成' : '标记为完成',
          text: todo.done ? '✓' : '',
          onclick: () => store.toggleTodo(todo.id),
        }),
        el('span', { class: 'todo__bar' }),
        el('div', { class: 'todo__body' }, [
          el('span', { class: 'todo__text', text: todo.text }),
          todo.note ? el('span', { class: 'todo__note', text: todo.note }) : null,
          meta.length
            ? el('span', { class: 'todo__meta' }, [
                todo.dueDate
                  ? el('span', { class: overdue ? 'is-overdue' : '', text: meta[0] })
                  : null,
                todo.priority ? el('span', { text: model.priorityLabel(todo.priority) }) : null,
              ])
            : null,
        ]),
        el('button', {
          type: 'button',
          class: 'todo__del',
          'aria-label': '删除待办',
          text: '×',
          onclick: () => store.removeTodo(todo.id),
        }),
      );
      node.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        openTodoDialog(todo);
      });
      return node;
    }

    function renderTodoCard() {
      if (!dom.todoList) return;
      const pending = store.todoList().filter((todo) => !todo.done);
      const stats = store.todoStats();
      dom.todoCount.textContent = stats.pending ? String(stats.pending) : '';
      dom.todoEmpty.hidden = pending.length > 0;
      dom.btnClearDoneTodos.hidden = stats.done === 0;
      dom.todoList.textContent = '';
      for (const todo of pending.slice(0, 6)) dom.todoList.append(todoRow(todo));
      if (pending.length > 6) {
        dom.todoList.append(
          el('li', { class: 'todo__more', text: `还有 ${pending.length - 6} 条，点标题看全部` }),
        );
      }
    }

    function renderDayMoney(date) {
      const items = store.ledgerOf(date);
      const totals = store.ledgerDayTotals(date);
      dom.dayList.append(
        el('div', { class: 'daysum' }, [
          el('div', { class: 'daysum__item' }, [
            el('span', { class: 'daysum__label', text: '支出' }),
            el('span', { class: 'daysum__value money-sum__value--out', text: `¥${model.formatMoney(totals.expense)}` }),
          ]),
          el('div', { class: 'daysum__item' }, [
            el('span', { class: 'daysum__label', text: '收入' }),
            el('span', { class: 'daysum__value money-sum__value--in', text: `¥${model.formatMoney(totals.income)}` }),
          ]),
          el('div', { class: 'daysum__item' }, [
            el('span', { class: 'daysum__label', text: '笔数' }),
            el('span', { class: 'daysum__value', text: `${totals.count + totals.transferCount} 笔` }),
          ]),
        ]),
      );
      if (!items.length) {
        dom.dayList.append(
          el('div', { class: 'daylist__empty' }, [
            el('p', { class: 'daylist__hint', text: '这天还没有记账' }),
            el('button', {
              type: 'button',
              class: 'btn btn--soft',
              text: '记一笔',
              onclick: () => openKeypad({ date }),
            }),
          ]),
        );
        return;
      }
      const list = el('div', { class: 'mflow' });
      for (const item of items) list.append(flowRow(item));
      dom.dayList.append(list);
    }

    function renderDayTodos(date) {
      const items = store.todoList().filter((todo) => todo.dueDate === date);
      const pending = items.filter((todo) => !todo.done);
      if (!items.length) {
        dom.dayList.append(
          el('div', { class: 'daylist__empty' }, [
            el('p', { class: 'daylist__hint', text: '这天没有待办' }),
            el('button', {
              type: 'button',
              class: 'btn btn--soft',
              text: '加一条待办',
              onclick: () => openTodoDialog({ dueDate: date }),
            }),
          ]),
        );
        return;
      }
      const list = el('ul', { class: 'todo__list todo__list--page' });
      for (const todo of items) list.append(todoRow(todo));
      dom.dayList.append(
        el('div', { class: 'moneyflow__day' }, [
          el('span', { text: model.dateLabel(date, today()) }),
          el('span', { text: `${pending.length} 条未完成` }),
        ]),
        el('div', { class: 'mflow' }, [list]),
      );
    }

    /** 二级页：按分组列出全部待办，可拖拽排序 */
    function renderTodoPage() {
      if (!dom.todoPageBody) return;
      const all = store.todoList();
      const pending = all.filter((todo) => !todo.done);
      const done = all.filter((todo) => todo.done);
      const groups = store.todoGroupsList();
      dom.todoPageBody.textContent = '';
      dom.todoPageEmpty.hidden = all.length > 0;
      dom.btnTodoPageClear.hidden = done.length === 0;

      const buckets = [{ id: '', name: '默认清单' }, ...groups];
      for (const bucket of buckets) {
        const items = pending.filter((todo) => (todo.groupId || '') === bucket.id);
        if (!items.length && bucket.id) continue;
        dom.todoPageBody.append(
          el('div', { class: 'todo__grouphead' }, [
            el('span', { class: 'todo__groupname', text: bucket.name }),
            el('button', {
              type: 'button',
              class: 'btn btn--ghost btn--sm',
              text: '+ 新增',
              onclick: () => openTodoDialog({ groupId: bucket.id }),
            }),
          ]),
        );
        const list = el('ul', { class: 'todo__list todo__list--page', dataset: { group: bucket.id } });
        for (const todo of items) list.append(todoRow(todo, { handle: true }));
        dom.todoPageBody.append(list);
      }

      if (done.length) {
        dom.todoPageBody.append(
          el('div', { class: 'todo__grouphead' }, [
            el('span', { class: 'todo__groupname', text: `已完成 ${done.length}` }),
          ]),
        );
        const list = el('ul', { class: 'todo__list todo__list--page' });
        for (const todo of done) list.append(todoRow(todo));
        dom.todoPageBody.append(list);
      }
      bindTodoDrag();
    }

    /** 拖拽排序（pointer events，触屏和鼠标都能用） */
    function bindTodoDrag() {
      for (const handle of $$('[data-handle]', dom.todoPageBody)) {
        handle.addEventListener('pointerdown', (event) => startTodoDrag(event, handle));
      }
    }

    function startTodoDrag(event, handle) {
      const node = handle.closest('.todo');
      const listNode = node && node.parentElement;
      if (!node || !listNode) return;
      event.preventDefault();
      const before = $$('.todo', listNode).map((item) => item.dataset.id);
      node.classList.add('is-dragging');

      const move = (moveEvent) => {
        const hit = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const over = hit && hit.closest ? hit.closest('.todo') : null;
        if (!over || over === node || over.parentElement !== listNode) return;
        const rect = over.getBoundingClientRect();
        const after = moveEvent.clientY > rect.top + rect.height / 2;
        listNode.insertBefore(node, after ? over.nextSibling : over);
        for (const item of $$('.todo', listNode)) item.classList.remove('is-drop-target');
        over.classList.add('is-drop-target');
      };

      const end = async () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        node.classList.remove('is-dragging');
        const after = $$('.todo', listNode).map((item) => item.dataset.id);
        if (before.join(',') !== after.join(',')) await store.reorderTodos(after);
        renderTodoPage();
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    }

    async function openTodoDialog(base) {
      const todo = base && base.id ? base : null;
      const draft = base || {};
      const groups = store.todoGroupsList();
      const values = await openForm({
        title: todo ? '编辑待办' : '新增待办',
        okText: todo ? '保存' : '添加',
        fields: [
          { type: 'text', key: 'text', label: '内容', value: todo ? todo.text : draft.text || '', placeholder: '要做的事', maxLength: 120 },
          { type: 'text', key: 'note', label: '备注', value: todo ? todo.note : draft.note || '', placeholder: '可留空', maxLength: 200 },
          {
            type: 'segmented',
            key: 'priority',
            label: '优先级',
            value: todo ? todo.priority : draft.priority || 0,
            options: model.TODO_PRIORITIES.map((item) => ({ value: item.key, label: item.label })),
          },
          { type: 'date', key: 'dueDate', label: '截止日期', value: todo ? todo.dueDate : draft.dueDate || '' },
          {
            type: 'select',
            key: 'groupId',
            label: '分组',
            value: todo ? todo.groupId : draft.groupId || '',
            options: [{ value: '', label: '默认清单' }, ...groups.map((group) => ({ value: group.id, label: group.name }))],
          },
        ],
        onDelete: todo ? async () => store.removeTodo(todo.id) : null,
      });
      if (!values) return;
      if (values.__delete) {
        toast('已删除待办', { tone: 'success' });
        return;
      }
      const text = String(values.text || '').trim();
      if (!text) {
        toast('内容不能为空', { tone: 'error' });
        return;
      }
      if (todo) await store.updateTodo(todo.id, { ...values, text });
      else await store.addTodo({ ...values, text });
      toast(todo ? '已保存' : '已添加', { tone: 'success' });
    }

    async function submitTodo(mode) {
      const input = mode === 'page' ? dom.todoPageInput : dom.todoInput;
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      await store.addTodo(text);
      input.focus();
    }

    async function openGroupManager() {
      const groups = store.todoGroupsList();
      const values = await openForm({
        title: '待办分组',
        okText: '新建分组',
        fields: [
          { type: 'note', text: groups.length ? `已有分组：${groups.map((item) => item.name).join('、')}` : '还没有分组' },
          { type: 'text', key: 'name', label: '新分组名', value: '', placeholder: '比如：工作、生活', maxLength: 16 },
        ],
      });
      if (!values) return;
      const name = String(values.name || '').trim();
      if (!name) return;
      await store.addTodoGroup(name);
      toast('已新建分组', { tone: 'success' });
    }

    /** 编辑器顶部的「本日待办」条 */
    function renderEditorTodos() {
      if (!dom.editorTodos) return;
      const date = currentEntry() ? dom.fDate.value : '';
      const items = date ? store.todoList().filter((todo) => todo.dueDate === date) : [];
      dom.editorTodos.textContent = '';
      dom.editorTodos.hidden = !items.length;
      for (const todo of items.slice(0, 8)) {
        dom.editorTodos.append(
          el('button', {
            type: 'button',
            class: `todostrip__item${todo.done ? ' is-done' : ''}`,
            text: todo.text,
            onclick: () => store.toggleTodo(todo.id),
          }),
        );
      }
    }

    /* ------------------------------------------------------------- 记账 */

    const SVG_NS = 'http://www.w3.org/2000/svg';

    function svgNode(tag, attrs) {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
      return node;
    }

    function moneyPeriod() {
      if (!state.moneyYear) {
        const now = model.parseDateKey(today()) || new Date();
        state.moneyYear = now.getFullYear();
        state.moneyMonth = now.getMonth();
      }
      return { year: state.moneyYear, month: state.moneyMonth };
    }

    function shiftMoneyMonth(delta) {
      const next = model.addMonths(state.moneyYear, state.moneyMonth, delta);
      state.moneyYear = next.year;
      state.moneyMonth = next.month;
      renderMoney();
      if (state.subpage === 'ledgerStats') renderLedgerStats();
    }

    function moneySumItem(label, value, tone) {
      return el('div', { class: 'money-sum__item' }, [
        el('span', { class: 'money-sum__label', text: label }),
        el('span', {
          class: `money-sum__value${tone ? ` money-sum__value--${tone}` : ''}`,
          text: `¥${model.formatMoney(value)}`,
        }),
      ]);
    }

    function budgetBarNode(progress) {
      const ratio = Math.max(0, Math.min(1, progress.ratio));
      return el('div', { class: `budgetbar${progress.over ? ' is-over' : ''}` }, [
        el('div', { class: 'budgetbar__head' }, [
          el('span', { text: `本月预算 ¥${model.formatMoney(progress.amount)}` }),
          el('span', {
            class: 'budgetbar__value',
            text: progress.over
              ? `超支 ¥${model.formatMoney(Math.abs(progress.remaining))}`
              : `还剩 ¥${model.formatMoney(progress.remaining)}`,
          }),
        ]),
        el('div', { class: 'budgetbar__track' }, [
          el('span', { class: 'budgetbar__fill', style: { width: `${Math.round(ratio * 100)}%` } }),
        ]),
      ]);
    }

    function donutNode(rows) {
      const size = 104;
      const stroke = 13;
      const radius = (size - stroke) / 2;
      const circumference = 2 * Math.PI * radius;
      const svg = svgNode('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut__chart' });
      svg.append(
        svgNode('circle', {
          cx: size / 2,
          cy: size / 2,
          r: radius,
          class: 'donut__ring',
          stroke: 'var(--surface-2)',
        }),
      );
      let offset = 0;
      for (const row of rows) {
        const length = Math.max(0, row.ratio) * circumference;
        if (length <= 0) continue;
        svg.append(
          svgNode('circle', {
            cx: size / 2,
            cy: size / 2,
            r: radius,
            class: 'donut__ring',
            stroke: row.color,
            'stroke-dasharray': `${length} ${circumference - length}`,
            'stroke-dashoffset': -offset,
            transform: `rotate(-90 ${size / 2} ${size / 2})`,
          }),
        );
        offset += length;
      }
      return svg;
    }

    function donutBlock(rows, emptyText) {
      if (!rows.length) return el('p', { class: 'hint', text: emptyText });
      return el('div', { class: 'donut' }, [
        donutNode(rows),
        el(
          'div',
          { class: 'donut__legend' },
          rows.slice(0, 5).map((row) =>
            el('div', { class: 'donut__legend-item' }, [
              el('span', { class: 'donut__dot', style: { background: row.color } }),
              el('span', { class: 'donut__legend-name', text: row.name }),
              el('span', { class: 'donut__legend-value', text: `${Math.round(row.ratio * 100)}%` }),
            ]),
          ),
        ),
      ]);
    }

    function flowRow(item) {
      const category = store.categoryById(item.categoryId);
      const account = store.accountById(item.accountId);
      const toAccount = store.accountById(item.toAccountId);
      const iconText = item.type === 'transfer' ? '🔄' : category ? category.icon : '📦';
      const name = item.type === 'transfer' ? '转账' : category ? category.name : '未分类';
      const sub = [
        account ? account.name : '',
        toAccount ? `转入 ${toAccount.name}` : '',
        item.note,
        item.time,
      ]
        .filter(Boolean)
        .join(' · ');
      const sign = item.type === 'expense' ? '-' : item.type === 'income' ? '+' : '';
      return el('button', { type: 'button', class: 'mflow__row', onclick: () => openKeypad({ edit: item }) }, [
        el('span', { class: 'mflow__icon', text: iconText }),
        el('span', { class: 'mflow__main' }, [
          el('span', { class: 'mflow__name', text: name }),
          el('span', { class: 'mflow__sub', text: sub || '—' }),
        ]),
        el('span', {
          class: `mflow__amount mflow__amount--${item.type}`,
          text: `${sign}${model.formatMoney(item.amount)}`,
        }),
      ]);
    }

    function renderMoney() {
      if (!dom.moneyOverview) return;
      const { year, month } = moneyPeriod();
      const book = store.activeBook();
      dom.bookLabel.textContent = book ? book.name : '日常账本';

      const totals = store.ledgerMonthTotals(year, month);
      const budget = store.budgetProgress(year, month);
      dom.moneyOverview.textContent = '';
      dom.moneyOverview.append(
        el('div', { class: 'money-period' }, [
          el('button', { type: 'button', class: 'iconbtn iconbtn--sm', 'aria-label': '上个月', onclick: () => shiftMoneyMonth(-1) }, [
            icon('chevronLeft', 17),
          ]),
          el('span', { class: 'money-period__label', text: `${year} 年 ${month + 1} 月` }),
          el('button', { type: 'button', class: 'iconbtn iconbtn--sm', 'aria-label': '下个月', onclick: () => shiftMoneyMonth(1) }, [
            icon('chevronRight', 17),
          ]),
        ]),
        el('div', { class: 'money-sum' }, [
          moneySumItem('支出', totals.expense, 'out'),
          moneySumItem('收入', totals.income, 'in'),
          moneySumItem('结余', totals.net, totals.net < 0 ? 'out' : 'in'),
        ]),
        budget.amount > 0
          ? budgetBarNode(budget)
          : el('p', { class: 'hint', text: '还没设本月预算，可在「账本设置 → 预算」里加一个。' }),
      );

      const expenseRows = store.categoryStats('expense', year, month);
      dom.moneyChart.textContent = '';
      dom.moneyChart.append(el('h3', { class: 'section__title', text: '本月支出构成' }), donutBlock(expenseRows, '这个月还没有支出'));

      dom.moneyRank.textContent = '';
      dom.moneyRank.append(el('h3', { class: 'section__title', text: '分类排行' }));
      if (!expenseRows.length) {
        dom.moneyRank.append(el('p', { class: 'hint', text: '还没有数据' }));
      } else {
        for (const row of expenseRows.slice(0, 6)) {
          dom.moneyRank.append(
            el('div', { class: 'rankrow' }, [
              el('span', { class: 'rankrow__icon', text: row.icon }),
              el('span', { class: 'rankrow__name', text: row.name }),
              el('span', { class: 'rankrow__ratio', text: `${row.count} 笔` }),
              el('span', { class: 'rankrow__amount', text: `¥${model.formatMoney(row.amount)}` }),
            ]),
          );
        }
      }

      const prefix = model.monthKey(year, month);
      const groups = store.ledgerGroups('desc').filter((group) => group.date.startsWith(prefix));
      dom.moneyFlow.textContent = '';
      if (!groups.length) {
        dom.moneyFlow.append(el('p', { class: 'hint', text: '这个月还没有记账，点右下角的「＋」记一笔。' }));
        return;
      }
      for (const group of groups) {
        dom.moneyFlow.append(
          el('div', { class: 'moneyflow__day' }, [
            el('span', { text: model.dateLabel(group.date, today()) }),
            el('span', {
              text: `支出 ${model.formatMoney(group.expense)} · 收入 ${model.formatMoney(group.income)}`,
            }),
          ]),
        );
        const list = el('div', { class: 'mflow' });
        for (const item of group.items) list.append(flowRow(item));
        dom.moneyFlow.append(list);
      }
    }

    /* -------------------------------------------------------- 记账统计 */

    function renderLedgerStats() {
      if (!dom.ledgerStatsBody) return;
      const { year, month } = moneyPeriod();
      const yearMode = state.ledgerRange === 'year';
      const totals = yearMode ? store.ledgerYearTotals(year) : store.ledgerMonthTotals(year, month);
      const body = dom.ledgerStatsBody;
      body.textContent = '';

      for (const button of $$('[data-range]', dom.ledgerStatsRange)) {
        button.classList.toggle('is-active', button.dataset.range === state.ledgerRange);
      }

      body.append(
        el('div', { class: 'panel' }, [
          el('div', { class: 'money-sum' }, [
            moneySumItem('支出', totals.expense, 'out'),
            moneySumItem('收入', totals.income, 'in'),
            moneySumItem('结余', totals.net, totals.net < 0 ? 'out' : 'in'),
          ]),
          el('p', {
            class: 'hint hint--sub',
            text: yearMode
              ? `${year} 年 · ${totals.count} 笔 · ${totals.days} 天有记账`
              : `${year} 年 ${month + 1} 月 · ${totals.count} 笔 · ${totals.days} 天有记账`,
          }),
        ]),
      );

      const rows = store.categoryStats('expense', year, yearMode ? undefined : month);
      body.append(
        el('div', { class: 'panel' }, [
          el('h3', { class: 'section__title', text: '支出分类' }),
          donutBlock(rows, '这段时间没有支出记录'),
        ]),
      );
      if (rows.length) {
        const max = Math.max(...rows.map((row) => row.amount), 1);
        const block = el('div', { class: 'panel' });
        block.append(el('h3', { class: 'section__title', text: '分类明细' }));
        for (const row of rows) {
          block.append(
            el('div', { class: 'lstats__row' }, [
              el('div', { class: 'lstats__head' }, [
                el('span', { class: 'lstats__name', text: `${row.icon} ${row.name}` }),
                el('span', { class: 'lstats__value', text: `¥${model.formatMoney(row.amount)} · ${Math.round(row.ratio * 100)}%` }),
              ]),
              el('div', { class: 'lstats__track' }, [
                el('span', {
                  class: 'lstats__fill',
                  style: { width: `${Math.round((row.amount / max) * 100)}%`, background: row.color },
                }),
              ]),
            ]),
          );
        }
        body.append(block);
      }

      const months = model.monthlyLedgerTotals(store.ledgerList(), 6, today());
      const peak = Math.max(1, ...months.map((item) => Math.max(item.income, item.expense)));
      const bars = el('div', { class: 'bars bars--dual' });
      for (const item of months) {
        bars.append(
          el('div', { class: 'bars__item', title: `${item.label}：支出 ${item.expense} · 收入 ${item.income}` }, [
            el('span', { class: 'bars__pair' }, [
              el('span', { class: 'bars__bar bars__bar--out', style: { height: `${Math.round((item.expense / peak) * 100)}%` } }),
              el('span', { class: 'bars__bar bars__bar--in', style: { height: `${Math.round((item.income / peak) * 100)}%` } }),
            ]),
            el('span', { class: 'bars__label', text: item.label }),
          ]),
        );
      }
      body.append(
        el('div', { class: 'panel' }, [
          el('h3', { class: 'section__title', text: '最近 6 个月' }),
          bars,
          el('p', { class: 'hint hint--sub', text: '左：支出　右：收入' }),
        ]),
      );

      const balances = store.accountBalances();
      const accountBlock = el('div', { class: 'panel' });
      accountBlock.append(el('h3', { class: 'section__title', text: '账户余额' }));
      for (const account of store.accounts()) {
        const value = balances.get(account.id) || 0;
        accountBlock.append(
          el('div', { class: 'listrow' }, [
            el('span', { class: 'listrow__icon', text: '💳' }),
            el('span', { class: 'listrow__main' }, [
              el('span', { class: 'listrow__title', text: account.name }),
              el('span', { class: 'listrow__sub', text: model.accountKindLabel(account.kind) }),
            ]),
            el('span', {
              class: `listrow__value${value < 0 ? ' listrow__value--out' : ''}`,
              text: `¥${model.formatMoney(value)}`,
            }),
          ]),
        );
      }
      body.append(accountBlock);
    }

    /* ---------------------------------------------------- 二级页管理 */

    const SUBPAGES = {
      todo: () => dom.todoPage,
      stats: () => dom.statsPage,
      ledgerStats: () => dom.ledgerStatsPage,
      ledgerSetup: () => dom.ledgerSetupPage,
    };

    function openSubpage(name) {
      const resolver = SUBPAGES[name];
      const page = resolver ? resolver() : null;
      if (!page) return;
      state.subpage = name;
      if (name === 'todo') renderTodoPage();
      if (name === 'stats') renderStats();
      if (name === 'ledgerStats') renderLedgerStats();
      if (name === 'ledgerSetup') renderLedgerSetup();
      page.classList.remove('is-leaving');
      page.hidden = false;
      if (name === 'todo') setTimeout(() => dom.todoPageInput.focus(), 90);
      pushHistoryEntry('subpage');
    }

    function closeSubpage(options) {
      const name = state.subpage;
      if (!name) return;
      const resolver = SUBPAGES[name];
      const page = resolver ? resolver() : null;
      state.subpage = null;
      const finish = () => {
        if (!page) return;
        page.hidden = true;
        page.classList.remove('is-leaving');
      };
      if (isMobile() && page) {
        page.classList.add('is-leaving');
        setTimeout(finish, 220);
      } else {
        finish();
      }
      if (!(options && options.fromHistory)) goBackFrom('subpage');
    }

    /* -------------------------------------------------------- 账本设置 */

    function settingBlock(title, addLabel, onAdd, rows) {
      const block = el('section', { class: 'panel setting' });
      block.append(
        el('div', { class: 'setting__head' }, [
          el('h3', { class: 'setting__title', text: title }),
          onAdd
            ? el('button', { type: 'button', class: 'btn btn--ghost btn--sm', text: addLabel || '新建', onclick: onAdd })
            : null,
        ]),
      );
      if (!rows.length) block.append(el('p', { class: 'hint', text: '还没有内容' }));
      for (const row of rows) block.append(row);
      return block;
    }

    function accountRow(account, balances) {
      const value = balances.get(account.id) || 0;
      return el('button', { type: 'button', class: 'listrow', onclick: () => openAccountDialog(account) }, [
        el('span', { class: 'listrow__icon', text: '💳' }),
        el('span', { class: 'listrow__main' }, [
          el('span', { class: 'listrow__title', text: account.name }),
          el('span', { class: 'listrow__sub', text: model.accountKindLabel(account.kind) }),
        ]),
        el('span', {
          class: `listrow__value${value < 0 ? ' listrow__value--out' : ''}`,
          text: `¥${model.formatMoney(value)}`,
        }),
      ]);
    }

    function categoryRow(category) {
      const budget = store.categoryBudget(category.id);
      return el('button', { type: 'button', class: 'listrow', onclick: () => openCategoryDialog(category) }, [
        el('span', { class: 'listrow__icon', style: { background: `${category.color}22`, color: category.color }, text: category.icon }),
        el('span', { class: 'listrow__main' }, [
          el('span', { class: 'listrow__title', text: category.name }),
          el('span', { class: 'listrow__sub', text: budget ? `预算 ¥${model.formatMoney(budget.amount)}` : '未设预算' }),
        ]),
      ]);
    }

    function recurringRow(rule) {
      return el('button', { type: 'button', class: 'listrow', onclick: () => openRecurringDialog(rule) }, [
        el('span', { class: 'listrow__icon', text: rule.type === 'transfer' ? '🔄' : rule.type === 'income' ? '💰' : '🧾' }),
        el('span', { class: 'listrow__main' }, [
          el('span', { class: 'listrow__title', text: rule.name || rule.note || model.ledgerTypeLabel(rule.type) }),
          el('span', {
            class: 'listrow__sub',
            text: `${model.frequencyLabel(rule)} · 从 ${rule.startDate} 起${rule.enabled ? '' : ' · 已暂停'}`,
          }),
        ]),
        el('span', { class: 'listrow__value', text: `¥${model.formatMoney(rule.amount)}` }),
      ]);
    }

    function renderLedgerSetup() {
      if (!dom.ledgerSetupBody) return;
      const body = dom.ledgerSetupBody;
      body.textContent = '';
      const balances = store.accountBalances();

      body.append(
        settingBlock(
          '账户',
          '新建账户',
          () => openAccountDialog(null),
          store.accounts().map((account) => accountRow(account, balances)),
        ),
      );

      const budgetRows = [];
      const monthly = store.monthlyBudget();
      budgetRows.push(
        el('button', { type: 'button', class: 'listrow', onclick: () => openBudgetDialog('month-total', '每月总预算') }, [
          el('span', { class: 'listrow__icon', text: '🎯' }),
          el('span', { class: 'listrow__main' }, [
            el('span', { class: 'listrow__title', text: '每月总预算' }),
            el('span', { class: 'listrow__sub', text: '首页会显示进度条，超支变红' }),
          ]),
          el('span', { class: 'listrow__value', text: monthly ? `¥${model.formatMoney(monthly.amount)}` : '未设置' }),
        ]),
      );
      for (const category of store.categories('expense')) {
        const budget = store.categoryBudget(category.id);
        if (!budget) continue;
        budgetRows.push(
          el('button', {
            type: 'button',
            class: 'listrow',
            onclick: () => openBudgetDialog(category.id, `${category.name} · 每月预算`),
          }, [
            el('span', { class: 'listrow__icon', style: { background: `${category.color}22`, color: category.color }, text: category.icon }),
            el('span', { class: 'listrow__main' }, [
              el('span', { class: 'listrow__title', text: category.name }),
              el('span', { class: 'listrow__sub', text: '分类预算' }),
            ]),
            el('span', { class: 'listrow__value', text: `¥${model.formatMoney(budget.amount)}` }),
          ]),
        );
      }
      budgetRows.push(
        el('button', { type: 'button', class: 'listrow listrow--add', text: '＋ 给某个分类加预算', onclick: openCategoryBudgetPicker }),
      );
      body.append(settingBlock('预算', null, null, budgetRows));

      body.append(
        settingBlock(
          '支出分类',
          '新建',
          () => openCategoryDialog({ kind: 'expense' }),
          store.categories('expense').map(categoryRow),
        ),
      );
      body.append(
        settingBlock(
          '收入分类',
          '新建',
          () => openCategoryDialog({ kind: 'income' }),
          store.categories('income').map(categoryRow),
        ),
      );
      body.append(
        settingBlock(
          '周期记账',
          '新建规则',
          () => openRecurringDialog(null),
          store.recurringRules().map(recurringRow),
        ),
      );
    }

    async function openCategoryBudgetPicker() {
      const categories = store.categories('expense');
      const values = await openForm({
        title: '给分类加预算',
        fields: [
          {
            type: 'select',
            key: 'categoryId',
            label: '分类',
            value: categories.length ? categories[0].id : '',
            options: categories.map((item) => ({ value: item.id, label: item.name })),
          },
          { type: 'number', key: 'amount', label: '每月预算', value: '' },
        ],
      });
      if (!values || !values.categoryId) return;
      await store.setBudget(values.categoryId, Number(values.amount) || 0);
      toast('预算已更新', { tone: 'success' });
    }

    /* ------------------------------------------------------------ 弹窗 */

    async function openAccountDialog(account) {
      const values = await openForm({
        title: account ? '编辑账户' : '新建账户',
        fields: [
          { type: 'text', key: 'name', label: '账户名', value: account ? account.name : '', placeholder: '现金 / 微信 / 招行卡', maxLength: 12 },
          {
            type: 'select',
            key: 'kind',
            label: '类型',
            value: account ? account.kind : 'cash',
            options: model.ACCOUNT_KINDS.map((item) => ({ value: item.key, label: item.label })),
          },
          { type: 'number', key: 'initialBalance', label: '初始余额', value: account ? account.initialBalance : 0 },
          { type: 'note', text: '信用卡的欠款填负数，例如 -1200。' },
        ],
        onDelete: account ? async () => store.removeAccount(account.id) : null,
      });
      if (!values) return;
      if (values.__delete) {
        toast('已删除账户，相关流水转到其它账户', { tone: 'success' });
        return;
      }
      const name = String(values.name || '').trim();
      if (!name) {
        toast('账户名不能为空', { tone: 'error' });
        return;
      }
      const payload = { name, kind: values.kind, initialBalance: Number(values.initialBalance) || 0 };
      if (account) await store.updateAccount(account.id, payload);
      else await store.addAccount(payload);
      toast('已保存', { tone: 'success' });
    }

    const CATEGORY_ICONS = [
      '🍜', '🚌', '🛍️', '🏠', '🎬', '💊', '📚', '📱', '🎁', '✈️', '🐾', '📦',
      '💰', '🏆', '🧾', '📈', '🧧', '🧮', '↩️', '☕', '🚗', '💡',
    ];

    async function openCategoryDialog(category) {
      const kind = category && category.kind ? category.kind : 'expense';
      const isEdit = Boolean(category && category.id);
      const values = await openForm({
        title: isEdit ? '编辑分类' : kind === 'income' ? '新建收入分类' : '新建支出分类',
        fields: [
          { type: 'text', key: 'name', label: '名称', value: isEdit ? category.name : '', maxLength: 12 },
          { type: 'icons', key: 'icon', label: '图标', value: isEdit ? category.icon : '📦', items: CATEGORY_ICONS },
          {
            type: 'swatches',
            key: 'color',
            label: '颜色',
            value: isEdit ? category.color : model.CATEGORY_COLORS[0],
            items: model.CATEGORY_COLORS,
          },
          { type: 'note', text: '删除分类不会删掉已记的流水，那些流水会变成「未分类」。' },
        ],
        onDelete: isEdit ? async () => store.removeCategory(category.id) : null,
      });
      if (!values) return;
      if (values.__delete) {
        toast('已删除分类', { tone: 'success' });
        return;
      }
      const name = String(values.name || '').trim();
      if (!name) {
        toast('分类名不能为空', { tone: 'error' });
        return;
      }
      const payload = { kind, name, icon: values.icon, color: values.color };
      if (isEdit) await store.updateCategory(category.id, payload);
      else await store.addCategory(payload);
      toast('已保存', { tone: 'success' });
    }

    async function openBudgetDialog(scope, title) {
      const existing = scope === 'month-total' ? store.monthlyBudget() : store.categoryBudget(scope);
      const values = await openForm({
        title,
        fields: [
          { type: 'number', key: 'amount', label: '每月金额', value: existing ? existing.amount : '' },
          { type: 'note', text: '填 0 就等于取消这条预算。' },
        ],
      });
      if (!values) return;
      await store.setBudget(scope, Number(values.amount) || 0);
      toast('预算已更新', { tone: 'success' });
    }

    async function openRecurringDialog(rule) {
      const isEdit = Boolean(rule && rule.id);
      const accounts = store.accounts();
      const values = await openForm({
        title: isEdit ? '编辑周期记账' : '新建周期记账',
        fields: [
          {
            type: 'segmented',
            key: 'type',
            label: '类型',
            value: isEdit ? rule.type : 'expense',
            options: model.LEDGER_TYPES.map((item) => ({ value: item.key, label: item.label })),
          },
          { type: 'text', key: 'name', label: '名称', value: isEdit ? rule.name : '', placeholder: '比如：房租、工资', maxLength: 16 },
          { type: 'number', key: 'amount', label: '金额', value: isEdit ? rule.amount : '' },
          {
            type: 'select',
            key: 'frequency',
            label: '频率',
            value: isEdit ? rule.frequency : 'monthly',
            options: model.FREQUENCIES.map((item) => ({ value: item.key, label: item.label })),
          },
          { type: 'number', key: 'interval', label: '每隔几期', value: isEdit ? rule.interval : 1, step: '1' },
          { type: 'number', key: 'dayOfMonth', label: '每月几号（按月的规则用）', value: isEdit && rule.dayOfMonth ? rule.dayOfMonth : '', step: '1' },
          { type: 'date', key: 'startDate', label: '开始日期', value: isEdit ? rule.startDate : today() },
          { type: 'date', key: 'endDate', label: '结束日期（可留空）', value: isEdit ? rule.endDate : '' },
          {
            type: 'select',
            key: 'accountId',
            label: '账户',
            value: isEdit ? rule.accountId : (accounts[0] || {}).id || '',
            options: accounts.map((item) => ({ value: item.id, label: item.name })),
          },
          {
            type: 'text',
            key: 'note',
            label: '备注',
            value: isEdit ? rule.note : '',
            placeholder: '可留空',
            maxLength: 60,
          },
          {
            type: 'segmented',
            key: 'enabled',
            label: '状态',
            value: isEdit ? String(rule.enabled) : 'true',
            options: [
              { value: 'true', label: '启用' },
              { value: 'false', label: '暂停' },
            ],
          },
        ],
        onDelete: isEdit ? async () => store.removeRecurring(rule.id) : null,
      });
      if (!values) return;
      if (values.__delete) {
        toast('已删除周期规则和它生成的流水', { tone: 'success' });
        return;
      }
      const payload = {
        type: values.type,
        name: values.name,
        amount: Number(values.amount) || 0,
        frequency: values.frequency,
        interval: Number(values.interval) || 1,
        dayOfMonth: values.dayOfMonth ? Number(values.dayOfMonth) : null,
        startDate: values.startDate,
        endDate: values.endDate,
        accountId: values.accountId,
        note: values.note,
        enabled: values.enabled !== 'false',
      };
      if (isEdit) await store.updateRecurring(rule.id, payload);
      else {
        await store.addRecurring(payload);
        await store.materializeRecurring(model.todayKey());
      }
      toast('已保存', { tone: 'success' });
    }

    async function openBookSwitcher() {
      const books = store.books();
      const values = await openForm({
        title: '账本',
        okText: '切换',
        fields: [
          {
            type: 'select',
            key: 'bookId',
            label: '当前账本',
            value: store.activeBookId,
            options: books.map((book) => ({ value: book.id, label: book.name })),
          },
          { type: 'text', key: 'newName', label: '新建账本', value: '', placeholder: '填名字就新建一个', maxLength: 20 },
        ],
      });
      if (!values) return;
      const newName = String(values.newName || '').trim();
      if (newName) {
        const book = await store.addBook(newName);
        settings = Diary.settings.saveSettings({ activeBookId: book.id });
        toast(`已新建账本「${book.name}」`, { tone: 'success' });
        return;
      }
      if (values.bookId && values.bookId !== store.activeBookId) {
        await store.setActiveBook(values.bookId);
        settings = Diary.settings.saveSettings({ activeBookId: values.bookId });
        toast('已切换账本', { tone: 'success' });
      }
    }

    async function openBookDialog(book) {
      if (!book) return;
      const values = await openForm({
        title: '账本设置',
        fields: [
          { type: 'text', key: 'name', label: '账本名', value: book.name, maxLength: 20 },
          { type: 'note', text: '删除账本会连它的流水、分类、账户、预算和周期规则一起删掉，日记不受影响。' },
        ],
        onDelete: store.books().length > 1 ? async () => store.removeBook(book.id) : null,
      });
      if (!values) return;
      if (values.__delete) {
        toast('已删除账本', { tone: 'success' });
        return;
      }
      const name = String(values.name || '').trim();
      if (!name) return;
      await store.renameBook(book.id, name);
      toast('已保存', { tone: 'success' });
    }

    /* -------------------------------------------------------- 金额键盘 */

    const KEYPAD_KEYS = ['1', '2', '3', 'back', '4', '5', '6', '.', '7', '8', '9', 'ok', '00', '0', 'clear'];
    let keypadPadBuilt = false;

    function openKeypad(options) {
      const config = options || {};
      const existing = config.edit || null;
      const accounts = store.accounts();
      const fallbackDate = state.tab === 'calendar' ? state.calSelected : '';
      state.keypad = {
        id: existing ? existing.id : '',
        type: existing ? existing.type : 'expense',
        date: existing ? existing.date : config.date || fallbackDate || today(),
        time: existing ? existing.time : model.toTimeKey(Date.now()),
        categoryId: existing ? existing.categoryId : '',
        accountId: existing ? existing.accountId : (accounts[0] || {}).id || '',
        toAccountId: existing ? existing.toAccountId : ((accounts[1] || accounts[0] || {}).id || ''),
        note: existing ? existing.note : '',
        amount: existing ? String(existing.amount) : '',
      };
      dom.keypad.hidden = false;
      dom.btnKeypadDelete.hidden = !existing;
      renderKeypad();
      pushHistoryEntry('keypad');
      if (typeof dom.keypad.animate === 'function') {
        dom.keypad.animate(
          [
            { opacity: 0, transform: 'translateY(26px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        );
      }
    }

    function closeKeypad(options) {
      const node = dom.keypad;
      state.keypad = null;
      if (!node || node.hidden) {
        if (!(options && options.fromHistory)) goBackFrom('keypad');
        return;
      }
      if (!(options && options.fromHistory)) goBackFrom('keypad');
      if (typeof node.animate === 'function') {
        const out = node.animate(
          [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(26px)' },
          ],
          { duration: 180, easing: 'ease-in', fill: 'both' },
        );
        out.onfinish = () => {
          node.hidden = true;
          if (typeof node.getAnimations === 'function') for (const item of node.getAnimations()) item.cancel();
        };
      } else {
        node.hidden = true;
      }
    }

    function renderKeypad() {
      const pad = state.keypad;
      if (!pad) return;
      for (const button of $$('[data-ledger-type]', dom.keypadTypeGroup)) {
        button.classList.toggle('is-active', button.dataset.ledgerType === pad.type);
      }
      const amount = Number(pad.amount);
      dom.keypadValue.textContent = pad.amount && Number.isFinite(amount) ? model.formatMoney(amount) : '0.00';
      dom.keypadValue.className = `keypad__value${
        pad.type === 'expense' ? ' keypad__value--out' : pad.type === 'income' ? ' keypad__value--in' : ''
      }`;
      renderKeypadChips();
      renderKeypadPicker();
      renderKeypadPad();
    }

    function renderKeypadChips() {
      const pad = state.keypad;
      dom.keypadChips.textContent = '';
      dom.keypadChips.append(
        el('button', {
          type: 'button',
          class: 'kchip',
          text: model.dateLabel(pad.date, today()),
          onclick: async () => {
            const values = await openForm({
              title: '日期',
              fields: [{ type: 'date', key: 'date', label: '日期', value: pad.date }],
            });
            if (values && model.isValidDateKey(values.date)) {
              state.keypad.date = values.date;
              renderKeypad();
            }
          },
        }),
        el('button', {
          type: 'button',
          class: `kchip${pad.note ? ' is-on' : ''}`,
          text: pad.note || '备注',
          onclick: async () => {
            const values = await openForm({
              title: '备注',
              fields: [{ type: 'text', key: 'note', label: '备注', value: pad.note, maxLength: 60 }],
            });
            if (values) {
              state.keypad.note = String(values.note || '').trim();
              renderKeypad();
            }
          },
        }),
      );
    }

    function pickerGrid(label, items, current, onPick, fallbackIcon) {
      const wrap = el('div', {}, [el('p', { class: 'picker__label', text: label })]);
      const grid = el('div', { class: 'picker__grid' });
      for (const item of items) {
        grid.append(
          el('button', { type: 'button', class: `pickcell${item.id === current ? ' is-active' : ''}`, onclick: () => onPick(item.id) }, [
            el('span', {
              class: 'pickcell__icon',
              style: item.color ? { background: `${item.color}22`, color: item.color } : null,
              text: item.icon || fallbackIcon || '💳',
            }),
            el('span', { class: 'pickcell__name', text: item.name }),
          ]),
        );
      }
      wrap.append(grid);
      return wrap;
    }

    function renderKeypadPicker() {
      const pad = state.keypad;
      dom.keypadPicker.textContent = '';
      if (pad.type === 'transfer') {
        const accounts = store.accounts();
        dom.keypadPicker.append(
          pickerGrid('从哪个账户转出', accounts, pad.accountId, (id) => {
            state.keypad.accountId = id;
            renderKeypad();
          }),
          pickerGrid('转到哪个账户', accounts, pad.toAccountId, (id) => {
            state.keypad.toAccountId = id;
            renderKeypad();
          }),
        );
        return;
      }
      const kind = pad.type === 'income' ? 'income' : 'expense';
      const categories = store.categories(kind);
      if (!pad.categoryId && categories.length) pad.categoryId = categories[0].id;
      dom.keypadPicker.append(
        pickerGrid('选择分类', categories, pad.categoryId, (id) => {
          state.keypad.categoryId = id;
          renderKeypad();
        }),
      );
    }

    function renderKeypadPad() {
      if (keypadPadBuilt) return;
      dom.keypadPad.textContent = '';
      for (const key of KEYPAD_KEYS) {
        const label = key === 'back' ? '⌫' : key === 'ok' ? '完成' : key === 'clear' ? '清空' : key;
        dom.keypadPad.append(
          el('button', {
            type: 'button',
            class: `key${key === 'ok' ? ' key--ok' : key === 'back' || key === 'clear' ? ' key--muted' : ''}`,
            text: label,
            onclick: () => pressKeypad(key),
          }),
        );
      }
      keypadPadBuilt = true;
    }

    function pressKeypad(key) {
      const pad = state.keypad;
      if (!pad) return;
      if (key === 'ok') {
        saveKeypad();
        return;
      }
      if (key === 'back') {
        pad.amount = pad.amount.slice(0, -1);
        renderKeypad();
        return;
      }
      if (key === 'clear') {
        pad.amount = '';
        renderKeypad();
        return;
      }
      if (key === '.') {
        if (pad.amount.includes('.')) return;
        pad.amount = `${pad.amount || '0'}.`;
        renderKeypad();
        return;
      }
      const decimals = pad.amount.split('.')[1];
      if (decimals && decimals.length >= 2) return;
      if (pad.amount.replace('.', '').length >= 9) return;
      pad.amount = pad.amount === '0' ? key : `${pad.amount}${key}`;
      renderKeypad();
    }

    async function saveKeypad() {
      const pad = state.keypad;
      if (!pad) return;
      const amount = Number(pad.amount);
      if (!(amount > 0)) {
        toast('金额要大于 0', { tone: 'error' });
        return;
      }
      if (pad.type === 'transfer' && (!pad.toAccountId || pad.accountId === pad.toAccountId)) {
        toast('转出和转入不能是同一个账户', { tone: 'error' });
        return;
      }
      if (pad.type !== 'transfer' && !pad.categoryId) {
        toast('先选一个分类', { tone: 'error' });
        return;
      }
      const payload = {
        type: pad.type,
        amount,
        date: pad.date,
        time: pad.time,
        categoryId: pad.type === 'transfer' ? '' : pad.categoryId,
        accountId: pad.accountId,
        toAccountId: pad.type === 'transfer' ? pad.toAccountId : '',
        note: pad.note,
      };
      const editing = pad.id;
      if (editing) await store.updateLedger(editing, payload);
      else await store.addLedger(payload);
      closeKeypad();
      toast(editing ? '已更新' : '已记一笔', { tone: 'success' });
    }

    async function deleteKeypadEntry() {
      const pad = state.keypad;
      if (!pad || !pad.id) return;
      const id = pad.id;
      closeKeypad();
      await store.removeLedger(id);
      toast('已删除这笔', { tone: 'success' });
    }

    function renderPreview() {
      const text = dom.fContent.value.trim();
      dom.preview.innerHTML = text
        ? model.renderMarkdown(text)
        : '<p class="preview__empty">还没有内容，切回编辑写点什么吧。</p>';
    }

    function setStatus(text) {
      dom.status.textContent = text;
    }

    function readForm(base) {
      return {
        ...base,
        date: model.isValidDateKey(dom.fDate.value) ? dom.fDate.value : base.date,
        title: dom.fTitle.value,
        content: dom.fContent.value,
        tags: model.normalizeTags(dom.fTags.value),
        updatedAt: Date.now(),
      };
    }

    function markDirty() {
      state.dirty = true;
      setStatus('正在编辑…');
      autosave();
    }

    async function saveCurrent() {
      const base = currentEntry();
      if (!base) return null;
      const next = readForm(base);
      if (state.draft && model.isEmptyEntry(next) && !next.tags.length) {
        setStatus('还没写内容');
        return null;
      }
      const saved = await store.save(next);
      state.draft = null;
      state.selectedId = saved.id;
      state.dirty = false;
      settings = Diary.settings.saveSettings({ lastEntryId: saved.id });
      setStatus(`已保存 ${model.toTimeKey(saved.updatedAt)}`);
      renderEditorMeta(saved);
      renderEditor();
      return saved;
    }

    const autosave = debounce(() => {
      saveCurrent();
    }, AUTOSAVE_DELAY);

    function flushSave() {
      if (!state.dirty) return;
      autosave.cancel();
      autosave.flush();
    }

    async function flushPending() {
      if (!state.dirty) return;
      autosave.cancel();
      await saveCurrent();
    }

    async function selectEntry(id, options) {
      await flushPending();
      const entry = store.get(id);
      if (!entry) {
        await closeEditor();
        return;
      }
      state.draft = null;
      state.selectedId = id;
      state.dirty = false;
      settings = Diary.settings.saveSettings({ lastEntryId: id });
      fillForm(entry);
      renderEditor();
      renderTimeline();
      if (options && options.fromPoint) animateEditorIn(options.fromPoint);
      if (options && options.swipe) animateEntrySwitch(options.swipe);
      if (options && options.focus) focusField(options.focus);
    }

    /** 点击处的蓝紫色水波纹 */
    function playTapRipple(x, y) {
      if (!isMobile()) return;
      const ripple = el('span', { class: 'tap-ripple' });
      ripple.style.left = `${Math.round(x)}px`;
      ripple.style.top = `${Math.round(y)}px`;
      document.body.append(ripple);
      setTimeout(() => ripple.remove(), 560);
    }

    /** 取点击坐标（键盘触发或合成事件没有坐标时，退回元素中心） */
    function pointFromEvent(event, element) {
      if (event && typeof event.clientX === 'number' && (event.clientX || event.clientY)) {
        return { x: event.clientX, y: event.clientY };
      }
      const rect = element && element.getBoundingClientRect ? element.getBoundingClientRect() : null;
      if (rect && (rect.width || rect.height)) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    }

    /** 自定义确认弹窗，替代浏览器原生 confirm（风格和其它弹窗一致） */
    function askConfirm(options) {
      const config = options || {};
      return new Promise((resolve) => {
        dom.confirmTitle.textContent = config.title || '确认';
        dom.confirmMessage.textContent = config.message || '';
        dom.btnConfirmOk.textContent = config.okText || '确定';
        dom.btnConfirmOk.className = `btn ${config.tone === 'primary' ? 'btn--primary' : 'btn--danger'}`;

        const finish = (result) => {
          dom.btnConfirmOk.removeEventListener('click', onOk);
          dom.confirmDialog.removeEventListener('close', onClose);
          closeDialog(dom.confirmDialog);
          resolve(result);
        };
        const onOk = () => finish(true);
        const onClose = () => finish(false);

        dom.btnConfirmOk.addEventListener('click', onOk);
        dom.confirmDialog.addEventListener('close', onClose);
        openDialog(dom.confirmDialog);
      });
    }

    /** 列表 → 编辑器：编辑器从右往左滑入（点击处先冒一个小水波纹） */
    function animateEditorIn(point) {
      if (!point) return;
      playTapRipple(point.x, point.y);
      const node = dom.editor;
      if (!isMobile() || typeof node.animate !== 'function') return;
      node.animate(
        [
          { transform: 'translateX(100%)', opacity: 0.6 },
          { transform: 'translateX(0)', opacity: 1 },
        ],
        { duration: 360, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }

    /** 编辑器内左右滑动切换上/下一篇时的内容过渡 */
    function animateEntrySwitch(direction) {
      if (!isMobile()) return;
      const node = $('.editor__main');
      if (!node || typeof node.animate !== 'function') return;
      const from = direction > 0 ? 42 : -42;
      node.animate(
        [
          { opacity: 0.25, transform: `translateX(${from}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }

    async function startNewEntry(dateKey, fromPoint) {
      await flushPending();
      const draft = model.createEntry(Date.now());
      if (dateKey && model.isValidDateKey(dateKey)) draft.date = dateKey;
      state.draft = draft;
      state.selectedId = null;
      state.dirty = false;
      settings = Diary.settings.saveSettings({ lastEntryId: null });
      fillForm(draft);
      setStatus('新日记');
      renderEditor();
      renderTimeline();
      if (fromPoint) animateEditorIn(fromPoint);
      focusField(isMobile() ? 'content' : 'title');
    }

    async function closeEditor(options) {
      await flushPending();
      // 手机端：编辑器向右滑出（滑完再真正切回列表），列表在下面露出来
      if (isMobile() && currentEntry()) {
        dom.body.classList.add('is-editor-leaving');
        await new Promise((resolve) => setTimeout(resolve, 280));
        dom.body.classList.remove('is-editor-leaving');
      }
      state.draft = null;
      state.selectedId = null;
      renderEditor();
      renderTimeline();
      if (state.tab === 'calendar') renderCalendar();
      if (!(options && options.fromHistory)) goBackFrom('editor');
    }

    /** 手机端点日期块 = 唤起系统日期选择器（用的还是同一个 #fDate 输入框） */
    function openDatePicker() {
      const input = dom.fDate;
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch (error) {
          /* 某些环境不让直接唤起，回退到 click */
        }
      }
      input.click();
    }

    function focusField(which) {
      const node = which === 'title' ? dom.fTitle : dom.fContent;
      try {
        node.focus({ preventScroll: true });
      } catch (error) {
        node.focus();
      }
      if (node.setSelectionRange) {
        const end = node.value.length;
        try {
          node.setSelectionRange(end, end);
        } catch (error) {
          /* 某些类型不支持选区 */
        }
      }
    }

    async function togglePin() {
      const base = currentEntry();
      if (!base) return;
      const saved = await store.save({ ...readForm(base), pinned: !base.pinned });
      state.draft = null;
      state.selectedId = saved.id;
      state.dirty = false;
      settings = Diary.settings.saveSettings({ lastEntryId: saved.id });
      fillForm(saved);
      toast(saved.pinned ? '已收藏' : '已取消收藏');
    }

    /** 找上/下一篇：direction = -1 更早（上一篇），+1 更新（下一篇）。 */
    function findNeighbor(direction) {
      if (!state.selectedId) return null;
      let list = visibleEntries();
      let index = list.findIndex((entry) => entry.id === state.selectedId);
      if (index < 0) {
        list = model.sortEntries(state.entries, 'desc');
        index = list.findIndex((entry) => entry.id === state.selectedId);
      }
      if (index < 0) return null;
      return list[index - direction] || null;
    }

    function renderNavButtons() {
      const prev = findNeighbor(-1);
      const next = findNeighbor(1);
      const prevButton = $('#btnPrevDay');
      const nextButton = $('#btnNextDay');
      prevButton.disabled = !prev;
      nextButton.disabled = !next;
      prevButton.title = prev ? `上一篇：${model.dateLabel(prev.date, today())}` : '已经是最早的一篇了';
      nextButton.title = next ? `下一篇：${model.dateLabel(next.date, today())}` : '已经是最新的一篇了';
    }

    async function goToNeighbor(direction) {
      await flushPending();
      const target = findNeighbor(direction);
      if (!target) {
        toast(direction === -1 ? '已经是最早的一篇了' : '已经是最新的一篇了');
        return;
      }
      await selectEntry(target.id, { swipe: direction });
    }

    async function deleteCurrent() {
      const base = currentEntry();
      if (!base) return;
      const persisted = store.get(base.id);
      if (!persisted) {
        state.draft = null;
        state.selectedId = null;
        renderEditor();
        return;
      }
      const confirmed = await askConfirm({
        title: '删除日记',
        message: `「${model.entryTitle(persisted)}」\n\n删除后无法恢复。`,
        okText: '删除',
      });
      if (!confirmed) return;
      await store.remove(persisted.id);
      autosave.cancel();
      state.dirty = false;
      state.draft = null;
      state.selectedId = null;
      const next = visibleEntries().find((entry) => entry.id !== persisted.id);
      if (next && !isMobile()) await selectEntry(next.id);
      else await closeEditor();
      toast('已删除', { tone: 'success' });
    }

    function setPreview(on) {
      state.preview = on;
      settings = Diary.settings.saveSettings({ preview: on });
      dom.preview.hidden = !on;
      dom.fContent.hidden = on;
      dom.btnPreview.setAttribute('aria-pressed', String(on));
      dom.btnPreview.classList.toggle('is-on', on);
      if (on) renderPreview();
      else focusField('content');
    }

    /* -------------------------------------------------------------- 事件 */

    function bindEvents() {
      $('#btnNew').addEventListener('click', (event) => startNewEntry(null, pointFromEvent(event, event.currentTarget)));
      $('#btnBack').addEventListener('click', () => closeEditor());
      $('#btnDelete').addEventListener('click', () => deleteCurrent());
      $('#btnPin').addEventListener('click', () => togglePin());
      $('#btnPreview').addEventListener('click', () => setPreview(!state.preview));
      dom.btnSaveMobile.addEventListener('click', async () => {
        autosave.cancel();
        // 先收起软键盘，否则 toast 会被键盘盖住看不见
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        const saved = await saveCurrent();
        if (!saved) return;
        toast(`已保存 ${model.toTimeKey(saved.updatedAt)}`, { tone: 'success' });
        // 保存后自动返回列表（"已保存"的提示动画照旧）
        await closeEditor();
      });
      dom.btnPickDate.addEventListener('click', () => openDatePicker());

      // 待办
      dom.btnTodoAdd.addEventListener('click', () => void submitTodo('card'));
      dom.todoInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void submitTodo('card');
      });
      dom.btnClearDoneTodos.addEventListener('click', async () => {
        const count = await store.clearDoneTodos();
        if (count) toast(`已清除 ${count} 条已完成`, { tone: 'success' });
      });
      dom.btnTodoMore.addEventListener('click', () => openSubpage('todo'));
      dom.btnTodoBack.addEventListener('click', () => closeSubpage());
      dom.btnTodoPageAdd.addEventListener('click', () => void submitTodo('page'));
      dom.todoPageInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void submitTodo('page');
      });
      dom.btnTodoPageClear.addEventListener('click', async () => {
        const count = await store.clearDoneTodos();
        if (count) toast(`已清除 ${count} 条已完成`, { tone: 'success' });
      });
      dom.btnTodoGroups.addEventListener('click', () => void openGroupManager());

      // 记账
      dom.btnMoneyAdd.addEventListener('click', () => openKeypad({}));
      dom.btnMoneyStats.addEventListener('click', () => openSubpage('ledgerStats'));
      dom.btnMoneySetup.addEventListener('click', () => openSubpage('ledgerSetup'));
      dom.btnBookSwitch.addEventListener('click', () => void openBookSwitcher());
      dom.btnBookManage.addEventListener('click', () => void openBookDialog(store.activeBook()));
      dom.btnSetupBack.addEventListener('click', () => closeSubpage());
      dom.btnLedgerStatsBack.addEventListener('click', () => closeSubpage());
      dom.btnStatsBack.addEventListener('click', () => closeSubpage());
      dom.btnOpenStats.addEventListener('click', () => openSubpage('stats'));
      dom.btnExportCsv.addEventListener('click', exportLedgerCsv);
      dom.ledgerStatsRange.addEventListener('click', (event) => {
        const button = event.target.closest('[data-range]');
        if (!button) return;
        state.ledgerRange = button.dataset.range;
        renderLedgerStats();
      });

      // 金额键盘
      dom.btnKeypadClose.addEventListener('click', () => closeKeypad());
      dom.btnKeypadDelete.addEventListener('click', () => void deleteKeypadEntry());
      dom.keypadTypeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-ledger-type]');
        if (!button || !state.keypad) return;
        state.keypad.type = button.dataset.ledgerType;
        renderKeypad();
      });

      // 通用表单弹窗
      dom.formDialogOk.addEventListener('click', () => closeForm(collectForm()));
      dom.formDialogDelete.addEventListener('click', async () => {
        const context = formContext;
        if (!context || !context.config.onDelete) return;
        closeForm({ __delete: true });
        await context.config.onDelete();
      });
      dom.formDialog.addEventListener('close', () => {
        if (formContext) closeForm(null);
      });

      // 日历三态
      dom.calModeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-cal-mode]');
        if (!button) return;
        state.calendarMode = button.dataset.calMode;
        settings = Diary.settings.saveSettings({ calendarMode: state.calendarMode });
        renderCalendar();
      });

      dom.btnEditTags.addEventListener('click', () => {
        dom.tagDialogInput.value = dom.fTags.value;
        openDialog(dom.tagDialog);
        setTimeout(() => dom.tagDialogInput.focus(), 60);
      });
      dom.btnTagSave.addEventListener('click', () => {
        dom.fTags.value = dom.tagDialogInput.value;
        closeDialog(dom.tagDialog);
        renderTagSummary();
        markDirty();
        autosave.flush();
      });
      $('#btnCardPin').addEventListener('click', async () => {
        const entry = store.get(state.actionEntryId);
        closeDialog(dom.cardDialog);
        if (!entry) return;
        await store.save({ ...entry, pinned: !entry.pinned, updatedAt: entry.updatedAt });
        renderTimeline();
        toast(entry.pinned ? '已取消收藏' : '已收藏');
      });
      $('#btnCardDelete').addEventListener('click', async () => {
        const entry = store.get(state.actionEntryId);
        closeDialog(dom.cardDialog);
        if (!entry) return;
        const confirmed = await askConfirm({
          title: '删除日记',
          message: `「${model.entryTitle(entry)}」\n\n删除后无法恢复。`,
          okText: '删除',
        });
        if (!confirmed) return;
        await store.remove(entry.id);
        autosave.cancel();
        state.dirty = false;
        if (state.selectedId === entry.id) {
          state.draft = null;
          state.selectedId = null;
          renderEditor();
        }
        renderTimeline();
        toast('已删除', { tone: 'success' });
      });
      $('#btnPrevDay').addEventListener('click', () => goToNeighbor(-1));
      $('#btnNextDay').addEventListener('click', () => goToNeighbor(1));
      $('#btnRandom').addEventListener('click', openRandomEntry);

      for (const button of $$('[data-tab]', $('#tabbar'))) {
        button.addEventListener('click', () => {
          // 底部图标的水波纹
          button.classList.remove('is-rippling');
          void button.offsetWidth;
          button.classList.add('is-rippling');
          setTimeout(() => button.classList.remove('is-rippling'), 460);
          setTab(button.dataset.tab);
        });
      }

      $('#btnSearch').addEventListener('click', () => toggleSearch());
      $('#btnClearSearch').addEventListener('click', () => {
        dom.search.value = '';
        state.query = '';
        renderTimeline();
        dom.search.focus();
      });
      const searchDebounced = debounce(() => {
        state.query = dom.search.value;
        renderTimeline();
      }, 120);
      dom.search.addEventListener('input', () => searchDebounced());

      $('#btnFilter').addEventListener('click', () => toggleFilter());
      dom.filterOptions.addEventListener('click', (event) => {
        const button = event.target.closest('[data-filter]');
        if (!button) return;
        state.filter = button.dataset.filter;
        settings = Diary.settings.saveSettings({ timelineFilter: state.filter });
        renderFilterOptions();
        renderTimeline();
      });
      dom.filterTags.addEventListener('click', (event) => {
        const button = event.target.closest('[data-tag]');
        if (!button) return;
        state.tag = state.tag === button.dataset.tag ? null : button.dataset.tag;
        renderFilterTags();
        renderTimeline();
      });

      $('#btnPrevMonth').addEventListener('click', () => {
        renderCalendar(goToMonth(state.calYear, state.calMonth - 1));
      });
      $('#btnNextMonth').addEventListener('click', () => {
        renderCalendar(goToMonth(state.calYear, state.calMonth + 1));
      });
      bindCalendarSwipe();
      bindEditorSwipe();
      $('#btnCalToday').addEventListener('click', () => {
        const now = model.parseDateKey(today()) || new Date();
        setCalendarMonth(now.getFullYear(), now.getMonth());
        state.calSelected = today();
        renderCalendar();
      });
      $('#btnCalPick').addEventListener('click', pickMonth);

      dom.themeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-theme-value]');
        if (!button) return;
        settings = Diary.settings.saveSettings({ theme: button.dataset.themeValue });
        Diary.settings.applySettings(settings);
        renderProfile();
      });
      dom.fontGroup.addEventListener('click', (event) => {
        const button = event.target.closest('[data-font-value]');
        if (!button) return;
        settings = Diary.settings.saveSettings({ fontSize: button.dataset.fontValue });
        Diary.settings.applySettings(settings);
        renderProfile();
      });

      $('#btnExportJson').addEventListener('click', exportJson);
      $('#btnExportMarkdown').addEventListener('click', exportMarkdown);
      $('#btnExportBundle').addEventListener('click', exportBundle);
      $('#btnImport').addEventListener('click', () => dom.fileInput.click());
      dom.fileInput.addEventListener('change', handleFilePicked);
      $('#btnImportRead').addEventListener('click', () => readPendingImport());
      $('#btnImportMerge').addEventListener('click', () => applyImport('merge'));
      $('#btnImportReplace').addEventListener('click', () => applyImport('replace'));
      $('#btnClearAll').addEventListener('click', clearAll);

      const wrap = $('.editor__wrap');
      wrap.addEventListener('input', (event) => {
        if (event.target === dom.preview) return;
        if (state.preview) renderPreview();
        markDirty();
      });
      wrap.addEventListener('focusout', () => flushSave());
      wrap.addEventListener('submit', (event) => event.preventDefault());

      dom.lightbox.addEventListener('click', () => {
        dom.lightbox.hidden = true;
        dom.lightboxImage.src = '';
      });

      window.addEventListener('beforeprint', renderPreview);
      // 系统返回键 / 侧滑返回：先收起最上面那一层（二级页 / 编辑器），而不是直接退出 App
      window.addEventListener('popstate', handlePopState);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushSave();
      });
      window.addEventListener('beforeunload', flushSave);
      window.addEventListener('pagehide', flushSave);
      document.addEventListener('keydown', onKeydown);
      window.addEventListener(
        'resize',
        debounce(() => {
          paintIcons();
          applyPlatformText();
          renderTimeline();
          if (state.tab === 'money') renderMoney();
        }, 250),
      );
      bindInstallPrompt();
    }

    function onKeydown(event) {
      const meta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (meta && key === 'n') {
        event.preventDefault();
        startNewEntry();
        return;
      }
      if (meta && key === 's') {
        event.preventDefault();
        flushSave();
        return;
      }
      if (meta && key === 'k') {
        event.preventDefault();
        if (!state.searchOpen) toggleSearch(true);
        dom.search.focus();
        dom.search.select();
        return;
      }
      if (event.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      if (!dom.lightbox.hidden) {
        dom.lightbox.hidden = true;
        return;
      }
      if (state.keypad) {
        closeKeypad();
        return;
      }
      if (state.subpage) {
        closeSubpage();
        return;
      }
      if (state.filterOpen) {
        toggleFilter(false);
        return;
      }
      if (state.searchOpen) {
        toggleSearch(false);
        return;
      }
      const tag = document.activeElement ? document.activeElement.tagName : '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (dom.body.dataset.view === 'editor') closeEditor();
    }

    function toggleSearch(force) {
      state.searchOpen = force === undefined ? !state.searchOpen : force;
      dom.searchBar.hidden = !state.searchOpen;
      if (state.searchOpen) {
        dom.search.focus();
      } else {
        dom.search.value = '';
        state.query = '';
        renderTimeline();
      }
    }

    function toggleFilter(force) {
      state.filterOpen = force === undefined ? !state.filterOpen : force;
      dom.filterBar.hidden = !state.filterOpen;
      if (state.filterOpen) {
        renderFilterOptions();
        renderFilterTags();
      }
    }

    function renderFilterOptions() {
      dom.filterOptions.textContent = '';
      for (const item of Diary.settings.FILTERS) {
        dom.filterOptions.append(
          el('button', {
            type: 'button',
            class: `chip${state.filter === item.key ? ' is-active' : ''}`,
            text: item.label,
            dataset: { filter: item.key },
          }),
        );
      }
    }

    function renderFilterTags() {
      const tags = model.collectTags(state.entries, 16);
      dom.filterTags.textContent = '';
      if (!tags.length) {
        dom.filterTags.append(el('span', { class: 'hint', text: '还没有标签' }));
        return;
      }
      for (const { tag, count } of tags) {
        dom.filterTags.append(
          el('button', {
            type: 'button',
            class: `chip chip--tag${state.tag === tag ? ' is-active' : ''}`,
            text: `#${tag} ${count}`,
            dataset: { tag },
          }),
        );
      }
    }

    function pickMonth() {
      const input = document.createElement('input');
      input.type = 'month';
      input.value = model.monthKey(state.calYear, state.calMonth);
      Object.assign(input.style, { position: 'fixed', left: '-9999px', opacity: '0' });
      document.body.append(input);
      input.addEventListener('change', () => {
        const match = /^(\d{4})-(\d{2})$/.exec(input.value);
        if (match) {
          renderCalendar(goToMonth(Number(match[1]), Number(match[2]) - 1));
        }
        input.remove();
      });
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          return;
        } catch (error) {
          /* 回退到点击 */
        }
      }
      input.click();
    }

    function openRandomEntry() {
      const pool = state.entries.filter((entry) => entry.id !== state.selectedId);
      if (!pool.length) {
        toast('还没有别的日记可以翻');
        return;
      }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      selectEntry(picked.id, { focus: 'content' });
      toast(`翻到 ${model.dateLabel(picked.date, today())} 的日记`);
    }

    /* ---------------------------------------------------------- 导入导出 */

    function exportJson() {
      if (!state.entries.length) {
        toast('还没有日记可以导出', { tone: 'error' });
        return;
      }
      const payload = store.exportPayload();
      downloadFile(`日记备份-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
      toast('已导出 JSON（不含图片，图片请用完整备份）', { tone: 'success', duration: 3600 });
    }

    function exportMarkdown() {
      if (!state.entries.length) {
        toast('还没有日记可以导出', { tone: 'error' });
        return;
      }
      downloadFile(`日记-${today()}.md`, store.exportMarkdown(), 'text/markdown;charset=utf-8');
      toast('已导出 Markdown', { tone: 'success' });
    }

    function exportLedgerCsv() {
      if (!store.ledgerList().length) {
        toast('还没有记账可以导出', { tone: 'error' });
        return;
      }
      // 带 BOM，Excel 打开中文才不乱码
      downloadFile(`记账-${today()}.csv`, `\ufeff${store.exportLedgerCsv()}`, 'text/csv;charset=utf-8');
      toast('已导出记账 CSV', { tone: 'success' });
    }

    async function exportBundle() {
      if (!state.entries.length) {
        toast('还没有日记可以导出', { tone: 'error' });
        return;
      }
      const button = $('#btnExportBundle');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '正在打包…';
      try {
        const bytes = await store.exportBundle(({ done }) => {
          button.textContent = `正在打包… ${done}`;
        });
        downloadFile(`日记完整备份-${today()}.zip`, new Blob([bytes], { type: 'application/zip' }));
        toast('已导出完整备份（含图片）', { tone: 'success' });
      } catch (error) {
        toast(`导出失败：${error.message}`, { tone: 'error', duration: 4200 });
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }

    const KIND_LABEL = { mbk: '加密备份（.mbk）', zip: 'ZIP 备份', json: 'JSON 备份', text: '文本文件' };

    async function handleFilePicked() {
      const file = dom.fileInput.files && dom.fileInput.files[0];
      dom.fileInput.value = '';
      if (!file) return;
      try {
        const buffer = new Uint8Array(await file.arrayBuffer());
        const info = Diary.importer.detect(buffer, file.name);
        state.pendingImport = { file, buffer, info, parsed: null };
        dom.importPasswordRow.hidden = !info.needsPassword;
        $('#importHint').hidden = info.kind !== 'mbk';
        dom.importPassword.value = '';
        dom.importProgress.textContent = '';
        dom.importSummary.textContent = `「${file.name}」· ${model.formatBytes(buffer.length)} · ${
          KIND_LABEL[info.kind] || info.kind
        }${info.needsPassword ? '（需要密码）' : ''}`;
        setImportButtonsEnabled(false);
        openDialog(dom.importDialog);
        if (!info.needsPassword) await readPendingImport();
        else dom.importPassword.focus();
      } catch (error) {
        toast(`读取失败：${error.message}`, { tone: 'error', duration: 4200 });
      }
    }

    function setImportButtonsEnabled(enabled) {
      $('#btnImportMerge').disabled = !enabled;
      $('#btnImportReplace').disabled = !enabled;
    }

    async function readPendingImport() {
      const pending = state.pendingImport;
      if (!pending) return;
      const button = $('#btnImportRead');
      button.disabled = true;
      dom.importProgress.textContent = '正在解析…';
      try {
        const parsed = await Diary.importer.parseBackup({
          bytes: pending.buffer,
          filename: pending.file.name,
          // 手机输入法和粘贴经常会带上首尾空格，这里统一去掉
          password: dom.importPassword.value.trim() || undefined,
          includeMedia: dom.importMedia.checked,
          onProgress: ({ done, total }) => {
            dom.importProgress.textContent = `正在读取第 ${done}${total ? ` / ${total}` : ''} 条…`;
          },
        });
        pending.parsed = parsed;
        dom.importSummary.textContent =
          `「${pending.file.name}」里读到 ${parsed.entries.length} 篇日记` +
          (parsed.media.length ? `、${parsed.media.length} 张图片` : '') +
          (parsed.warnings.length ? `，跳过 ${parsed.warnings.length} 条异常内容` : '') +
          `；当前已有 ${state.entries.length} 篇。`;
        if (!parsed.entries.length) {
          dom.importProgress.textContent = parsed.media.length
            ? '备份解开了，但没认出日记正文的格式（图片已识别）。把这份备份发我，我来适配。'
            : '没有从这个文件里读到日记内容。';
        } else if (parsed.warnings.length) {
          dom.importProgress.textContent = parsed.warnings.slice(0, 2).join('；');
        } else {
          dom.importProgress.textContent = '内容已就绪，选择「合并」或「覆盖」即可写入。';
        }
        setImportButtonsEnabled(parsed.entries.length > 0);
      } catch (error) {
        dom.importProgress.textContent =
          error.code === 'PASSWORD'
            ? '密码不对。注意区分大小写、不要有多余空格；加密备份的默认口令是 timenotes，留空会自动尝试。'
            : error.message;
        setImportButtonsEnabled(false);
      } finally {
        button.disabled = false;
      }
    }

    async function applyImport(mode) {
      const pending = state.pendingImport;
      if (!pending || !pending.parsed) return;
      const parsed = pending.parsed;
      if (mode === 'replace') {
        const ok = await askConfirm({
          title: '覆盖导入',
          message: `会先清空现有的 ${state.entries.length} 篇日记，然后写入 ${parsed.entries.length} 篇。`,
          okText: '覆盖',
        });
        if (!ok) return;
      }
      closeDialog(dom.importDialog);
      state.pendingImport = null;
      toast('正在写入…', { duration: 1500 });
      try {
        const result = await store.importResult(parsed, mode);
        state.entries = store.list();
        renderTimeline();
        renderCalendar();
        renderMoney();
        renderTodoCard();
        if (mode === 'replace') {
          toast(`已覆盖导入 ${parsed.entries.length} 篇`, { tone: 'success' });
        } else {
          toast(`合并完成：新增 ${result.added} 篇，更新 ${result.updated} 篇，跳过 ${result.skipped} 篇`, {
            tone: 'success',
            duration: 4200,
          });
        }
      } catch (error) {
        toast(`导入失败：${error.message}`, { tone: 'error', duration: 5000 });
      }
    }

    async function clearAll() {
      if (!state.entries.length) {
        toast('本来就没有日记');
        return;
      }
      const confirmed = await askConfirm({
        title: '清空全部日记',
        message: `共 ${state.entries.length} 篇，删除后无法撤销，建议先导出备份。`,
        okText: '清空',
      });
      if (!confirmed) return;
      autosave.cancel();
      state.dirty = false;
      await store.clear();
      state.draft = null;
      state.selectedId = null;
      state.entries = store.list();
      settings = Diary.settings.saveSettings({ lastEntryId: null });
      renderEditor();
      renderTimeline();
      renderCalendar();
      renderMoney();
      renderTodoCard();
      toast('已清空全部日记', { tone: 'success' });
    }

    function bindInstallPrompt() {
      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        state.installPrompt = event;
        renderProfile();
      });
      dom.btnInstall.addEventListener('click', async () => {
        const prompt = state.installPrompt;
        if (!prompt) return;
        prompt.prompt();
        const choice = await prompt.userChoice;
        state.installPrompt = null;
        renderProfile();
        toast(choice && choice.outcome === 'accepted' ? '安装中…' : '已取消安装');
      });
      window.addEventListener('appinstalled', () => {
        state.installPrompt = null;
        renderProfile();
        toast('已安装到本机，可以从主屏幕直接打开', { tone: 'success' });
      });
    }

    boot();

    return {
      /**
       * 系统返回键 / 侧滑返回：先关弹窗和二级页，再收起编辑器。
       * 返回 true 表示这一层已经处理掉了，不要让 App 退出。
       */
      handleBack() {
        const dialog = document.querySelector('dialog[open]');
        if (dialog) {
          closeDialog(dialog);
          return true;
        }
        if (state.keypad) {
          closeKeypad();
          return true;
        }
        if (state.subpage) {
          closeSubpage();
          return true;
        }
        if (currentEntry()) {
          closeEditor();
          return true;
        }
        return false;
      },
    };
  }

  Diary.app = { start };
})(typeof globalThis !== 'undefined' ? globalThis : this);
