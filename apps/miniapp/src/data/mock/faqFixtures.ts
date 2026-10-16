import type { FaqArticle, FaqTicket } from '../../domain/models/faq'
import { MOCK_NOW_ISO, MOCK_PROFILE } from './fixtures'

/**
 * FAQ mock 种子数据 —— 无后端可跑（契约 §7 硬规则 4）。
 *
 * 覆盖点：
 * - 分类 ≥4 个，便于演示分类切换与搜索；
 * - 含 `DRAFT` / `ARCHIVED` 各一条，验证「只有 PUBLISHED 对用户可见」；
 * - 工单同时包含**已登录**与**未登录（`userId: null`）**两种归属（domain-model §2.8）。
 */

function shiftHours(baseIso: string, hours: number): string {
  return new Date(new Date(baseIso).getTime() + hours * 3_600_000).toISOString()
}

export const MOCK_FAQ_ARTICLES: readonly FaqArticle[] = [
  {
    id: 'faq-4001',
    slug: 'login-sso',
    question: '如何用上科大统一身份登录可达鸭？',
    answer:
      '在「我的」页点击登录，会跳转学校统一身份认证（CAS/Egate）。认证通过后可达鸭只保存自有的 KedaYa JWT，不会保存你的校园系统密码。',
    category: '账号与登录',
    status: 'PUBLISHED',
    helpfulCount: 12,
    unhelpfulCount: 1,
    updatedAt: shiftHours(MOCK_NOW_ISO, -72),
  },
  {
    id: 'faq-4002',
    slug: 'login-failed',
    question: '登录失败提示「身份校验不通过」怎么办？',
    answer:
      '先确认账号密码能在学校其他系统登录。如果刚改过密码，请等待 10 分钟后重试；仍失败可在本页提交工单，附上出错时间。',
    category: '账号与登录',
    status: 'PUBLISHED',
    helpfulCount: 8,
    unhelpfulCount: 2,
    updatedAt: shiftHours(MOCK_NOW_ISO, -60),
  },
  {
    id: 'faq-4003',
    slug: 'campus-card-balance',
    question: '校园卡余额在哪里查？',
    answer: '「校园卡」模块可查看余额与流水。该功能需要先绑定校园系统（第二级能力层），未绑定时会提示绑定。',
    category: '校园卡',
    status: 'PUBLISHED',
    helpfulCount: 6,
    unhelpfulCount: 0,
    updatedAt: shiftHours(MOCK_NOW_ISO, -48),
  },
  {
    id: 'faq-4004',
    slug: 'campus-card-lost',
    question: '校园卡丢了怎么挂失？',
    answer: '请第一时间在一卡通官方渠道挂失。可达鸭不代持一卡通凭据，因此无法代为挂失。',
    category: '校园卡',
    status: 'PUBLISHED',
    helpfulCount: 4,
    unhelpfulCount: 1,
    updatedAt: shiftHours(MOCK_NOW_ISO, -36),
  },
  {
    id: 'faq-4005',
    slug: 'groupbuy-payment',
    question: '拼单需要平台代收货款吗？',
    answer: '不需要。可达鸭只做信息撮合，货款由同学之间自行结算，平台不代收、不担保。',
    category: '拼单与交易',
    status: 'PUBLISHED',
    helpfulCount: 15,
    unhelpfulCount: 0,
    updatedAt: shiftHours(MOCK_NOW_ISO, -30),
  },
  {
    id: 'faq-4006',
    slug: 'anonymous-post',
    question: '匿名发帖是真的匿名吗？',
    answer:
      '对普通同学匿名：别人看不到你的昵称与学号。但为配合社区治理，版主可以在同一板块内追溯同一匿名身份。举报违规内容时也遵循同一原则。',
    category: '隐私与安全',
    status: 'PUBLISHED',
    helpfulCount: 9,
    unhelpfulCount: 3,
    updatedAt: shiftHours(MOCK_NOW_ISO, -20),
  },
  {
    id: 'faq-4007',
    slug: 'ticket-guide',
    question: '找不到答案时怎么提问？',
    answer: '在「我的工单」页提交工单，留下邮箱或微信号即可。请勿填写手机号，平台不保存明文手机号。',
    category: '其它',
    status: 'PUBLISHED',
    helpfulCount: 3,
    unhelpfulCount: 0,
    updatedAt: shiftHours(MOCK_NOW_ISO, -12),
  },
  {
    id: 'faq-4008',
    slug: 'draft-only',
    question: '（草稿）尚未发布的文章不应出现在列表',
    answer: '草稿内容。',
    category: '其它',
    status: 'DRAFT',
    helpfulCount: 0,
    unhelpfulCount: 0,
    updatedAt: shiftHours(MOCK_NOW_ISO, -6),
  },
  {
    id: 'faq-4009',
    slug: 'archived-only',
    question: '（已归档）过期的活动说明',
    answer: '活动已结束。',
    category: '其它',
    status: 'ARCHIVED',
    helpfulCount: 1,
    unhelpfulCount: 0,
    updatedAt: shiftHours(MOCK_NOW_ISO, -96),
  },
]

export const MOCK_FAQ_TICKETS: readonly FaqTicket[] = [
  {
    id: 'ft-5001',
    userId: MOCK_PROFILE.id,
    contact: 'student@shanghaitech.edu.cn',
    question: '拼单页面的截止时间显示成了英文，能修一下吗？',
    status: 'OPEN',
    createdAt: shiftHours(MOCK_NOW_ISO, -5),
    updatedAt: shiftHours(MOCK_NOW_ISO, -5),
  },
  {
    id: 'ft-5002',
    userId: MOCK_PROFILE.id,
    contact: 'wechat: kdy_helper',
    question: '匿名发帖后还能自己删除吗？',
    status: 'ANSWERED',
    answer: '可以，作者可在主题详情页删除自己的帖子。',
    createdAt: shiftHours(MOCK_NOW_ISO, -30),
    updatedAt: shiftHours(MOCK_NOW_ISO, -28),
  },
  {
    id: 'ft-5003',
    userId: null,
    contact: 'anon@shanghaitech.edu.cn',
    question: '未登录也能提工单吗？',
    status: 'OPEN',
    createdAt: shiftHours(MOCK_NOW_ISO, -2),
    updatedAt: shiftHours(MOCK_NOW_ISO, -2),
  },
]
