/**
 * 众筹诉求（`petition`）—— 学生共同需求 → 附议 → 生成正式邮件给对应部门
 *
 * ## 这里的「众筹」不是筹钱
 *
 * 筹的是**共同诉求的证据**：有多少人真的需要这件事。
 * 所以本模块**刻意不涉及任何金额、支付、退款**字段 ——
 * 一旦有资金流转，性质就变成金融业务，需要牌照。
 * 本模块只回答三个问题：
 *   1. 有多少人附议？
 *   2. 到没到「值得正式提出」的门槛？
 *   3. 那封发给部门的邮件长什么样？
 *
 * ## 为什么阈值分级，而不是一个数字
 *
 * 「食堂加个素食窗口」和「要求教务处改保研细则」的合理门槛完全不同。
 * 用统一阈值会导致两种坏结果：小事永远够不到，大事轻易就被当成"民意"。
 * 所以阈值由 **类别 × 影响范围** 决定，且每个档位都写清理由。
 *
 * ## 三条硬规则
 *
 * 1. **附议默认匿名**。部门只需要知道"有多少人"，不需要知道"是谁"。
 *    发起人必须实名（他要作为对接人），这是**不对称的**，且是有意的。
 * 2. **邮件必须可审计**：附议数、截止时间、诉求原文都要能对上，
 *    不允许"我口头说有很多人支持"。
 * 3. **过了阈值不等于已提交**。要有人**真的点了发送**并记录回执，
 *    否则会变成"以为已经反映了但实际上没人发"。
 */

/* ------------------------------------------------------------------ *
 * 1. 类别与部门
 * ------------------------------------------------------------------ */

/**
 * 诉求类别。
 *
 * 这个枚举同时决定了默认阈值与默认对接部门 —— 三者是**绑定的**，
 * 不分开配，避免出现「类别是食堂但部门填了教务处」这种不一致。
 */
export const PETITION_CATEGORIES = ['canteen', 'facility', 'teaching', 'dorm', 'it', 'other'] as const;

export type PetitionCategory = (typeof PETITION_CATEGORIES)[number];

export const PETITION_CATEGORY_LABELS: Readonly<Record<PetitionCategory, string>> = Object.freeze({
  canteen: '食堂餐饮',
  facility: '公共设施',
  teaching: '教学教务',
  dorm: '宿舍生活',
  it: '校园信息化',
  other: '其他',
});

/**
 * 默认对接部门（中文名 + 建议邮箱）。
 *
 * ⚠️ 邮箱是**建议值**，不是官方确认的。UI 必须让发起人在发送前核对 ——
 * 发错部门的后果比不发更糟（部门会当成垃圾邮件）。
 */
export interface PetitionDepartment {
  readonly name: string;
  readonly email: string;
  /** 联系电话（学校官网公布的值） */
  readonly phone: string;
  /**
   * 邮箱是否**已从学校官网核实**。
   *
   * ⚠️ `false` 时 UI **必须**提示「请自行确认收件人」，
   * 不允许静默发到一个没核实的地址 —— 发错部门比不发更糟。
   */
  readonly emailConfirmed: boolean;
  /** 出处（便于下次复核） */
  readonly source: string;
}

/**
 * 默认对接部门（2026-10-22 从学校官网实测抓取）。
 *
 * ## 这次把猜测换成了实测值 —— 原来 6 个里错了 4 个
 *
 * | 类别 | 原来（猜的） | 实测真实值 |
 * | --- | --- | --- |
 * | teaching | `academics@` | **`student@`**（教务处！反直觉） |
 * | dorm | `student@` | **`studentaffairs@`**（学生事务处） |
 * | it | `it@` | **`it-support@`**（信息化服务网站） |
 * | canteen | `logistics@` | ❌ **没找到**（学校没有后勤域名） |
 *
 * 数据来源：
 * - <https://www.shanghaitech.edu.cn/1488/list.htm>（联系我们，32 个部门邮箱 + 电话）
 * - <https://it.shanghaitech.edu.cn/>（信息化服务网站）
 *
 * ## 为什么 canteen 没有邮箱却仍然留着
 *
 * 试过 `hq.` / `logistics.` / `canteen.` / `houqin.` / `service.shanghaitech.edu.cn`，
 * 全部**域名不存在**（000）。学校官网的部门表里也**没有「后勤」**这一栏。
 *
 * 所以 `canteen` 用 `emailConfirmed: false` 标记，UI 会提示用户自己确认收件人。
 * **宁可不给地址，也不编一个。**
 */
