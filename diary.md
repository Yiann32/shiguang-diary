# 拾光日记 · 交接文档

> 写给完全没有上下文的新会话。读完这一份就能开工，其余细节看 `README.md`。
> 最后更新：2026-10-01

## 0. 速览

| 项 | 值 |
| --- | --- |
| 技术栈 | 零依赖、无构建：原生 HTML/CSS + 经典 `<script>`；Android 用 Capacitor 8 |
| 模块 | 日记（时间线 / 日历 / 编辑器）、记账（账本 / 分类 / 账户 / 预算 / 周期）、待办、约稿（订单尾款 / 待收款项 / 资金压力） |
| 数据 | 全部本地（IndexedDB，逐级降级到 localStorage → 内存），不联网 |
| 测试 | `npm test` 单元测试；`npm run smoke` 浏览器端到端（需本机 Chrome / Edge） |
| 产物 | `npm run build:native` 生成 `www/`，再交给 Capacitor 打 APK |

**改完代码的出包流程**

```bash
npm test && npm run smoke        # 先跑测试
npm run build:native             # 必须！js/ 的改动只有这一步才进 www/
npx cap sync android
cd android && ./gradlew assembleDebug     # 产物 app/build/outputs/apk/debug/app-debug.apk
```

Windows 上用 `.\gradlew.bat`；命令行构建需要与 Gradle 兼容的 JDK（Android Studio 自带的 JBR 最稳）。

## 1. 界面结构

底部四个页签：**时间线 / 日历 · FAB · 记账 / 我的**（FAB 固定是「写日记」）。

- **时间线**：卡片列表 + 顶部「待办」小卡片（点标题进待办二级页）。
- **日历**：右上角**一颗四态循环按钮**，点一下换一档「日记 → 记账 → 待办 → 排单」，每次切换弹一个绿色 toast 报状态；格子与下面的当天详情跟着模式变。左上角日期 = 选年月（原来那颗 shuffle 按钮已删），右边保留「回到今天」。
  - 日记模式：有记录的日子带底纹
  - 记账模式：格子里显示当天支出金额（`formatMoneyShort` 缩写），有收入的日子加一个 `calcellsig` 小点
  - 待办模式：格子里显示 `未完成/总数`（`caldot`，全部完成用 `caldot--all-done`，逾期用 `caldot--overdue`），当天详情含已完成的
  - 排单模式：**两行标记** —— 约稿按**稿件截止日**显示当天要交的份数（`caldot--schedule`，拖期未完稿 `caldot--overdue`）；待收款项按到账日显示笔数（`caldot--income`，浅红）。点进去上块「要交的稿」、下块「预计收到」金额
  - 记账模式：格子右下角用 `calcellsq`（浅色小方块）标出当天要付的约稿尾款；详情区除流水外还会显示「约稿尾款预支出」（当天）与「本月尾款预支出」（没排到具体日期的 + 逾期的）
  - 四种模式的详情区顶部都有 `.daynew`（小加号），按当前模式在当前选中日期新建
- **记账**：本月概览（支出 / 收入 / 结余 + 预算进度）→ **约稿卡**（本月待付尾款 / 这个月预计收到 / 本月预计结余）→ 支出构成环形图 → 分类排行 → 按天分组的流水；右上角两个入口进「记账统计」和「账本设置」。右下角还有一个专属 FAB「记一笔」。
- **约稿专区**（二级页，从约稿卡进）：顶部三态「支出 / 收入 / 资金压力」。
  - 支出 = 约稿订单（付给画师的尾款），点行编辑，点行上的「付款」生成一笔支出流水
  - 收入 = 待收款项（甲方欠你的钱），点「收款」生成一笔收入流水
  - 资金压力 = 预计工资/其他收入/固定支出 + 自动带入的本月待付尾款，实时算结余
- **我的**：日记统计（二级页）、外观、备份与迁移、安装、关于。
- **二级页**：待办、日记统计、记账统计、账本设置，统一用 `.subpage`（从右侧滑入，`is-leaving` 滑出）。
- **金额键盘**：`.keypad` 全屏面板，分类九宫格 + 数字键盘，是唯一的记账录入入口（新增和编辑都走它）。

记账的保存逻辑在 `saveKeypad()`，编辑已有流水时会保留原来那条的 `time`。

## 2. 数据层

`DB_VERSION = 6`，IndexedDB 里的表：

