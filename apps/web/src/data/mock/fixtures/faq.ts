/**
 * 常见问题 mock 数据集 —— 保证**无后端也能跑通**（契约 §7 硬规则 4）。
 *
 * 覆盖 5 个分类、3 种条目状态（含 1 条 ARCHIVED 用于验证"归档不出现"）、
 * 以及 3 种工单状态（OPEN / ANSWERED / CLOSED）。
 */
import type { FaqArticle, FaqTicket } from '@/domain/models/faq';

function iso(base: Date, deltaMs: number): string {
  return new Date(base.getTime() + deltaMs).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function createFaqArticleSeed(now: Date): FaqArticle[] {
  return [
    {
      id: 'faq-1001',
      slug: 'login-cas-failed',
      question: '统一身份认证登录失败怎么办？',
      answer:
        '1. 确认学号/工号与密码在**学校统一身份认证页面**可以正常登录。\n' +
        '2. 若学校页面能登录、可达鸭不行，通常是浏览器拦截了第三方 Cookie，请允许后重试。\n' +
        '3. 连续失败 5 次会触发学校侧限流，请等待 15 分钟。\n' +
        '4. 仍不行请提交工单，附上页面右下角的 traceId。',
      category: 'account',
      status: 'PUBLISHED',
      helpfulCount: 42,
      unhelpfulCount: 3,
      updatedAt: iso(now, -2 * DAY),
    },
    {
      id: 'faq-1002',
      slug: 'campus-binding-required',
      question: '为什么提示「需要先绑定校园系统」？',
      answer:
        '可达鸭把身份分成两层：第一级是统一身份认证（决定你是谁），第二级是各校园系统的绑定（决定你能访问哪些系统）。\n' +
        '「已登录但未绑定」是合法状态 —— 此时浏览类功能可用，课表/校园卡等能力会返回 `CAMPUS_BINDING_REQUIRED`。\n' +
        '到「我的 → 校园系统绑定」完成授权即可。',
      category: 'account',
      status: 'PUBLISHED',
      helpfulCount: 31,
      unhelpfulCount: 5,
      updatedAt: iso(now, -5 * DAY),
    },
    {
      id: 'faq-1003',
      slug: 'anonymous-how-it-works',
      question: '论坛匿名发帖，别人还能查到我是谁吗？',
      answer:
        '普通用户看不到你的姓名、学号与院系 —— 帖子只记录一个匿名身份。\n' +
        '但请注意：为了处理违规内容，**同一匿名身份在同一版块内可被版主追溯**，该信息不对普通用户公开。\n' +
        '匿名不豁免社区公约；举报达 3 个不同用户仍会自动隐藏并进人工队列。',
      category: 'privacy',
      status: 'PUBLISHED',
      helpfulCount: 58,
      unhelpfulCount: 2,
      updatedAt: iso(now, -8 * HOUR),
    },
    {
      id: 'faq-1004',
      slug: 'report-and-appeal',
      question: '我举报了别人 / 我的帖子被举报了，接下来会发生什么？',
      answer:
        '1. 举报提交后状态为「待人工复核」。\n' +
        '2. 同一内容被 **3 个不同用户**举报时会自动隐藏，并在列表里显示明确状态（不会静默消失）。\n' +
        '3. 作者可在 7 天内提交申诉；版主会在 48 小时内答复。\n' +
        '4. 举报不成立时内容恢复，举报记录状态变为「举报不成立」。',
      category: 'governance',
      status: 'PUBLISHED',
      helpfulCount: 25,
      unhelpfulCount: 1,
      updatedAt: iso(now, -3 * DAY),
    },
    {
      id: 'faq-1005',
      slug: 'groupbuy-how-to-join',
      question: '拼单怎么参团？钱什么时候扣？',
      answer:
        '在拼单详情页点「立即参团」并选择份数即可。\n' +
        '金额一律以**整数分**在服务端计算；成团后 30 分钟内完成支付，未支付的名额会自动释放。\n' +
        '拼单已取消或已过截止时间时，参团会返回冲突提示。',
      category: 'modules',
      status: 'PUBLISHED',
      helpfulCount: 19,
      unhelpfulCount: 4,
      updatedAt: iso(now, -4 * DAY),
    },
    {
      id: 'faq-1006',
      slug: 'faq-ticket-contact',
      question: '提交工单为什么要填邮箱而不是手机号？',
      answer:
        '出于数据最小化原则，可达鸭**不保存明文手机号**。\n' +
        '请填写上科大邮箱或微信号：邮箱用于接收回复通知，微信号用于人工联系。\n' +
        '工单已回复后 7 天未确认会自动关闭。',
      category: 'privacy',
      status: 'PUBLISHED',
      helpfulCount: 12,
      unhelpfulCount: 0,
      updatedAt: iso(now, -6 * DAY),
    },
    {
      id: 'faq-1007',
      slug: 'data-export-delete',
      question: '我能导出或删除自己的数据吗？',
      answer:
        '可以。到「我的 → 隐私与数据」发起导出（打包为 JSON）或删除申请。\n' +
        '删除后与实名身份解耦的匿名内容会保留但无法回溯到你，审计日志按合规要求保留 180 天。',
      category: 'privacy',
      status: 'PUBLISHED',
      helpfulCount: 8,
      unhelpfulCount: 1,
      updatedAt: iso(now, -10 * DAY),
    },
    {
      id: 'faq-1008',
      slug: 'errand-safety',
      question: '跑腿接单有什么安全注意事项？',
      answer: '仅在校内公共区域交接；不要代取含个人证件、银行卡的包裹；异常情况请立即取消并在工单里说明。',
      category: 'modules',
      status: 'PUBLISHED',
      helpfulCount: 6,
      unhelpfulCount: 0,
      updatedAt: iso(now, -12 * DAY),
    },
    {
      id: 'faq-1009',
      slug: 'deprecated-campus-card-page',
      question: '（已归档）校园卡付款码在哪一版界面里？',
      answer: '本条目对应旧版界面，已归档，不再作为搜索结果展示。',
      category: 'other',
      status: 'ARCHIVED',
      helpfulCount: 3,
      unhelpfulCount: 9,
      updatedAt: iso(now, -60 * DAY),
    },
    {
      id: 'faq-1010',
      slug: 'wip-notification-settings',
      question: '（草稿）通知订阅怎么配？',
      answer: '待补：小程序订阅消息与 Web 站内信的区别。',
      category: 'other',
      status: 'DRAFT',
      helpfulCount: 0,
      unhelpfulCount: 0,
      updatedAt: iso(now, -30 * MINUTE),
    },
  ];
}

export function createFaqTicketSeed(now: Date): FaqTicket[] {
  return [
    {
      id: 'ft-5001',
      userId: 'u_1024',
      contact: 'yaya@shanghaitech.edu.cn',
      question: '课表一直显示「需要绑定」，但我已经在教务系统登录过了。',
      status: 'OPEN',
      createdAt: iso(now, -2 * DAY),
      updatedAt: iso(now, -2 * DAY),
    },
    {
      id: 'ft-5002',
      userId: 'u_1024',
      contact: 'wechat: yaya_duck',
      question: '拼单成团后想退团，点了没有反应。',
      status: 'ANSWERED',
      createdAt: iso(now, -5 * DAY),
      updatedAt: iso(now, -4 * DAY),
      answeredAt: iso(now, -4 * DAY),
      answer: '已修复：成团后成员退团需要发起人确认，入口在详情页「成员」区块。请再试一次。',
    },
    {
      id: 'ft-5003',
      userId: 'u_1024',
      contact: 'lib@shanghaitech.edu.cn',
      question: '建议论坛增加「已解决」标记。',
      status: 'CLOSED',
      createdAt: iso(now, -20 * DAY),
      updatedAt: iso(now, -12 * DAY),
      answeredAt: iso(now, -13 * DAY),
      answer: '已纳入 v1.1 需求池，感谢反馈。',
    },
  ];
}