export const PETITION_DEPARTMENTS: Readonly<Record<PetitionCategory, PetitionDepartment>> =
  Object.freeze({
    // ⚠️ 没找到后勤/食堂的公开邮箱。指到「设备与资产处」是错的（那是管设备的）。
    // 保留一个显式的未确认状态，让 UI 去提示，而不是塞一个假地址。
    canteen: {
      name: '后勤服务中心',
      email: 'facility@shanghaitech.edu.cn',
      phone: '86-21-20685211',
      emailConfirmed: false,
      source: '未找到后勤专属邮箱；此地址属「设备与资产处」，需用户自行改投',
    },
    facility: {
      name: '设备与资产处',
      email: 'facility@shanghaitech.edu.cn',
      phone: '86-21-20685211',
      emailConfirmed: true,
      source: 'https://www.shanghaitech.edu.cn/1488/list.htm',
    },
    teaching: {
      // ⚠️ 反直觉但是实测：教务处公布的是 `student@`
      name: '教务处',
      email: 'student@shanghaitech.edu.cn',
      phone: '86-21-20685313',
      emailConfirmed: true,
      source: 'https://www.shanghaitech.edu.cn/1488/list.htm',
    },
    dorm: {
      name: '学生事务处',
      email: 'studentaffairs@shanghaitech.edu.cn',
      phone: '86-21-20685643',
      emailConfirmed: true,
      source: 'https://www.shanghaitech.edu.cn/1488/list.htm',
    },
    it: {
      name: '信息化服务',
      email: 'it-support@shanghaitech.edu.cn',
      phone: '86-21-20685191',
      emailConfirmed: true,
      source: 'https://it.shanghaitech.edu.cn/',
    },
    other: {
      name: '综合办公室（党务）',
      email: 'ucoffice@shanghaitech.edu.cn',
      phone: '86-21-20685319',
      emailConfirmed: true,
      source: 'https://www.shanghaitech.edu.cn/1488/list.htm',
    },
  });

/* ------------------------------------------------------------------ *
 * 2. 阈值：分档 + 理由
 * ------------------------------------------------------------------ */

/** 影响范围 —— 决定同一类别下阈值的倍数 */
export const PETITION_SCOPES = ['personal', 'group', 'campus'] as const;

export type PetitionScope = (typeof PETITION_SCOPES)[number];

export const PETITION_SCOPE_LABELS: Readonly<Record<PetitionScope, string>> = Object.freeze({
  personal: '个人不便',
  group: '部分同学',
  campus: '全校性',
});

/**
 * 各范围的基础阈值。
 *
 * | 范围 | 阈值 | 理由 |
 * | --- | --- | --- |
 * | `personal` | 10 | 一个人提容易被当成个例；10 人能说明不是偶发 |
 * | `group` | 30 | 一个班级/社团量级，部门会认真看 |
 * | `campus` | 100 | 涉及全校调整，需要足够的样本支撑 |
 *
 * 这些数字**不是权威数据**，是「让流程能启动」的经验值。
 * 一旦有部门给出正式口径，应替换这里并更新测试。
 */
export const PETITION_BASE_THRESHOLDS: Readonly<Record<PetitionScope, number>> = Object.freeze({
  personal: 10,
  group: 30,
  campus: 100,
});

/** 「紧急」类诉求的阈值折扣（乘 0.5）。紧急的事不该卡在人数上 */
export const PETITION_URGENT_FACTOR = 0.5;

/**
 * 算出某条诉求需要的附议人数。
 *
 * @param scope 影响范围
 * @param urgent 是否紧急（如安全隐患、影响正常上课）
 */
export function petitionThreshold(scope: PetitionScope, urgent: boolean): number {
  const base = PETITION_BASE_THRESHOLDS[scope];
  return urgent ? Math.max(3, Math.ceil(base * PETITION_URGENT_FACTOR)) : base;
}

/* ------------------------------------------------------------------ *
 * 3. 状态机
 * ------------------------------------------------------------------ */

