/**
 * 群消息导入 · 纯函数解析器（三端共用）
 *
 * ## 为什么是「粘贴」而不是「自动抓取」
 *
 * 用户想要的是「自动把微信/QQ 群（如跳蚤群）里的信息推到平台上」。
 * 直接读本地缓存 / 挂第三方群机器人**都不可行**，原因不是技术难度，而是三条硬约束：
 *
 * 1. **微信数据库是 SQLCipher 加密的**（`EnMicroMsg.db`），密钥由
 *    `IMEI/AndroidID + uin` 派生。要读它必须 root / 越狱 / hook 客户端。
 *    这在《微信个人账号使用规范》里属于「使用非官方客户端或插件获取数据」，
 *    后果是封号；而且微信每次改加密方案就会失效，维护成本无上限。
 *
 * 2. **法律风险**：群消息里包含**其他成员的通信内容**。未经对方同意抓取并转存，
 *    直接触碰《个人信息保护法》里的「处理他人个人信息需取得同意」。
 *    这不是「我们自己小心一点」能解决的 —— 平台上每一条从群里抓来的跳蚤信息，
 *    背后都是一个没同意被转载的同学。
 *
 * 3. **个人微信群从来没有官方的群消息 API**。市面上所谓「群机器人」
 *    （ClawBot 一类）都是 web 协议逆向，同样踩上面两条。
 *
 * 所以本模块走**用户主动导入**：用户把群消息复制/转发出群，粘到这里，
 * 我们只做「结构化」这一件事。用户是消息的参与者，转发自己的聊天记录是合规的；
 * 平台不接触任何未经同意的数据。
 *
 * ## 这个解析器做什么 / 不做什么
 *
 * **做**：把一团乱的群聊文本切成条目，抽出售卖/求购/拼单/跑腿的标题、
 * 价格、联系方式、地点，并给出**为什么这样判定**的 evidence。
 *
 * **不做**：
 * - 不猜原文里没有的信息（抽不到价格就是 `null`，不估一个）
 * - 不自动发布（必须用户逐条确认 —— 见 `GroupImportDraft`）
 * - 不识别图片里的文字（群消息常带图，但我们不做 OCR，宁可让用户自己补）
 */

/* ------------------------------------------------------------------ *
 * 类型
 * ------------------------------------------------------------------ */

/** 从群消息里识别出的条目类型 */
export type GroupImportKind = 'sell' | 'buy' | 'groupbuy' | 'errand' | 'other';

/** 一条从群消息里抽出来的候选条目 */
export interface GroupImportCandidate {
  /** 稳定 id（同一次解析内唯一，用于前端列表 key） */
  readonly id: string;
  /** 判定类型 */
  readonly kind: GroupImportKind;
  /** 标题：优先「物品/需求名」，抽不到就用首行截断 */
  readonly title: string;
  /** 价格（分）。抽不到是 `null` —— **不估** */
  readonly priceFen: number | null;
  /** 联系方式（手机号/微信号/QQ号）。抽不到是 `null` */
  readonly contact: string | null;
  /** 地点（校区/宿舍楼/食堂名）。抽不到是 `null` */
  readonly location: string | null;
  /** 原始文本（保留完整原文，供用户核对） */
  readonly rawText: string;
  /**
   * 判定依据 —— 每个字段各自说明「为什么是这个值」。
   * 前端必须展示它，用户才能判断解析对不对。这是本模块的**可解释性要求**。
   */
  readonly evidence: readonly GroupImportEvidence[];
  /** 置信度 0–1：低于 `LOW_CONFIDENCE_THRESHOLD` 时前端应提示用户重点核对 */
  readonly confidence: number;
}

/** 一条判定依据 */
export interface GroupImportEvidence {
  readonly field: 'kind' | 'title' | 'price' | 'contact' | 'location';
  /** 命中的规则说明（给人读的） */
  readonly reason: string;
  /** 命中的原文片段（可空：有些依据是"没有命中"） */
  readonly matchedText: string | null;
}

/** 低于这个置信度，前端要显著提示「请核对」 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/* ------------------------------------------------------------------ *
 * 关键词表（规则法，不需要模型）
 * ------------------------------------------------------------------ */

/**
 * 类型判定关键词。
 *
 * 顺序有意义：**先判更具体的**（拼单/跑腿），再判买卖。
 * 理由：「求拼单」同时含「求」和「拼单」，按买卖判定会错。
 */