| 表 | 内容 |
| --- | --- |
| `entries` | 日记（v1 起就有，结构没变过） |
| `media` | 图片二进制（按 id 存 blob） |
| `todos` / `todoGroups` | 待办与待办分组 |
| `books` | 账本 |
| `ledger` | 一笔一条的流水（v5 重建过，旧的两分类数据不再使用） |
| `categories` / `accounts` / `budgets` / `recurring` | 分类 / 账户 / 预算 / 周期记账规则 |
| `payables` | 约稿订单（稿件名 / 画师 / 总价 / 已付 / 稿件截止日 `deadline` / 尾款约定 `dueMonth`+`dueDate` / 是否完稿） |
| `receivables` | 待收款项（甲方 / 稿件 / 应收 / 已收 / 约定到账日，`dueDate` 留空 = 时间未定） |

要点：

- 记账相关的表都带 `bookId`，按当前账本隔离；**日记与待办不分账本**，全局共享。
- 第一次运行（或账本被删光）会自动建「日常账本」，并把内置分类与一个「现金」账户写进去。
- 每个表的读写方法由 `js/db.js` 里的 `SIMPLE_STORES` 表驱动，用 `getAllXxx / putXxx / putManyXxx / removeXxx / clearXxx` 命名；三个适配器（IndexedDB / localStorage / 内存）共用同一套接口，**加新表时三个适配器都要补**。
- 周期记账在 `store.init()` 和进入记账页时调 `materializeRecurring(today)` 补生成，靠 `ruleId + occurrenceKey` 幂等去重；`addRecurring` / `updateRecurring` 本身**不**补生成（否则测试没法用一个固定的 `today` 断言）。
- 转账不计入收支合计（`sumLedger`），但会同时改两个账户的余额（`accountBalances`）。
- `ensureBook()` 会**按名字补齐缺失的内置分类**（每个账本都跑一遍）：老库升级后才会自动补上「约稿 / 约稿收入」这类新预置。**别再改回「没有分类才灌」**，否则约稿付款会落到第一个分类（餐饮）——这个 bug 已经出现过一次。
- 待收款项 ↔ 待办联动在 store 层（`syncReceivableTodo`）：填了到账日就建/更新待办，清空日期就撤掉，收齐自动完成，删待收连带删待办。待办靠 `receivableId` 反查。
- 约稿订单有两套时间，别搞混：`deadline` 是**稿件截止日**（日历排单唯一依据），`dueMonth` / `dueDate` 是**尾款什么时候付**（专区按月分组用）。
- 只有从订单上点「付款 / 收款」才会写 `paid` / `received`；手工在流水里记一笔不会回写订单。付款生成的支出流水带 `payableId`。
- 导出 v3 会自动带上账本、分类、账户、预算、周期规则、待办与流水；导入兼容 v2（只有日记）。

## 3. 导入口令

- 默认口令常量是 `timenotes`，在 `js/importer.js` 的 `BUILTIN_PASSWORDS` 里，和更早的历史口令放在一起。
- `parseBackup()` 的顺序是：用户输入 → 内置候选依次试，谁先解开用谁，并把命中的口令挂在结果的 `password` 字段上。所以老备份**不手输也能导入**。
- 只有所有候选都失败才抛 `code === 'PASSWORD'`。

## 4. 绝对不能重踩的坑

### 架构

1. **不要改回 `<script type="module">`**：`file://` 下被 CORS 拦，「按钮全哑」。保持经典脚本 + `Diary` 命名空间（`index.html` 底部按顺序加载）。
2. **`[hidden]` 会被 `display:flex` 覆盖**，空状态和编辑器会同时显示。CSS 顶部的 `[hidden] { display: none !important }` 别删。
3. 排序并列项必须用 `createdAt`（不是 `updatedAt`），否则编辑旧日记会顶到第一条。标签归一化必须「先 trim 再剥 `#`」。
4. `ui.el(tag, props, children)` 的**第三个参数才是子节点**。把数组传给 `Element.append()` 会被当成字符串拼进去（曾因此在日历格子上踩坑，格子全空）。
5. **`<dialog>` 的 `close` 事件是异步派发的**：通用表单弹窗（`openForm` / `closeForm`）连续开关两个表单时，上一个表单的 close 事件可能在新表单打开之后才到，会把新表单直接关掉、并让它的 Promise 变成「取消」。所以监听里必须判断 `formContext && !dom.formDialog.open` 才算取消（已踩过坑）。
6. 动画引用的类名要和 DOM 一致，否则函数静默 return，动画完全不生效。
7. 关键动画用 Web Animations API 驱动（个别 WebView 不触发 CSS transition）。
8. 启动画面要同时改 Android 启动主题背景和 HTML `.boot` overlay，否则闪白；截图脚本每次 `reload` 后都要等 `#bootSplash` 移除。