/**
 * 诉求状态。
 *
 * ```
 * draft ──发布──> collecting ──到阈值──> ready
 *                    │                     │
 *                    │                     └──发起人点发送──> submitted
 *                    └──发起人撤回──> withdrawn      submitted ──部门回复──> answered
 *                                                       answered ──> resolved | rejected
 * ```
 *
 * ⚠️ `ready` 与 `submitted` 必须分开：前者是「人数够了」，
 * 后者是「邮件真的发出去了并有回执」。混在一起会产生
 * 「以为反映了但没人发」的黑洞。
 */
export const PETITION_STATUSES = [
  'draft',
  'collecting',
  'ready',
  'submitted',
  'answered',
  'resolved',
  'rejected',
  'withdrawn',
] as const;

export type PetitionStatus = (typeof PETITION_STATUSES)[number];

export const PETITION_STATUS_LABELS: Readonly<Record<PetitionStatus, string>> = Object.freeze({
  draft: '草稿',
  collecting: '征集中',
  ready: '已达标，待提交',
  submitted: '已提交，等回复',
  answered: '部门已回复',
  resolved: '已解决',
  rejected: '未采纳',
  withdrawn: '已撤回',
});

/** 允许的状态迁移。任何不在表里的迁移都是 bug，不是「灵活处理」 */
const PETITION_TRANSITIONS: Readonly<Record<PetitionStatus, readonly PetitionStatus[]>> = Object.freeze({
  draft: ['collecting', 'withdrawn'],
  collecting: ['ready', 'withdrawn'],
  // 达标后人数可能掉（有人撤回附议），所以允许回到 collecting
  ready: ['submitted', 'collecting', 'withdrawn'],
  submitted: ['answered', 'withdrawn'],
  answered: ['resolved', 'rejected', 'submitted'],
  resolved: [],
  rejected: [],
  withdrawn: [],
});

/** 终态：不可再迁移 */
export const PETITION_TERMINAL_STATUSES: readonly PetitionStatus[] = Object.freeze([
  'resolved',
  'rejected',
  'withdrawn',
]);

/** 这个迁移合法吗 */
export function canTransitionPetition(from: PetitionStatus, to: PetitionStatus): boolean {
  return PETITION_TRANSITIONS[from].includes(to);
}

/** 迁移；非法则抛错（调用方传错状态是**编程错误**，不该静默） */
export function transitionPetition(from: PetitionStatus, to: PetitionStatus): PetitionStatus {
  if (!canTransitionPetition(from, to)) {
    throw new RangeError(`petition: 非法状态迁移 ${from} → ${to}`);
  }
  return to;
}

/* ------------------------------------------------------------------ *
 * 4. 附议与匿名
 * ------------------------------------------------------------------ */

/**
 * 一次附议。
 *
 * ⚠️ **不存 userId**。我们只记 `endorsementId`（随机串）与时间戳 ——
 * 目的是「防止同一个人重复附议」，不是「知道谁支持了什么」。
 * 去重靠 `endorsementId` 的**一次性**语义 + 客户端在本地记住已附议的诉求。
 *
 * 这是刻意的设计取舍：**服务端无法证明某个学号支持了某条诉求**，
 * 即便被要求调数据也给不出。代价是理论上换设备可重复附议 ——
 * 我们宁可接受这个，也不做「谁支持了什么」的档案。
 */
export interface PetitionEndorsement {
  /** 随机标识（不是用户 id），仅用于去重 */
  readonly endorsementId: string;
  /** 附议时间（ISO-8601） */
  readonly endorsedAt: string;
  /** 附议者留的一句话（可选，**默认不进邮件** —— 见 buildPetitionEmail） */
  readonly note: string | null;
}

/** 一条众筹诉求 */
export interface Petition {
  readonly id: string;
  /** 诉求标题（一句话说清要什么） */
  readonly title: string;
  /** 详细说明：现状、影响、期望 */
  readonly body: string;
  readonly category: PetitionCategory;
  readonly scope: PetitionScope;
  readonly urgent: boolean;
  readonly status: PetitionStatus;
  /**
   * 发起人显示名。
   *
   * ⚠️ 发起人**必须实名**（他是对接人），附议者匿名。这个不对称是有意的：
   * 部门需要一个能联系的人，但不需要一份支持者名单。
   */
  readonly initiator: string;
  /** 对接部门（默认来自类别，但允许发起人改 —— 发错部门比不发更糟） */
  readonly departmentName: string;
  readonly departmentEmail: string;
  readonly createdAt: string;
  /** 征集截止时间（ISO-8601）；过了就不再接受附议 */
  readonly deadline: string;
  readonly endorsements: readonly PetitionEndorsement[];
  /** 邮件发出后的回执（提交时间 + 我们用哪个邮箱发的） */
  readonly submission: PetitionSubmission | null;
  /** 部门的回复（原文摘录 + 时间） */
  readonly response: PetitionResponse | null;
}

