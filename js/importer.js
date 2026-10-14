/**
 * 备份导入：自动识别格式并转成内部条目结构。
 *
 * 目前支持：
 *  - .mbk（WinZip AES-256 加密的 ZIP 备份，含图片）
 *  - 普通 .zip（内含 entries.json / 任意 .json / .txt / .md / .html）
 *  - 本应用导出的 JSON、以及各种常见的 JSON 结构
 *  - 纯文本 / Markdown
 */
(function (root) {
  'use strict';

  const Diary = (root.Diary = root.Diary || {});

  const textDecoder = new TextDecoder('utf-8');
  const textEncoder = new TextEncoder();

  const CONTENT_KEYS = ['content', 'text', 'body', 'diarycontent', 'diary_content', 'note', 'notes', 'message', 'post', 'desc', 'description', 'summary', 'html', 'smallcontent', '内容', '正文', '日记内容'];
  const TITLE_KEYS = ['title', 'subject', 'name', 'head', 'heading', '标题', '题目'];
  const DATE_KEYS = ['date', 'day', 'diarydate', 'diary_date', 'diarytime', 'createdate', 'createddate', 'createtime', 'showtime', 'timestamp', 'time', 'datetime', 'datestr', 'date_str', 'recorddate', 'recordtime', 'updatedat', 'mtime', 'ctime', 'gmtcreate', '日期', '时间', '创建时间', '记录时间'];
  const TAG_KEYS = ['tags', 'tag', 'labels', 'label', 'labellist', 'taglist', 'tag_list', 'category', 'categories', '标签', '分类'];
  /* ---------------------------------------------------------------- 工具 */

  function toText(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }

  function lowerKeys(record) {
    const map = new Map();
    for (const key of Object.keys(record)) map.set(key.toLowerCase(), record[key]);
    return map;
  }

  function pick(map, keys) {
    for (const key of keys) {
      const value = map.get(key.toLowerCase());
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
  }

  function decodeEntities(text) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', hellip: '…', mdash: '—', middot: '·' };
    return text
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
      .replace(/&([a-z]+);/gi, (match, name) => (named[name.toLowerCase()] !== undefined ? named[name.toLowerCase()] : match));
  }

  /** 有些日记 App 把正文存成 HTML，这里转回可读文本。 */
  function htmlToText(html) {
    return decodeEntities(
      toText(html)
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, ' $1 ')
        .replace(/<[^>]+>/g, ''),
    )
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function looksLikeHtml(text) {
    return /<(p|div|br|span|img|a|h[1-6]|ul|ol|li|strong|em)\b[^>]*>/i.test(toText(text));
  }

  function normalizeTagValue(value) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) {
        if (item && typeof item === 'object') {
          result.push(item.name || item.label || item.title || item.tagName || item.id || '');
        } else {
          result.push(item);
        }
      }
      return result;
    }
    if (typeof value === 'object') {
      return Object.values(value).map((item) => (item && typeof item === 'object' ? item.name || item.label || '' : item));
    }
    return String(value).split(/[,，;；、|\n]+/);
  }

  /** 把各种日期写法统一成 { date, time, timestamp }。 */
  function normalizeDate(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = toText(value).trim();

    const build = (year, month, day, hour, minute, second) => {
      const date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour || 0),
        Number(minute || 0),
        Number(second || 0),
      );
      if (Number.isNaN(date.getTime())) return null;
      if (date.getFullYear() < 1900 || date.getFullYear() > 2200) return null;
      return { date: Diary.model.toDateKey(date), time: Diary.model.toTimeKey(date), timestamp: date.getTime() };
    };

    // 纯数字：8 位当 YYYYMMDD，10 位当秒级时间戳，13 位当毫秒级时间戳
    if (typeof value === 'number' || /^\d{8,}$/.test(text)) {
      const digits = text;
      if (digits.length === 8) {
        const asDate = build(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
        if (asDate) return asDate;
      }
      const ms = digits.length <= 10 ? Number(digits) * 1000 : Number(digits);
      const stamp = new Date(ms);
      if (!Number.isNaN(stamp.getTime()) && stamp.getFullYear() > 1970 && stamp.getFullYear() < 2200) {
        return {
          date: Diary.model.toDateKey(stamp),
          time: Diary.model.toTimeKey(stamp),
          timestamp: stamp.getTime(),
        };
      }
      return null;
    }

    let match =
      /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})[日]?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text) ||
      /^(\d{4})(\d{2})(\d{2})(?:\s*(\d{2})(\d{2})(\d{2})?)?$/.exec(text);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      return build(year, month, day, hour, minute, second);
    }
    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      const date = new Date(parsed);
      if (date.getFullYear() > 1970 && date.getFullYear() < 2200) {
        return { date: Diary.model.toDateKey(date), time: Diary.model.toTimeKey(date), timestamp: parsed };
      }
    }
    return null;
  }

  /** 通用 JSON 记录 → 条目。options.tagMap 用于把标签 id 还原成名字。 */
  function mapRecord(record, fallbackIndex = 0, options) {
    if (!record || typeof record !== 'object') return null;
    const config = options || {};
    // 有些导出格式把标题/时间/标签都塞在 property 这个 JSON 字符串里
    const source = { ...record };
    if (typeof record.property === 'string') {
      const property = parseJsonLike(record.property);
      if (property && typeof property === 'object') {
        for (const [key, value] of Object.entries(property)) {
          if (source[key] === undefined) source[key] = value;
        }
      }
    }
    const map = lowerKeys(source);

    let content = pick(map, CONTENT_KEYS);
    if (content && typeof content === 'object') {
      content = content.text || content.content || content.body || JSON.stringify(content);
    }
    let contentText = toText(content);
    if (looksLikeHtml(contentText)) contentText = htmlToText(contentText);

    let title = toText(pick(map, TITLE_KEYS));
    if (title && looksLikeHtml(title)) title = htmlToText(title);

    const dateValue = pick(map, DATE_KEYS);
    const parsedDate = normalizeDate(dateValue) || normalizeDate(pick(map, ['timeStamp', 'timestamp', 'createTime', 'createdAt']));
    // 只给了日期、没给时间的第三方记录：别再硬写成 00:00，
    // 能从创建/更新时间戳里补出时分就补（自家备份不会走到这里，见 readOwnBackup）
    const hasExplicitTime = Boolean(pick(map, ['time', 'hour', 'hhmm', 'showtime']));

    const tags = Diary.model.normalizeTags(normalizeTagValue(pick(map, TAG_KEYS)));
    const labIds = pick(map, ['labids', 'labid', 'lab_ids']);
    if (labIds) {
      for (const id of toText(labIds).split(',')) {
        const name = config.tagMap && config.tagMap.get(id.trim());
        if (name) tags.push(name);
      }
    }
    const finalTags = Diary.model.normalizeTags(tags);

    if (!title && !contentText.trim() && !finalTags.length) return null;

    const now = Date.now();
    const timestamp = (parsedDate && parsedDate.timestamp) || now;
    const entry = Diary.model.createEntry(timestamp, Diary.model.createId());
    entry.title = title;
    entry.content = contentText.trim();
    entry.tags = finalTags;
    entry.pinned = Boolean(pick(map, ['pinned', 'sticky', 'top', 'istop']));
    if (parsedDate) {
      entry.date = parsedDate.date;
      if (hasExplicitTime || parsedDate.time !== '00:00') {
        entry.time = parsedDate.time;
      } else {
        const stamp = Number(pick(map, ['createdat', 'createtime', 'updatedat', 'updatetime', 'mtime', 'ctime'])) || 0;
        entry.time = stamp ? Diary.model.toTimeKey(stamp) : parsedDate.time;
      }
    }
    entry.createdAt = timestamp;
    entry.updatedAt = Math.max(timestamp, Number(pick(map, ['updatedat', 'updatetime', 'mtimes'])) || timestamp);
    if (!entry.title && !entry.content) {
      const [first] = entry.tags;
      entry.title = first ? `标签：${first}` : '';
    }
    return Diary.model.isEmptyEntry(entry) ? null : entry;
  }

  function collectRecords(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of ['entries', 'diaries', 'data', 'list', 'items', 'records', 'notes', 'diaryList', 'result']) {
      if (Array.isArray(data[key])) return data[key];
    }
    // 有些备份是 { "2025-08-24": {...} } 这种按日期做键的结构
    const values = Object.values(data).filter((item) => item && typeof item === 'object');
    if (values.length && values.every((item) => !Array.isArray(item))) return values;
    return [];
  }

  function parseJsonLike(text) {
    const trimmed = toText(text).trim().replace(/^\uFEFF/, '');
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  function recordsFromJson(data) {
    const records = collectRecords(data);
    const entries = [];
    records.forEach((record, index) => {
      const entry = mapRecord(record, index);
      if (entry) entries.push(entry);
    });
    return entries;
  }

  /** 兜底：从任意文本里挑出像正文的片段。 */
  function extractTextRuns(text, minimum = 2) {
    const runs = toText(text).match(/[\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9][\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9，。！？、；：""''（）()《》…—\-,.!?;:'" ]{1,}/g) || [];
    return runs.filter((run) => run.trim().length >= minimum);
  }

  function idsFromMediaValue(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((item) => toText(item && typeof item === 'object' ? item.id || item.path || item.url : item)).filter(Boolean);
    return [toText(value)].filter(Boolean);
  }

  /* ------------------------------------------------------------ 图片工具 */

  function sniffImage(bytes) {
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return { ext: 'png', mime: 'image/png' };
    if (bytes.length > 3 && bytes[0] === 0x47 && bytes[1] === 0x49) return { ext: 'gif', mime: 'image/gif' };
    if (bytes.length > 12 && bytes[8] === 0x57 && bytes[9] === 0x45) return { ext: 'webp', mime: 'image/webp' };
    if (bytes.length > 12 && String.fromCharCode(...bytes.subarray(4, 8)) === 'ftyp') return { ext: 'heic', mime: 'image/heic' };
    if (bytes.length > 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return { ext: 'bmp', mime: 'image/bmp' };
    return { ext: 'bin', mime: 'application/octet-stream' };
  }

  function extensionOf(name) {
    const match = /\.([a-z0-9]{1,5})$/i.exec(toText(name));
    return match ? match[1].toLowerCase() : '';
  }

  /* --------------------------------------------------------- .mbk 解析 */

  const MBK_CONTENT = /^LockTimeDiaryData\/([^/]+)\/DiaryContent$/i;
  const MBK_IMAGE = /^LockTimeDiaryData\/([^/]+)\/(Pic|Image|Photo)_?(\d+)?$/i;

  function parseDiaryContent(bytes, options) {
    const text = textDecoder.decode(bytes).replace(/^\uFEFF/, '').trim();
    const json = parseJsonLike(text);
    if (json) {
      const single = mapRecord(json, 0, options);
      if (single) return { entry: single, extra: null };
      // 字段名完全认不出来时的兜底：挑最长的字符串当正文，再从任意字段里找日期
      return { entry: entryFromLooseJson(json) };
    }
    // 非 JSON：可能是 plist 风格或纯文本，尽量救回内容
    if (!text) return { entry: null };
    const dateMatch = /(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})[日]?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
    const parsed = dateMatch ? normalizeDate(dateMatch[0]) : null;
    const body = dateMatch ? text.replace(dateMatch[0], '').trim() : text;
    const cleaned = body.replace(/[{}[\]"]/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!cleaned) return { entry: null };
    const entry = Diary.model.createEntry(parsed ? parsed.timestamp : Date.now());
    if (parsed) {
      entry.date = parsed.date;
      entry.time = parsed.time;
    }
    entry.content = cleaned;
    return { entry };
  }

  function collectStrings(value, out) {
    const bucket = out || [];
    if (typeof value === 'string') {
      if (value.trim()) bucket.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, bucket);
    } else if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collectStrings(item, bucket);
    }
    return bucket;
  }

  /** 认不出字段名时的兜底：最长的字符串基本就是正文。 */
  function entryFromLooseJson(json) {
    const strings = collectStrings(json).filter((item) => item.length > 1);
    if (!strings.length) return null;
    const sorted = [...strings].sort((a, b) => b.length - a.length);
    const content = sorted[0];
    const entry = Diary.model.createEntry(Date.now());
    entry.content = content;
    for (const item of strings) {
      const parsed = normalizeDate(item);
      if (parsed) {
        entry.date = parsed.date;
        entry.time = parsed.time;
        entry.createdAt = parsed.timestamp;
        entry.updatedAt = Math.max(entry.updatedAt, parsed.timestamp);
        break;
      }
    }
    return Diary.model.isEmptyEntry(entry) ? null : entry;
  }

  async function readMbk(bytes, options) {
    const config = options || {};
    const list = Diary.zip.listEntries(bytes);
    const groups = new Map();
    const meta = { app: '加密备份', formats: [] };

    for (const item of list) {
      if (item.isDirectory) continue;
      const content = MBK_CONTENT.exec(item.name);
      if (content) {
        const group = groups.get(content[1]) || { id: content[1], content: null, images: [] };
        group.content = item;
        groups.set(content[1], group);
        continue;
      }
      const image = MBK_IMAGE.exec(item.name);
      if (image) {
        const group = groups.get(image[1]) || { id: image[1], content: null, images: [] };
        group.images.push({ entry: item, order: Number(image[3] || 0) });
        groups.set(image[1], group);
      }
    }

    const entries = [];
    const media = [];
    const warnings = [];
    const includeMedia = config.includeMedia !== false;
    const total = groups.size;
    let index = 0;

    // 标签表：labIds 存的是 uuid，要用 LabTagList 还原成名字
    const tagMap = new Map();
    const tagEntry = list.find((item) => /LockTimeDiaryData\/(LabTagList|TagList)$/i.test(item.name));
    if (tagEntry) {
      try {
        const tagBytes = await Diary.zip.readEntry(bytes, tagEntry, { password: config.password });
        const parsedTags = parseJsonLike(textDecoder.decode(tagBytes)) || {};
        for (const item of parsedTags.tagLabList || parsedTags.list || parsedTags.tags || []) {
          if (item && item.uuid && item.name) tagMap.set(item.uuid, item.name);
        }
        if (tagMap.size) meta.tags = tagMap.size;
      } catch (error) {
        if (error.code === 'PASSWORD') throw error;
        warnings.push(`标签表解析失败：${error.message}`);
      }
    }

    for (const group of groups.values()) {
      index += 1;
      if (config.onProgress) config.onProgress({ phase: 'entries', done: index, total });
      let parsed = null;
      if (group.content) {
        try {
          parsed = parseDiaryContent(await Diary.zip.readEntry(bytes, group.content, { password: config.password }), {
            tagMap,
          });
        } catch (error) {
          if (error.code === 'PASSWORD') throw error;
          warnings.push(`${group.id.slice(0, 8)}… 解析失败：${error.message}`);
        }
      }
      if (!parsed || !parsed.entry) continue;
      const entry = parsed.entry;
      entry.source = 'mbk';
      entry.id = Diary.model.createId();

      if (includeMedia && group.images.length) {
        group.images.sort((a, b) => a.order - b.order);
        let position = 0;
        for (const image of group.images) {
          position += 1;
          try {
            const data = await Diary.zip.readEntry(bytes, image.entry, { password: config.password });
            const kind = sniffImage(data);
            const id = `${entry.id}:${position}`;
            media.push({ id, blob: new Blob([data], { type: kind.mime }), name: `${position}.${kind.ext}`, entryId: entry.id });
            entry.media.push(id);
          } catch (error) {
            if (error.code === 'PASSWORD') throw error;
            warnings.push(`图片 ${image.entry.name} 读取失败：${error.message}`);
          }
        }
      }

      if (!Diary.model.isEmptyEntry(entry)) entries.push(entry);
    }

    return { entries, media, warnings, meta, source: 'mbk' };
  }

  /* --------------------------------------------------------- 通用 ZIP */

  /**
   * 是不是本应用导出的备份。
   * 自家 payload 必须走自家解析：通用字段映射只认到「日期」，
   * 会把日记的具体时间冲成 00:00，也读不出 v3 的记账 / 待办集合。
   */
  function isOwnBackup(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
    if (!Array.isArray(json.entries)) return false;
    if (json.format === 'diary-json') return true;
    return Boolean(json.app && /日记/.test(toText(json.app)));
  }

  /** 按自家格式读：条目走 model.parseImport（时间 / 创建时间 / 标签原样），集合一起带回 */
  function readOwnBackup(text) {
    const parsed = Diary.model.parseImport(text);
    const payload = {
      entries: parsed.entries,
      media: [],
      warnings: [],
      meta: { app: '拾光日记备份', version: parsed.version },
      source: 'own',
    };
    for (const key of Diary.model.EXPORT_COLLECTIONS || []) {
      if (Array.isArray(parsed[key])) payload[key] = parsed[key];
    }
    return payload;
  }

  async function readZipBackup(bytes, options) {
    const config = options || {};
    const list = Diary.zip.listEntries(bytes);
    const files = list.filter((item) => !item.isDirectory);
    if (Diary.zip.needsPassword(bytes) && !config.password) {
      throw new Diary.zip.ZipError('这个备份需要密码', 'PASSWORD');
    }

    const warnings = [];
    const jsonFiles = [];
    const textFiles = [];
    const mediaFiles = [];
    let order = 0;

    // 第一遍先把文件都读出来，图片先建索引：避免依赖 zip 里 entries.json 与图片的先后顺序
    for (const item of files) {
      order += 1;
      if (config.onProgress) config.onProgress({ phase: 'entries', done: order, total: files.length });
      const name = item.name.toLowerCase();
      let data;
      try {
        data = await Diary.zip.readEntry(bytes, item, { password: config.password });
      } catch (error) {
        if (error.code === 'PASSWORD') throw error;
        warnings.push(`${item.name} 读取失败：${error.message}`);
        continue;
      }

      const isImage = /\.(jpe?g|png|gif|webp|heic|bmp)$/.test(name) || /^media\//.test(name);
      if (isImage) {
        mediaFiles.push({ name: normalizeName(item.name), data, kind: sniffImage(data), used: false });
      } else if (/\.json$/i.test(name)) {
        jsonFiles.push({ name, text: textDecoder.decode(data) });
      } else if (/\.(txt|md|markdown|html?)$/i.test(name)) {
        textFiles.push({ name, text: textDecoder.decode(data) });
      }
    }

    const mediaByName = new Map();
    for (const item of mediaFiles) if (!mediaByName.has(item.name)) mediaByName.set(item.name, item);

    const entries = [];
    const media = [];
    const collections = {};

    // 第二遍：解析文字内容，并把引用到的图片挂到条目上
    for (const file of jsonFiles) {
      const json = parseJsonLike(file.text);
      if (!json) continue;
      // 自家备份：走自家解析，日记时间与记账 / 待办等集合一起还原
      const own = isOwnBackup(json) ? readOwnBackup(file.text) : null;
      const rawEntries = Array.isArray(json && json.entries) ? json.entries : null;
      const records = own ? own.entries : recordsFromJson(json);
      records.forEach((entry, position) => {
        attachZipMedia(entry, rawEntries ? rawEntries[position] : null, mediaByName, media);
        entries.push(entry);
      });
      if (own) {
        for (const key of Diary.model.EXPORT_COLLECTIONS || []) {
          if (Array.isArray(own[key])) collections[key] = (collections[key] || []).concat(own[key]);
        }
      }
    }

    for (const file of textFiles) {
      const body = looksLikeHtml(file.text) ? htmlToText(file.text) : file.text;
      if (!body.trim()) continue;
      const entry = Diary.model.createEntry(Date.now());
      entry.content = body.trim();
      entry.source = 'zip';
      entries.push(entry);
    }

    // 没有被任何条目引用的图片也保留下来，至少不丢文件
    for (const item of mediaByName.values()) {
      if (item.used) continue;
      media.push({
        id: `zip:${item.name}`,
        blob: new Blob([item.data], { type: item.kind.mime }),
        name: item.name,
        entryId: null,
      });
    }

    return {
      entries,
      media,
      warnings,
      meta: { app: 'ZIP 备份' },
      source: 'zip',
      // 自家完整备份里的记账 / 待办 / 约稿等集合
      ...collections,
    };
  }

  function normalizeName(name) {
    return toText(name).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }

  function attachZipMedia(entry, record, mediaByName, media) {
    if (!record || typeof record !== 'object') return;
    const candidates = [];
    for (const [key, value] of Object.entries(record)) {
      if (/^(media|images?|photos?|pics?|attachments?|files?)$/i.test(key)) candidates.push(...idsFromMediaValue(value));
    }
    for (const candidate of candidates) {
      const base = normalizeName(candidate).replace(/^.*\//, '');
      const hit = [...mediaByName.entries()].find(([name]) => name.endsWith(base));
      if (!hit) continue;
      hit[1].used = true;
      const id = `${entry.id}:${entry.media.length + 1}`;
      media.push({ id, blob: new Blob([hit[1].data], { type: hit[1].kind.mime }), name: base, entryId: entry.id });
      entry.media.push(id);
    }
  }

  /* ----------------------------------------------------------- 统一入口 */

  function detect(bytes, filename) {
    const name = toText(filename).toLowerCase();
    if (Diary.zip.isZip(bytes)) {
      let needsPassword = false;
      let encrypted = false;
      try {
        const list = Diary.zip.listEntries(bytes);
        encrypted = list.some((item) => item.encrypted || item.method === 99);
        needsPassword = encrypted;
      } catch (ignored) {
        /* 交给后面的解析去报错 */
      }
      const mbkName = name.endsWith('.mbk');
      return { kind: mbkName ? 'mbk' : 'zip', needsPassword, encrypted };
    }
    const head = bytes.length ? textDecoder.decode(bytes.subarray(0, 4)) : '';
    if (head.trim().startsWith('{') || head.trim().startsWith('[')) return { kind: 'json', needsPassword: false, encrypted: false };
    return { kind: 'text', needsPassword: false, encrypted: false };
  }

  /**
   * 内置候选口令：先试用户输入的，再依次试这两个。
   * `timenotes` 是拾光日记的默认口令；`locktime2u` 是更早的历史备份用的常量，
   * 留着是为了老备份不手输也能解开。
   */
  const BUILTIN_PASSWORDS = ['timenotes', 'locktime2u'];

  async function readBackup(options) {
    const config = options || {};
    const bytes = config.bytes instanceof Uint8Array ? config.bytes : new Uint8Array(config.bytes);
    if (!bytes.length) throw new Error('文件是空的');

    const info = detect(bytes, config.filename);
    if (info.kind === 'mbk') return readMbk(bytes, config);
    if (info.kind === 'zip') {
      // 有些 .zip 备份其实就是 .mbk（只是扩展名不同）
      if (bytes.length && containsMbkLayout(bytes)) return readMbk(bytes, config);
      return readZipBackup(bytes, config);
    }
    if (info.kind === 'json') {
      const text = textDecoder.decode(bytes);
      const data = parseJsonLike(text);
      // 自家 JSON 备份：时间和记账一起还原
      if (isOwnBackup(data)) return readOwnBackup(text);
      const entries = recordsFromJson(data);
      if (!entries.length) throw new Error('JSON 里没有找到日记数据');
      const payload = { entries, media: [], warnings: [], meta: { app: 'JSON 备份' }, source: 'json' };
      for (const key of Diary.model.EXPORT_COLLECTIONS || []) {
        if (Array.isArray(data && data[key])) payload[key] = data[key];
      }
      return payload;
    }

    const text = textDecoder.decode(bytes);
    const entry = Diary.model.createEntry(Date.now());
    entry.content = looksLikeHtml(text) ? htmlToText(text) : text.trim();
    if (!entry.content) throw new Error('文件里没有可导入的文字');
    return { entries: [entry], media: [], warnings: [], meta: { app: '文本' }, source: 'text' };
  }

  /** 需要密码的备份：按「用户输入 → 内置候选」的顺序自动试，试通就用那一把 */
  async function parseBackup(options) {
    const config = options || {};
    const typed = typeof config.password === 'string' ? config.password.trim() : '';
    const candidates = [];
    if (typed) candidates.push(typed);
    for (const builtin of BUILTIN_PASSWORDS) if (!candidates.includes(builtin)) candidates.push(builtin);

    if (!candidates.length) return readBackup(config);

    let lastError = null;
    for (const password of candidates) {
      try {
        const result = await readBackup({ ...config, password });
        result.password = password;
        return result;
      } catch (error) {
        lastError = error;
        if (error.code !== 'PASSWORD') throw error;
      }
    }
    throw lastError || new Error('备份解不开');
  }

  function containsMbkLayout(bytes) {
    try {
      return Diary.zip.listEntries(bytes).some((item) => /LockTimeDiaryData\/.+\/DiaryContent$/i.test(item.name));
    } catch (error) {
      return false;
    }
  }

  Diary.importer = {
    BUILTIN_PASSWORDS,
    detect,
    extractTextRuns,
    htmlToText,
    looksLikeHtml,
    mapRecord,
    normalizeDate,
    parseBackup,
    parseDiaryContent,
    recordsFromJson,
    sniffImage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
