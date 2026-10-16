import { describe, expect, it } from 'vitest';
import { InternalError, ValidationError } from '../../../common/errors/app-error';
import {
  ANON_HANDLE_PREFIX,
  FORUM_POST_STATUSES,
  FORUM_POST_TRANSITIONS,
  FORUM_REPORT_AUTO_HIDE_THRESHOLD,
  FORUM_REPORT_REASONS,
  anonHandleFor,
  anonThreadScope,
  canReplyToPost,
  canTransitionForumPost,
  canTransitionForumReply,
  findBannedKeyword,
  isForumPostStatus,
  normalizePostStatus,
  normalizeReportReason,
  parseKeywordList,
  piiHintFor,
  reporterKeyFor,
  requiresModeratorForPostTransition,
  verifyAnonymousHandle,
  type ForumPostStatus,
} from './forum.domain';

/**
 * forum 纯领域逻辑测试（零 IO、零框架）。
 *
 * 重点覆盖任务书点名的两条：
 *   · 匿名身份**同帖同人一致、跨帖不可关联**；
 *   · PII 只提示不拦截、敏感词命中即拦截。
 */
describe('forum 领域 · 匿名身份（契约 §9 解耦存储）', () => {
  const SECRET = 'unit-test-anon-secret';

  it('同一用户 + 同一主题 → handle 稳定一致（同帖同人一致）', () => {
    const a = anonHandleFor('user-1', anonThreadScope('post-1'), SECRET);
    const b = anonHandleFor('user-1', anonThreadScope('post-1'), SECRET);
    expect(a).toBe(b);
  });

  it('同一用户 + 不同主题 → handle 不同（跨帖不可关联）', () => {
    const inPost1 = anonHandleFor('user-1', anonThreadScope('post-1'), SECRET);
    const inPost2 = anonHandleFor('user-1', anonThreadScope('post-2'), SECRET);
    expect(inPost1).not.toBe(inPost2);
  });

  it('不同用户 + 同一主题 → handle 不同', () => {
    const a = anonHandleFor('user-1', anonThreadScope('post-1'), SECRET);
    const b = anonHandleFor('user-2', anonThreadScope('post-1'), SECRET);
    expect(a).not.toBe(b);
  });

  it('handle 里不含实名 userId（解耦存储，不是"存了再隐藏"）', () => {
    const handle = anonHandleFor('20261234', anonThreadScope('post-1'), SECRET);
    expect(handle.startsWith(ANON_HANDLE_PREFIX)).toBe(true);
    expect(handle).not.toContain('20261234');
  });

  it('换密钥 → handle 全变（密钥泄漏才可能被关联）', () => {
    const withA = anonHandleFor('user-1', anonThreadScope('post-1'), 'secret-A');
    const withB = anonHandleFor('user-1', anonThreadScope('post-1'), 'secret-B');
    expect(withA).not.toBe(withB);
  });

  it('缺少密钥时抛 INTERNAL（不允许静默生成可预测 handle）', () => {
    expect(() => anonHandleFor('user-1', anonThreadScope('post-1'), '')).toThrow(InternalError);
  });

  it('未登录（空 userId）不允许派生 handle', () => {
    expect(() => anonHandleFor('', anonThreadScope('post-1'), SECRET)).toThrow(ValidationError);
  });

  it('verifyAnonymousHandle 只认本人', () => {
    const handle = anonHandleFor('user-1', anonThreadScope('post-1'), SECRET);
    expect(verifyAnonymousHandle('user-1', handle, anonThreadScope('post-1'), SECRET)).toBe(true);
    expect(verifyAnonymousHandle('user-2', handle, anonThreadScope('post-1'), SECRET)).toBe(false);
    // 换主题作用域（跨帖）也不认
    expect(verifyAnonymousHandle('user-1', handle, anonThreadScope('post-2'), SECRET)).toBe(false);
    expect(verifyAnonymousHandle('user-1', null, anonThreadScope('post-1'), SECRET)).toBe(false);
    expect(verifyAnonymousHandle('', handle, anonThreadScope('post-1'), SECRET)).toBe(false);
  });
});