export interface PetitionSubmission {
  readonly submittedAt: string;
  /** 实际发送方（我们的系统邮箱），方便部门回信时追溯 */
  readonly senderEmail: string;
  /** 邮件主题，便于在邮箱里检索 */
  readonly subject: string;
}

export interface PetitionResponse {
  readonly receivedAt: string;
  /** 部门回复原文（摘录，不加工） */
  readonly summary: string;
  /** 是否解决问题 */
  readonly outcome: 'resolved' | 'rejected' | 'pending';
}

/* ------------------------------------------------------------------ *
 * 5. 进度计算
 * ------------------------------------------------------------------ */

export interface PetitionProgress {
  /** 已有附议数 */
  readonly count: number;
  /** 需要的附议数 */
  readonly threshold: number;
  /** 0..1，封顶 1 */
  readonly ratio: number;
  /** 还差几个（已达标为 0） */
  readonly remaining: number;
  readonly reached: boolean;
  /** 是否已过截止时间 */
  readonly expired: boolean;
  /** 还能不能继续收附议（未过期 + 非终态 + 未提交） */
  readonly accepting: boolean;
}

/**
 * 算进度。
 *
 * @param now 当前时刻（注入而不是读时钟，便于测试）
 */
export function petitionProgress(
  petition: Pick<Petition, 'endorsements' | 'scope' | 'urgent' | 'deadline' | 'status'>,
  now: Date,
): PetitionProgress {
  const count = petition.endorsements.length;
  const threshold = petitionThreshold(petition.scope, petition.urgent);
  const expired = now.toISOString() > petition.deadline;

  return {
    count,
    threshold,
    ratio: threshold === 0 ? 1 : Math.min(1, count / threshold),
    remaining: Math.max(0, threshold - count),
    reached: count >= threshold,
    expired,
    // ⚠️ 已提交/已回复的诉求不再收附议 —— 否则「提交后又涨了 50 人」
    // 会让邮件里的数字与页面上的数字对不上
    accepting:
      !expired &&
      petition.status !== 'submitted' &&
      petition.status !== 'answered' &&
      !PETITION_TERMINAL_STATUSES.includes(petition.status),
  };
}

/**
 * 根据进度推导**建议**的下一状态（不自动改状态）。
 *
 * 为什么只是建议：改状态要有动作（发邮件、部门回复），
 * 光凭人数变化就自动跳状态会产生"已提交但实际上没发"的假象。
 */
export function suggestPetitionStatus(
  petition: Pick<Petition, 'endorsements' | 'scope' | 'urgent' | 'deadline' | 'status'>,
  now: Date,
): PetitionStatus {
  const progress = petitionProgress(petition, now);
  if (progress.reached && petition.status === 'collecting') return 'ready';
  if (!progress.reached && petition.status === 'ready') return 'collecting';
  return petition.status;
}

/* ------------------------------------------------------------------ *
 * 6. 邮件生成（这是本模块最能被检验的产出）
 * ------------------------------------------------------------------ */

export interface PetitionEmail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * 生成发给部门的邮件。
 *
 * ## 三条约束
 *
 * 1. **只用可核对的数字**：附议数来自 `endorsements.length`，
 *    不接受调用方传入的"支持人数"。
 * 2. **不列支持者名单**：只写人数、时间窗、诉求原文。
 *    附议者留的 `note` **不进邮件** —— 那些话是在站内说的，
 *    未经本人同意不该原样转给部门。
 * 3. **给出可回复的落点**：主题里带诉求 ID，正文里说明"回复本邮件即可"，
 *    避免部门不知道找谁。
 *
 * @throws 若未达阈值则抛错 —— 不允许"人不够也发"
 */