const KIND_RULES: readonly { kind: GroupImportKind; keywords: readonly string[]; reason: string }[] = [
  {
    kind: 'groupbuy',
    keywords: ['拼单', '拼团', '一起买', '凑单', '拼邮', '拼车'],
    reason: '含拼单类关键词',
  },
  {
    kind: 'errand',
    keywords: ['跑腿', '代取', '代买', '帮忙取', '帮拿', '代拿', '带一下', '有偿'],
    reason: '含跑腿类关键词',
  },
  {
    kind: 'sell',
    keywords: ['出', '出售', '转让', '闲置', '甩', '低价出', '二手'],
    reason: '含出售类关键词',
  },
  {
    kind: 'buy',
    keywords: ['求购', '收', '想收', '求一个', '收一个', '寻'],
    reason: '含求购类关键词',
  },
];

/** 地点关键词（校区常见地点；抽不到就是 null） */
const LOCATION_HINTS: readonly string[] = [
  '张江', '岳阳路', '徐汇',
  '一号公寓', '二号公寓', '三号公寓', '四号公寓', '五号公寓',
  '六号公寓', '七号公寓', '八号公寓', '九号公寓', '十号公寓',
  '一号食堂', '二号食堂', '三号食堂', '白玉兰', '餐饮中心',
  '图书馆', '体育馆', '教学中心', '行政中心', '会议中心',
  '信息学院', '物质学院', '生命学院', '创管学院',
];

/* ------------------------------------------------------------------ *
 * 抽取
 * ------------------------------------------------------------------ */

/** 价格：支持 `50`、`50元`、`¥50`、`50块`、`50r`、`0.5元`、`1.5w` */
const PRICE_PATTERN =
  /(?:[¥￥]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块|r|R|rmb|RMB)|(\d+(?:\.\d+)?)\s*[wW](?!\w))/;

/** 手机号（中国大陆 11 位） */
const PHONE_PATTERN = /(?:^|[^\d])(1[3-9]\d{9})(?:[^\d]|$)/;
/** 微信号：`微信` / `vx` / `v信` 后面跟一段 id */
const WECHAT_PATTERN = /(?:微信|weixin|vx|VX|v信|威信)\s*[:：]?\s*([A-Za-z][-_A-Za-z0-9]{5,19})/;
/** QQ 号 */
const QQ_PATTERN = /(?:QQ|qq|扣扣)\s*[:：]?\s*(\d{5,11})/;

/**
 * 从一段文本里抽价格（**分**）。
 *
 * 返回 `null` 表示原文没有可识别的价格 —— **绝不估一个值**。
 * 估价的危害是双重的：用户发布时以为是真实的，买家也以为是真实的。
 */
export function extractPriceFen(text: string): number | null {
  const matched = PRICE_PATTERN.exec(text);
  if (matched === null) return null;

  // ⚠️ 负号必须拒绝：`-50 元` 会被正则抓到 `50`，如果直接返回 5000，
  // 一条"退款 50 元"就会被发布成"售价 50 元"—— 金额符号错了比没有更危险。
  const start = matched.index;
  if (start > 0 && text[start - 1] === '-') return null;

  // 三种捕获组：¥前缀 / 元块r后缀 / w后缀
  const yuan = matched[1] ?? matched[2];
  if (yuan !== undefined) {
    const value = Number(yuan);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 100);
  }
  const wan = matched[3];
  if (wan !== undefined) {
    const value = Number(wan);
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value * 10_000 * 100);
  }
  return null;
}

/** 从文本里抽联系方式。都抽不到返回 `null` —— 不编。 */
export function extractContact(text: string): string | null {
  const phone = PHONE_PATTERN.exec(text);
  if (phone?.[1] !== undefined) return phone[1];

  const wechat = WECHAT_PATTERN.exec(text);
  if (wechat?.[1] !== undefined) return `微信 ${wechat[1]}`;

  const qq = QQ_PATTERN.exec(text);
  if (qq?.[1] !== undefined) return `QQ ${qq[1]}`;

  return null;
}

/** 从文本里抽地点。抽不到返回 `null`。 */
export function extractLocation(text: string): string | null {
  for (const hint of LOCATION_HINTS) {
    if (text.includes(hint)) return hint;
  }
  return null;
}

/**
 * 判定条目类型。命中不到任何关键词时返回 `'other'` 且置信度低。
 */