describe('forum 领域 · 主题状态机（02-domain-model §2.4）', () => {
  it('状态图里的迁移全部允许', () => {
    for (const [from, to] of FORUM_POST_TRANSITIONS) {
      expect(canTransitionForumPost(from, to)).toBe(true);
    }
  });

  it('同一状态视为幂等（PATCH 传原值不算冲突）', () => {
    for (const status of FORUM_POST_STATUSES) {
      expect(canTransitionForumPost(status, status)).toBe(true);
    }
  });

  it('状态图之外的迁移全部拒绝（如 deleted → published、draft → locked）', () => {
    expect(canTransitionForumPost('DELETED', 'PUBLISHED')).toBe(false);
    expect(canTransitionForumPost('DRAFT', 'LOCKED')).toBe(false);
    expect(canTransitionForumPost('DRAFT', 'HIDDEN')).toBe(false);
    expect(canTransitionForumPost('HIDDEN', 'LOCKED')).toBe(false);
  });

  it('锁定 / 隐藏 / 恢复需要版主权限，作者自己不能隐藏或解锁', () => {
    expect(requiresModeratorForPostTransition('PUBLISHED', 'HIDDEN')).toBe(true);
    expect(requiresModeratorForPostTransition('PUBLISHED', 'LOCKED')).toBe(true);
    expect(requiresModeratorForPostTransition('LOCKED', 'PUBLISHED')).toBe(true);
    expect(requiresModeratorForPostTransition('HIDDEN', 'PUBLISHED')).toBe(true);
    // 作者自助的迁移不算治理
    expect(requiresModeratorForPostTransition('DRAFT', 'PUBLISHED')).toBe(false);
    expect(requiresModeratorForPostTransition('PUBLISHED', 'DELETED')).toBe(false);
  });

  it('锁定 / 隐藏 / 删除的主题都不能再回复', () => {
    expect(canReplyToPost('PUBLISHED')).toBe(true);
    for (const status of ['DRAFT', 'LOCKED', 'HIDDEN', 'DELETED'] as ForumPostStatus[]) {
      expect(canReplyToPost(status)).toBe(false);
    }
  });

  it('回复状态机：published↔hidden、→deleted', () => {
    expect(canTransitionForumReply('PUBLISHED', 'HIDDEN')).toBe(true);
    expect(canTransitionForumReply('HIDDEN', 'PUBLISHED')).toBe(true);
    expect(canTransitionForumReply('PUBLISHED', 'DELETED')).toBe(true);
    expect(canTransitionForumReply('HIDDEN', 'DELETED')).toBe(true);
    expect(canTransitionForumReply('DELETED', 'PUBLISHED')).toBe(false);
  });

  it('isForumPostStatus 只接受冻结的 5 个**大写**状态', () => {
    for (const status of FORUM_POST_STATUSES) expect(isForumPostStatus(status)).toBe(true);
    expect(isForumPostStatus('published')).toBe(false); // 小写不是 canonical
    expect(isForumPostStatus('archived')).toBe(false);
    expect(isForumPostStatus(undefined)).toBe(false);
  });

  it('normalizePostStatus 容忍小写输入并归一化为大写（wire canonical 是大写）', () => {
    expect(normalizePostStatus('published')).toBe('PUBLISHED');
    expect(normalizePostStatus(' Hidden ')).toBe('HIDDEN');
    expect(normalizePostStatus('archived')).toBeNull();
    expect(normalizePostStatus(undefined)).toBeNull();
  });
});

describe('forum 领域 · 举报枚举（任务书 vs 02-domain-model 的冲突归一）', () => {
  it('任务书的 5 个原因全部接受', () => {
    expect([...FORUM_REPORT_REASONS]).toEqual(['spam', 'abuse', 'pii', 'illegal', 'other']);
    for (const reason of FORUM_REPORT_REASONS) {
      expect(normalizeReportReason(reason)).toBe(reason);
    }
  });

  it('02-domain-model 里的旧写法 privacy 归一化为 pii', () => {
    expect(normalizeReportReason('privacy')).toBe('pii');
    expect(normalizeReportReason('PRIVACY')).toBe('pii');
  });

  it('大小写与空白容忍，未知值返回 null', () => {
    expect(normalizeReportReason(' SPAM ')).toBe('spam');
    expect(normalizeReportReason('harassment')).toBeNull();
    expect(normalizeReportReason('')).toBeNull();
  });

  it('阈值是 3 个不同用户', () => {
    expect(FORUM_REPORT_AUTO_HIDE_THRESHOLD).toBe(3);
  });

  it('reporterKey 实名与匿名前缀不同，且都不等于实名 id 本身', () => {
    expect(reporterKeyFor('user-1', undefined)).toBe('user:user-1');
    expect(reporterKeyFor(undefined, 'anon_abc')).toBe('anon:anon_abc');
    expect(() => reporterKeyFor(undefined, undefined)).toThrow(ValidationError);
  });
});

describe('forum 领域 · 内容提示（PII 提示 / 敏感词拦截）', () => {
  it('手机号 / 邮箱 / 学号触发 PII 提示', () => {
    expect(piiHintFor('联系我 13800138000')).toBe(true);
    expect(piiHintFor('邮箱 a@b.com')).toBe(true);
    expect(piiHintFor('学号 20261234')).toBe(true);
  });

  it('普通内容不触发提示', () => {
    expect(piiHintFor('今天天气不错', '求推荐食堂')).toBe(false);
    expect(piiHintFor(undefined, null)).toBe(false);
  });

  it('敏感词命中返回命中的词；词表为空时永不命中', () => {
    expect(findBannedKeyword('这里有代写服务', ['代写'])).toBe('代写');
    expect(findBannedKeyword('正常内容', ['代写'])).toBeNull();
    expect(findBannedKeyword('代写', [])).toBeNull();
  });

  it('parseKeywordList 去空白、去重、忽略空项', () => {
    expect(parseKeywordList(' 代写 , 刷单 ,, 代写 ')).toEqual(['代写', '刷单']);
    expect(parseKeywordList('')).toEqual([]);
    expect(parseKeywordList(undefined)).toEqual([]);
  });
});