export function buildPetitionEmail(petition: Petition, now: Date): PetitionEmail {
  const progress = petitionProgress(petition, now);
  if (!progress.reached) {
    throw new RangeError(
      `petition: 附议数 ${progress.count}/${progress.threshold} 未达阈值，不允许发送`,
    );
  }

  const categoryLabel = PETITION_CATEGORY_LABELS[petition.category];
  const scopeLabel = PETITION_SCOPE_LABELS[petition.scope];
  const deadlineDate = petition.deadline.slice(0, 10);
  const createdDate = petition.createdAt.slice(0, 10);

  const subject = `【学生诉求】${petition.title}（${progress.count} 位同学附议 · ${petition.id}）`;

  const body = [
    `${petition.departmentName} 老师：`,
    '',
    '您好。我们是提交本诉求的同学代表。以下内容由可达鸭校园服务平台汇总，附议数据可在平台核对。',
    '',
    `【诉求】${petition.title}`,
    `【类别】${categoryLabel}　【影响范围】${scopeLabel}${petition.urgent ? '　【紧急】' : ''}`,
    `【附议人数】${progress.count} 人（门槛 ${progress.threshold} 人）`,
    `【征集时间】${createdDate} 至 ${deadlineDate}`,
    '',
    '【详细说明】',
    petition.body.trim(),
    '',
    '【发起人】',
    petition.initiator,
    '',
    '【联系方式】',
    '回复本邮件即可，我们会转达发起人。',
    '',
    '—',
    `诉求编号：${petition.id}`,
    `发送时间：${now.toISOString()}`,
    '本邮件由可达鸭（第三方非官方平台）代学生发送，不代表学校立场。',
  ].join('\n');

  return { to: petition.departmentEmail, subject, body };
}

/* ------------------------------------------------------------------ *
 * 7. 输入校验（与 UI 共用，避免两端不一致）
 * ------------------------------------------------------------------ */

/** 标题上限 —— 太长的标题在邮件主题里会被截断 */
export const PETITION_TITLE_MAX = 60;
/** 正文上限 —— 邮件正文太长部门不会读 */
export const PETITION_BODY_MAX = 2000;
/** 标题下限 —— 「加个窗口」这种两三个字说不清要什么 */
export const PETITION_TITLE_MIN = 6;

export type PetitionDraftProblem =
  | 'title-too-short'
  | 'title-too-long'
  | 'body-too-short'
  | 'body-too-long'
  | 'deadline-in-past'
  | 'deadline-too-far';

export interface PetitionDraftInput {
  readonly title: string;
  readonly body: string;
  readonly deadline: string;
}

/**
 * 校验草稿；返回问题列表（空 = 通过）。
 *
 * 用**问题码**而不是布尔：UI 要给具体提示，不能只说"格式不对"。
 */
export function validatePetitionDraft(
  draft: PetitionDraftInput,
  now: Date,
): readonly PetitionDraftProblem[] {
  const problems: PetitionDraftProblem[] = [];
  const title = draft.title.trim();
  const body = draft.body.trim();

  if (title.length < PETITION_TITLE_MIN) problems.push('title-too-short');
  if (title.length > PETITION_TITLE_MAX) problems.push('title-too-long');
  if (body.length < 20) problems.push('body-too-short');
  if (body.length > PETITION_BODY_MAX) problems.push('body-too-long');

  const deadlineMs = Date.parse(draft.deadline);
  if (Number.isNaN(deadlineMs)) {
    problems.push('deadline-in-past');
  } else {
    if (deadlineMs <= now.getTime()) problems.push('deadline-in-past');
    // 征集期超过 180 天没有意义，也容易变成僵尸诉求
    const maxMs = 180 * 24 * 3600 * 1000;
    if (deadlineMs - now.getTime() > maxMs) problems.push('deadline-too-far');
  }

  return problems;
}

/** 把问题码翻成中文提示（UI 直接用，不各写一份） */
export function describePetitionProblem(problem: PetitionDraftProblem): string {
  const table: Readonly<Record<PetitionDraftProblem, string>> = {
    'title-too-short': `标题至少 ${PETITION_TITLE_MIN} 个字，要说清希望学校做什么`,
    'title-too-long': `标题最多 ${PETITION_TITLE_MAX} 个字，太长的在邮件主题里会被截断`,
    'body-too-short': '说明至少 20 个字，请写清现状、影响与期望',
    'body-too-long': `说明最多 ${PETITION_BODY_MAX} 个字，太长的部门不会读`,
    'deadline-in-past': '截止时间必须晚于现在',
    'deadline-too-far': '征集期最长 180 天，更长的诉求会变成僵尸',
  };
  return table[problem];
}