export function classifyKind(text: string): { kind: GroupImportKind; evidence: GroupImportEvidence | null } {
  for (const rule of KIND_RULES) {
    for (const keyword of rule.keywords) {
      // `出`/`收` 这类单字关键词极易误判（「出来」「收到」），要求前后不是常见虚词
      if (keyword.length === 1) {
        const idx = text.indexOf(keyword);
        if (idx === -1) continue;
        const before = text[idx - 1] ?? '';
        const after = text[idx + 1] ?? '';
        if ('出入得收' .includes(before) || '来找个了到' .includes(after)) continue;
        return {
          kind: rule.kind,
          evidence: { field: 'kind', reason: rule.reason, matchedText: keyword },
        };
      }
      if (text.includes(keyword)) {
        return {
          kind: rule.kind,
          evidence: { field: 'kind', reason: rule.reason, matchedText: keyword },
        };
      }
    }
  }
  return { kind: 'other', evidence: null };
}

/* ------------------------------------------------------------------ *
 * 切条目
 * ------------------------------------------------------------------ */

/**
 * 把整段群聊文本切成「一条消息一块」。
 *
 * 现实里的群消息粘贴进来长这样：
 *
 * ```
 * 张三 12:30
 * 出台灯 50 元 五号公寓 微信 abc123456
 *
 * 李四 12:35
 * 求购自行车 预算 200
 * ```
 *
 * 所以切分依据是**空行**（微信「复制」多条消息时用空行分隔），
 * 同时把「昵称 + 时间」这种头部行剥掉（它不是内容）。
 */
export function splitMessages(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  return blocks
    .map((block) =>
      block
        .split('\n')
        // 头部行形如 `张三 12:30` / `张三 2026-10-18 12:30`
        .filter((line) => !/^\S{1,20}\s+\d{1,2}:\d{2}\s*$/.test(line.trim()))
        .join('\n')
        .trim(),
    )
    .filter((block) => block.length > 0);
}

/** 从一块消息里抽标题：取第一行、去掉价格/联系方式、截断到 40 字 */
export function extractTitle(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  const cleaned = firstLine
    .replace(PRICE_PATTERN, '')
    .replace(PHONE_PATTERN, '')
    .replace(WECHAT_PATTERN, '')
    .replace(QQ_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const base = cleaned.length > 0 ? cleaned : firstLine;
  return base.length > 40 ? `${base.slice(0, 40)}…` : base;
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/**
 * 解析群聊文本 → 候选条目列表。
 *
 * 纯函数、无副作用、无网络。调用方（小程序页 / Web / API）拿到结果后
 * **必须让用户逐条确认**才能发布 —— 这个函数只负责"把乱文本变成结构化候选"。
 */
export function parseGroupImport(input: string): GroupImportCandidate[] {
  const messages = splitMessages(input);
  const candidates: GroupImportCandidate[] = [];

  messages.forEach((rawText, index) => {
    const evidence: GroupImportEvidence[] = [];

    const { kind, evidence: kindEvidence } = classifyKind(rawText);
    if (kindEvidence !== null) evidence.push(kindEvidence);

    const title = extractTitle(rawText);
    if (title.length > 0) {
      evidence.push({
        field: 'title',
        reason: '取首行并剥离价格/联系方式',
        matchedText: title,
      });
    }

    const priceFen = extractPriceFen(rawText);
    if (priceFen !== null) {
      evidence.push({ field: 'price', reason: '命中价格模式', matchedText: String(priceFen / 100) });
    }

    const contact = extractContact(rawText);
    if (contact !== null) {
      evidence.push({ field: 'contact', reason: '命中联系方式模式', matchedText: contact });
    }

    const location = extractLocation(rawText);
    if (location !== null) {
      evidence.push({ field: 'location', reason: '命中校园地点词表', matchedText: location });
    }

    // 置信度：类型判定 + 标题 是必要条件；价格/联系/地点是加分项
    const hasKind = kind !== 'other';
    const hasTitle = title.length >= 2;
    const bonus = [priceFen, contact, location].filter((v) => v !== null).length;
    const confidence = Math.min(
      1,
      (hasKind ? 0.45 : 0.1) + (hasTitle ? 0.25 : 0) + bonus * 0.1,
    );

    candidates.push({
      id: `gic-${index + 1}`,
      kind,
      title,
      priceFen,
      contact,
      location,
      rawText,
      evidence,
      confidence: Math.round(confidence * 100) / 100,
    });
  });

  return candidates;
}
