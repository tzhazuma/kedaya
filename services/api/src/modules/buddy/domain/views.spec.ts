import { describe, expect, it } from 'vitest';
import {
  CONTACT_FIELDS,
  FORBIDDEN_RESPONSE_FIELDS,
  assertNoForbiddenFields,
  canViewApplication,
  findForbiddenFields,
  toApplicationView,
  toPostDetailView,
  toPostListView,
  toProfileView,
  type ApplicationRow,
  type CreatorRow,
  type PostRow,
  type ProfileRow,
} from './views';

/**
 * 验收 T26 / T27 / T28（规格 §6.1 可见性矩阵 / §8.4）：
 *   T26 任何 `buddy` 响应**不含** `gender` / `age` / `birthDate` / `mbti` / `embedding`
 *   T27 `GET /items` 与 `GET /items/:id`（非申请人视角）**不含**任何联系方式字段
 *   T28 `BuddyProfile` 不出现在任何 `GET` 响应的他人视角中
 *
 * 这些断言之所以有效，是因为视图是 **domain 纯函数** ——
 * 如果是散在 controller 里的 `map`，就只能靠 code review 保证。
 */

const POST: PostRow = {
  id: 'post-1',
  creatorId: 'creator-1',
  activity: 'sport',
  status: 'OPEN',
  title: '周六下午羽毛球，缺 2 人',
  description: '体育馆 3 号场，打两小时，新手也行',
  location: '体育馆',
  startsAt: new Date('2026-10-24T06:00:00.000Z'),
  durationMin: 120,
  capacity: 4,
  joinedCount: 2,
  genderPreference: 'any',
  tags: ['badminton', 'indoor'],
  minSkillLevel: null,
  createdAt: new Date('2026-10-17T02:00:00.000Z'),
};

const CREATOR: CreatorRow = { id: 'creator-1', displayName: '鸭鸭', avatarUrl: null };

const APPLICATION: ApplicationRow = {
  id: 'app-1',
  postId: 'post-1',
  applicantId: 'applicant-1',
  status: 'PENDING',
  message: '我也常打，一起？',
  decidedAt: null,
  decidedBy: null,
  createdAt: new Date('2026-10-17T03:00:00.000Z'),
};

const PROFILE: ProfileRow = {
  userId: 'me',
  sections: ['sport'],
  interestTags: ['badminton'],
  activityTags: ['badminton'],
  skillLevel: 'regular',
  availability: [{ dow: 6, startMin: 840, endMin: 1020 }],
  preferredAreas: ['体育馆'],
  department: '信息学院',
  bio: '常打羽毛球',
  matchEnabled: true,
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
};

describe('T26：任何视图都不含禁用字段（递归扫描）', () => {
  it('列表视图不含 gender / age / birthDate / mbti / embedding / embeddingModel', () => {
    const view = toPostListView(POST, CREATOR);
    expect(findForbiddenFields(view)).toEqual([]);
    assertNoForbiddenFields(view);
  });

  it('详情视图（他人视角）同样干净', () => {
    const view = toPostDetailView(POST, CREATOR, 'someone-else');
    expect(findForbiddenFields(view)).toEqual([]);
  });

  it('资料视图不含 embedding / embeddingModel / userId', () => {
    const view = toProfileView(PROFILE);
    expect(findForbiddenFields(view)).toEqual([]);
    expect(view).not.toHaveProperty('embedding');
    expect(view).not.toHaveProperty('embeddingModel');
    expect(view).not.toHaveProperty('userId');
  });

  it('申请视图干净', () => {
    expect(findForbiddenFields(toApplicationView(APPLICATION))).toEqual([]);
  });

  it('递归扫描**真的会**发现嵌套的禁用字段（否则上面的断言毫无意义）', () => {
    const leaky = { creator: { id: 'x', gender: 'female' } };
    expect(findForbiddenFields(leaky)).toEqual([{ path: '$.creator.gender', field: 'gender' }]);
    expect(() => assertNoForbiddenFields(leaky)).toThrow(/禁止出网的字段/);
  });

  it('递归扫描能穿透数组（`items[0].embedding` 这种最容易漏）', () => {
    const leaky = { items: [{ id: 'a' }, { id: 'b', embedding: [0.1] }] };
    expect(findForbiddenFields(leaky).map((f) => f.path)).toEqual(['$.items[1].embedding']);
  });

  it('禁用字段清单覆盖规格 §6.3 的"不采集敏感属性"', () => {
    for (const field of ['gender', 'age', 'birthDate', 'mbti']) {
      expect(FORBIDDEN_RESPONSE_FIELDS).toContain(field);
    }
    expect(FORBIDDEN_RESPONSE_FIELDS).toContain('embedding');
  });
});