### 移动端交互

9. **返回键/侧滑返回不能靠 WebView 历史**：必须用 `@capacitor/app` 的 `backButton`（见 `js/main.js`），`app.js` 里靠 `pushHistoryEntry('editor' | 'subpage' | 'keypad')` 分层收起。
10. **别用 `window.confirm()`**：WebView 里是带网址的浏览器弹窗。用应用内 `#confirmDialog` + `askConfirm()`。
11. 文件选择器不要写 `accept`：Android 按 MIME 过滤会把 `.mbk` 藏起来。
12. 长按卡片要 `user-select: none` + `-webkit-touch-callout: none`，且长按后要吞掉紧跟的 click。
13. 金额键盘的顶部会盖住内容，表单弹窗要能叠在它上面（`<dialog>.showModal()` 走浏览器 top layer，天然在上面）。
14. toast 抗软键盘遮挡：保存前先 blur 收起键盘。

### 测试与工具

15. 别用 `node --test tests/`（受限环境里 spawn 被拒），用 `npm test`。
16. 别用 `--dump-dom --virtual-time-budget` 判断功能（虚拟时钟会让 IndexedDB 回调不跑，产生假阴性），用 CDP 真实驱动（`tools/cdp.mjs`）。
17. `tools/cdp.mjs` 启动浏览器时同时读 stderr 和 `DevToolsActivePort`：Windows 上的 Edge 启动器会立刻退出，只读 stderr 会误判「浏览器提前退出」。
18. 浏览器脚本与 git 推送在受限沙箱里都要**申请沙箱外权限**。
19. **`参考/` 绝不能提交**（含真实日记截图与正文），`.gitignore` 已排除；`.mbk` 样本、`www/`、`android/`、`node_modules/` 也不进仓库。

### Android 打包

20. **项目路径不能有中文**（AGP 直接失败）。
21. `local.properties` 里的 `sdk.dir` 反斜杠要双写（`D\:\\Android\\Sdk`），单写会被 properties 当转义吃掉。
22. 搬过 `GRADLE_USER_HOME` 后要清 `caches/<版本>/transforms`、`fileHashes`、`build-cache-1`、`daemon`，并先 `gradlew --stop`。
23. `npx cap add android` 之后必须再跑 `node tools/setup-android.mjs`（图标 + 国内镜像）。
24. **改 `js/` 后必须 `npm run build:native`**，进包的是 `www/`。

## 5. 每轮怎么推进

1. 接到需求 → 改代码 → `npm test` → `npm run smoke` → `npm run build:native` → 打包 APK → 让用户在真机验证。
2. 界面改动大时顺手 `npm run screenshots`，用生成的图做一次视觉自查。
3. 每轮提交一次；攒几轮后提醒用户推送。

**常用调整点**

| 想改什么 | 去哪 |
| --- | --- |
| 配色 / 圆角 / 字号 | `css/style.css` 顶部的 CSS 变量 |
| 手机端顶部下移量 | 同文件手机媒体查询里的 `--top-shift` |
| 日记排序 | `js/model.js` 的 `sortEntries` |
| 待办排序 / 优先级 | `js/model.js` 的 `sortTodos` / `TODO_PRIORITIES` |
| 待办完成统计口径 | `js/model.js` 的 `todoGroupStats`（近 7 天 / 本月 / 全部）与 `todoDoneByDay` |
| 约稿状态与分组 | `js/model.js` 的 `commissionPayLabel` / `commissionGroups` / `commissionDueMap` |
| 待收款项汇总 | `js/model.js` 的 `receivableTotals` / `clientStats` |
| 日历四态的顺序与图标 | `js/app.js` 的 `CAL_MODES`（改顺序/加图标只动这一处） |
| 预置分类 | `js/model.js` 的 `DEFAULT_EXPENSE_CATEGORIES` / `DEFAULT_INCOME_CATEGORIES` |
| 周期记账的日期推算 | `js/model.js` 的 `recurringDates` |
| 导入字段映射 | `js/importer.js` 的 `mapRecord` / `parseDiaryContent` |
| 界面图标 | `js/ui.js` 的 `ICONS` |
| 应用图标 | `tools/make-icons.mjs` + `npm run icons`，再 `node tools/setup-android.mjs` |

**明确不做**：心情系统、天气、编辑器富文本工具条、回收站、云同步、第三方账单导入、本地通知提醒。