describe('T27：列表与详情（非申请人视角）不含联系方式字段', () => {
  it('列表视图没有任何联系方式字段', () => {
    const view = toPostListView(POST, CREATOR) as unknown as Record<string, unknown>;
    for (const field of CONTACT_FIELDS) {
      expect(view).not.toHaveProperty(field);
    }
  });

  it('详情视图（非申请人）没有任何联系方式字段', () => {
    const view = toPostDetailView(POST, CREATOR, 'someone-else') as unknown as Record<string, unknown>;
    for (const field of CONTACT_FIELDS) {
      expect(view).not.toHaveProperty(field);
    }
  });

  it('发起人对象只含 id / nickname / avatarUrl（不多带一个字段）', () => {
    const view = toPostListView(POST, CREATOR);
    expect(Object.keys(view.creator).sort()).toEqual(['avatarUrl', 'id', 'nickname']);
  });
});

describe('T28：BuddyProfile 不出现在他人视角', () => {
  it('详情视图里没有 interestTags / availability / preferredAreas / matchEnabled', () => {
    const view = toPostDetailView(POST, CREATOR, 'someone-else') as unknown as Record<string, unknown>;
    for (const field of ['interestTags', 'activityTags', 'availability', 'preferredAreas', 'matchEnabled', 'sections', 'bio']) {
      expect(view).not.toHaveProperty(field);
    }
  });

  it('**只有** GET /profile（本人）会调用 toProfileView —— 这是唯一的出口', () => {
    // 结构性断言：资料视图的字段集合里没有任何"他人可读"的东西
    const view = toProfileView(PROFILE);
    expect(Object.keys(view).sort()).toEqual([
      'activityTags',
      'availability',
      'bio',
      'department',
      'interestTags',
      'matchEnabled',
      'preferredAreas',
      'sections',
      'skillLevel',
      'updatedAt',
    ]);
  });
});

describe('列表 / 详情视图的字段集合（规格 §5.3）', () => {
  it('列表**不含** description（减少载荷与爬取面）', () => {
    const view = toPostListView(POST, CREATOR);
    expect(view).not.toHaveProperty('description');
  });

  it('详情**含** description 全文', () => {
    const view = toPostDetailView(POST, CREATOR, 'viewer');
    expect(view.description).toBe(POST.description);
  });

  it('列表视图按规格 §5.3 的响应示例给出字段', () => {
    const view = toPostListView(POST, CREATOR);
    expect(Object.keys(view).sort()).toEqual([
      'activity',
      'capacity',
      'createdAt',
      'creator',
      'durationMin',
      'genderPreference',
      'id',
      'joinedCount',
      'location',
      'minSkillLevel',
      'section',
      'startsAt',
      'status',
      'tags',
      'title',
    ]);
  });

  it('section 由 activity 派生（不落库，规格 §2.3）', () => {
    expect(toPostListView({ ...POST, activity: 'study' }, CREATOR).section).toBe('academic');
    expect(toPostListView({ ...POST, activity: 'meal' }, CREATOR).section).toBe('daily');
    expect(toPostListView({ ...POST, activity: 'sport' }, CREATOR).section).toBe('sport');
  });

  it('时间统一序列化为 ISO-8601 字符串', () => {
    const view = toPostListView(POST, CREATOR);
    expect(view.startsAt).toBe('2026-10-24T06:00:00.000Z');
    expect(view.createdAt).toBe('2026-10-17T02:00:00.000Z');
  });

  it('tags 是副本：改视图不会污染领域模型', () => {
    const view = toPostListView(POST, CREATOR);
    view.tags.push('hacked');
    expect(POST.tags).toEqual(['badminton', 'indoor']);
  });
});

describe('详情视图的视角标记', () => {
  it('发起人视角 isCreator=true；他人 false', () => {
    expect(toPostDetailView(POST, CREATOR, 'creator-1').isCreator).toBe(true);
    expect(toPostDetailView(POST, CREATOR, 'someone-else').isCreator).toBe(false);
    expect(toPostDetailView(POST, CREATOR, undefined).isCreator).toBe(false);
  });

  it('myApplicationStatus 透传（无申请为 null）', () => {
    expect(toPostDetailView(POST, CREATOR, 'x', 'PENDING').myApplicationStatus).toBe('PENDING');
    expect(toPostDetailView(POST, CREATOR, 'x').myApplicationStatus).toBeNull();
  });
});

describe('canViewApplication（规格 §6.1 申请人列表可见性）', () => {
  const post = { creatorId: 'creator-1' };
  const application = { applicantId: 'applicant-1' };

  it('发起人可见', () => {
    expect(canViewApplication(application, post, 'creator-1')).toBe(true);
  });

  it('申请人本人可见', () => {
    expect(canViewApplication(application, post, 'applicant-1')).toBe(true);
  });

  it('其他已登录用户不可见', () => {
    expect(canViewApplication(application, post, 'someone-else')).toBe(false);
  });

  it('未登录不可见（本模块全部端点要求登录，这里是纵深防御）', () => {
    expect(canViewApplication(application, post, undefined)).toBe(false);
  });
});
