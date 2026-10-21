import { describe, expect, it } from 'vitest';

import {
  buildPetitionEmail,
  canTransitionPetition,
  describePetitionProblem,
  PETITION_BASE_THRESHOLDS,
  PETITION_CATEGORIES,
  PETITION_DEPARTMENTS,
  PETITION_STATUSES,
  petitionProgress,
  petitionThreshold,
  suggestPetitionStatus,
  transitionPetition,
  validatePetitionDraft,
  type Petition,
  type PetitionEndorsement,
} from './petitions';

/**
 * 众筹诉求的规则层。
 *
 * ## 这组测试的重心
 *
 * 1. **阈值分档真的分档** —— 小事不该永远够不到，大事不该轻易算"民意"
 * 2. **状态机只有表里的迁移** —— 不允许静默灵活处理
 * 3. **`ready ≠ submitted`** —— 人数够了不等于已经反映了
 * 4. **邮件只用可核对的数字，且不列支持者名单**
 * 5. **人不够时邮件生成必须抛错**，不能"人不够也发"
 */
const NOW = new Date('2026-10-20T00:00:00.000Z');

function endorse(n: number): PetitionEndorsement[] {
  return Array.from({ length: n }, (_, i) => ({
    endorsementId: `e-${i}`,
    endorsedAt: '2026-10-15T00:00:00.000Z',
    note: i === 0 ? '这个真的很重要' : null,
  }));
}

function petition(over: Partial<Petition> = {}): Petition {
  return {
    id: 'P-2026-001',
    title: '希望二食堂增加素食窗口',
    body: '目前二食堂素食选择很少，素食同学每餐只能吃配菜。希望能增设一个素食窗口，哪怕只在午餐时段开放。',
    category: 'canteen',
    scope: 'group',
    urgent: false,
    status: 'collecting',
    initiator: '张三',
    departmentName: '后勤服务中心',
    departmentEmail: 'logistics@shanghaitech.edu.cn',
    createdAt: '2026-10-01T00:00:00.000Z',
    deadline: '2026-11-01T00:00:00.000Z',
    endorsements: endorse(0),
    submission: null,
    response: null,
    ...over,
  };
}

describe('阈值：分档且紧急打折', () => {
  it('三档阈值递增', () => {
    expect(PETITION_BASE_THRESHOLDS.personal).toBeLessThan(PETITION_BASE_THRESHOLDS.group);
    expect(PETITION_BASE_THRESHOLDS.group).toBeLessThan(PETITION_BASE_THRESHOLDS.campus);
  });

  it('紧急诉求阈值减半，但有下限 3', () => {
    // 10 → 5
    expect(petitionThreshold('personal', true)).toBe(5);
    // 30 → 15
    expect(petitionThreshold('group', true)).toBe(15);
    // 100 → 50
    expect(petitionThreshold('campus', true)).toBe(50);
    // 下限保护：即使基础阈值很低也不会低于 3
    expect(petitionThreshold('personal', true)).toBeGreaterThanOrEqual(3);
  });

  it('非紧急就是基础阈值', () => {
    for (const scope of ['personal', 'group', 'campus'] as const) {
      expect(petitionThreshold(scope, false)).toBe(PETITION_BASE_THRESHOLDS[scope]);
    }
  });
});

describe('进度计算', () => {
  it('未达标时 remaining 正确', () => {
    const p = petitionProgress(petition({ endorsements: endorse(12) }), NOW);
    expect(p.count).toBe(12);
    expect(p.threshold).toBe(30);
    expect(p.remaining).toBe(18);
    expect(p.reached).toBe(false);
    expect(p.ratio).toBeCloseTo(12 / 30);
  });

  it('达标时 remaining = 0，ratio 封顶 1', () => {
    const p = petitionProgress(petition({ endorsements: endorse(100) }), NOW);
    expect(p.remaining).toBe(0);
    expect(p.reached).toBe(true);
    expect(p.ratio).toBe(1);
  });

  it('⚠️ 已提交后不再接受附议（否则数字会对不上）', () => {
    const base = petition({ endorsements: endorse(30) });
    expect(petitionProgress(base, NOW).accepting).toBe(true);
    expect(petitionProgress({ ...base, status: 'submitted' }, NOW).accepting).toBe(false);
    expect(petitionProgress({ ...base, status: 'answered' }, NOW).accepting).toBe(false);
  });

  it('过期后不接受附议', () => {
    const expired = petition({ deadline: '2026-10-01T00:00:00.000Z' });
    const p = petitionProgress(expired, NOW);
    expect(p.expired).toBe(true);
    expect(p.accepting).toBe(false);
  });

  it('终态一律不接受附议', () => {
    for (const status of ['resolved', 'rejected', 'withdrawn'] as const) {
      const p = petitionProgress(petition({ status }), NOW);
      expect(p.accepting).toBe(false);
    }
  });
});

describe('⚠️ ready ≠ submitted', () => {
  it('人数够了只建议 ready，不跳到 submitted', () => {
    const p = petition({ endorsements: endorse(30), status: 'collecting' });
    expect(suggestPetitionStatus(p, NOW)).toBe('ready');
  });

  it('已 ready 但人数掉了 → 建议退回 collecting', () => {
    const p = petition({ endorsements: endorse(5), status: 'ready' });
    expect(suggestPetitionStatus(p, NOW)).toBe('collecting');
  });

  it('⚠️ 从任何非 submitted 状态都不会「建议」跳到 submitted', () => {
    // `suggestPetitionStatus` 只根据人数变化给建议；跳到 submitted 必须有人
    // 真的点了发送（并有回执）。所以除了「本来就是 submitted」这种原样返回，
    // 它永远不该把别的状态变成 submitted。
    const rich = petition({ endorsements: endorse(999) });
    for (const status of PETITION_STATUSES) {
      if (status === 'submitted') continue; // 原样返回，不是「建议」
      expect(suggestPetitionStatus({ ...rich, status }, NOW)).not.toBe('submitted');
    }
  });
});

describe('状态机', () => {
  it('合法迁移表', () => {
    expect(canTransitionPetition('draft', 'collecting')).toBe(true);
    expect(canTransitionPetition('collecting', 'ready')).toBe(true);
    expect(canTransitionPetition('ready', 'submitted')).toBe(true);
    expect(canTransitionPetition('submitted', 'answered')).toBe(true);
    expect(canTransitionPetition('answered', 'resolved')).toBe(true);
    expect(canTransitionPetition('answered', 'rejected')).toBe(true);
  });

  it('⚠️ 跳过中间态是非法的', () => {
    // 不能从 collecting 直接到 submitted（没经过 ready）
    expect(canTransitionPetition('collecting', 'submitted')).toBe(false);
    // 不能从 draft 直接到 ready
    expect(canTransitionPetition('draft', 'ready')).toBe(false);
  });

  it('终态不可再迁移', () => {
    for (const from of ['resolved', 'rejected', 'withdrawn'] as const) {
      for (const to of PETITION_STATUSES) {
        expect(canTransitionPetition(from, to)).toBe(false);
      }
    }
  });

  it('非法迁移抛错而不是静默返回', () => {
    expect(() => transitionPetition('resolved', 'collecting')).toThrow(RangeError);
    expect(() => transitionPetition('collecting', 'submitted')).toThrow(/非法状态迁移/);
  });

  it('合法迁移原样返回目标状态', () => {
    expect(transitionPetition('collecting', 'ready')).toBe('ready');
  });
});

describe('邮件生成', () => {
  const atThreshold = petition({ endorsements: endorse(30) });

  it('达标时能生成，主题带人数与编号', () => {
    const mail = buildPetitionEmail(atThreshold, NOW);
    expect(mail.to).toBe('logistics@shanghaitech.edu.cn');
    expect(mail.subject).toContain('30 位同学附议');
    expect(mail.subject).toContain('P-2026-001');
    expect(mail.subject).toContain('希望二食堂增加素食窗口');
  });

  it('正文含诉求原文与可核对的数字', () => {
    const mail = buildPetitionEmail(atThreshold, NOW);
    expect(mail.body).toContain('【附议人数】30 人（门槛 30 人）');
    expect(mail.body).toContain('目前二食堂素食选择很少');
    expect(mail.body).toContain('【发起人】');
    expect(mail.body).toContain('张三');
  });

  it('⚠️ 不列支持者名单，也不转发附议者留言', () => {
    const mail = buildPetitionEmail(atThreshold, NOW);
    // 第一条附议留了言，但邮件里不该出现
    expect(mail.body).not.toContain('这个真的很重要');
    // 不该出现任何 endorsementId
    expect(mail.body).not.toContain('e-0');
  });

  it('⚠️ 人不够时抛错，不允许"人不够也发"', () => {
    const notEnough = petition({ endorsements: endorse(29) });
    expect(() => buildPetitionEmail(notEnough, NOW)).toThrow(/未达阈值/);
  });

  it('紧急诉求的邮件标注【紧急】', () => {
    const urgent = petition({ endorsements: endorse(15), scope: 'group', urgent: true });
    const mail = buildPetitionEmail(urgent, NOW);
    expect(mail.body).toContain('【紧急】');
    expect(mail.body).toContain('门槛 15 人');
  });

  it('邮件如实声明是第三方代发', () => {
    const mail = buildPetitionEmail(atThreshold, NOW);
    expect(mail.body).toContain('第三方非官方平台');
    expect(mail.body).toContain('不代表学校立场');
  });
});

describe('草稿校验', () => {
  const good = {
    title: '希望二食堂增加素食窗口',
    body: '目前二食堂素食选择很少，素食同学每餐只能吃配菜。希望能增设一个素食窗口。',
    deadline: '2026-11-01T00:00:00.000Z',
  };

  it('合法草稿无问题', () => {
    expect(validatePetitionDraft(good, NOW)).toEqual([]);
  });

  it('标题太短/太长', () => {
    expect(validatePetitionDraft({ ...good, title: '加点菜' }, NOW)).toContain('title-too-short');
    expect(validatePetitionDraft({ ...good, title: '好'.repeat(61) }, NOW)).toContain('title-too-long');
  });

  it('说明太短/太长', () => {
    expect(validatePetitionDraft({ ...good, body: '太短了' }, NOW)).toContain('body-too-short');
    expect(validatePetitionDraft({ ...good, body: '好'.repeat(2001) }, NOW)).toContain('body-too-long');
  });

  it('截止时间不能在过去，也不能太远', () => {
    expect(
      validatePetitionDraft({ ...good, deadline: '2026-10-01T00:00:00.000Z' }, NOW),
    ).toContain('deadline-in-past');
    // 超过 180 天
    expect(
      validatePetitionDraft({ ...good, deadline: '2027-06-01T00:00:00.000Z' }, NOW),
    ).toContain('deadline-too-far');
  });

  it('截止时间不是合法日期时也给 deadline-in-past', () => {
    expect(validatePetitionDraft({ ...good, deadline: '不是日期' }, NOW)).toContain(
      'deadline-in-past',
    );
  });

  it('每个问题码都有中文提示（不能返回空串）', () => {
    const codes = [
      'title-too-short',
      'title-too-long',
      'body-too-short',
      'body-too-long',
      'deadline-in-past',
      'deadline-too-far',
    ] as const;
    for (const code of codes) {
      expect(describePetitionProblem(code).length).toBeGreaterThan(5);
    }
    // 提示互不相同
    const texts = codes.map((c) => describePetitionProblem(c));
    expect(new Set(texts).size).toBe(codes.length);
  });
});

describe('类别与部门绑定', () => {
  it('每个类别都有默认部门', () => {
    for (const category of PETITION_CATEGORIES) {
      const dept = PETITION_DEPARTMENTS[category];
      expect(dept.name.length).toBeGreaterThan(1);
      expect(dept.email).toContain('@');
    }
  });

  it('部门邮箱都是上科大域名（防止写到外站）', () => {
    for (const category of PETITION_CATEGORIES) {
      expect(PETITION_DEPARTMENTS[category].email.endsWith('@shanghaitech.edu.cn')).toBe(true);
    }
  });

  it('⚠️ 六个类别全部已核实（2026-10-22 官网实测）', () => {
    // 演进过程值得记下来，因为它两次推翻了直觉：
    //   第 1 版：6 个邮箱**全是我猜的**（logistics@ / academics@ / it@ / …）
    //   第 2 版：抓官网后发现 4 个猜错；「后勤」没找到 → canteen 标 false
    //   第 3 版：**「后勤无邮箱」本身是漏查** —— 学校没有「后勤服务中心」，
    //           管餐饮/物业的是【公共服务处 OGS】`ogs@shanghaitech.edu.cn`。
    // 所以现在全部为 true。若将来某个变成 false，必须是真的查不到，
    // 而不是「懒得查」。
    for (const category of PETITION_CATEGORIES) {
      expect(PETITION_DEPARTMENTS[category].emailConfirmed, `${category} 应已核实`).toBe(true);
    }
  });

  it('⚠️ 没有专属邮箱的类别必须写清楚（不许让用户以为投给了具体窗口）', () => {
    // 食堂/物业/宿舍**都没有专属邮箱**，用的是部门总邮箱。
    // 不说清楚的话用户会以为投给了具体窗口，等不到回复也不知道为什么。
    expect(PETITION_DEPARTMENTS.canteen.note).not.toBeNull();
    expect(PETITION_DEPARTMENTS.facility.note).not.toBeNull();
    expect(PETITION_DEPARTMENTS.dorm.note).not.toBeNull();
    // 提示要真的说明「这是总邮箱 / 该走别的渠道」
    expect(PETITION_DEPARTMENTS.canteen.note).toContain('总邮箱');
    expect(PETITION_DEPARTMENTS.facility.note).toContain('报修');

    // 有专属渠道的不该乱加提示
    expect(PETITION_DEPARTMENTS.teaching.note).toBeNull();
    expect(PETITION_DEPARTMENTS.it.note).toBeNull();
  });

  it('⚠️ 公共服务处（OGS）才是管食堂/物业的，不是「设备与资产处」', () => {
    // 这条断言防的是我自己犯过的错：把 canteen 指到 facility@（设备与资产处）。
    // OGS 职责含「餐饮住宿、楼宇物业、能源中心、体育设施」；
    // facility@ 管的是设备/资产**采购**，不管食堂也不管报修。
    expect(PETITION_DEPARTMENTS.canteen.email).toBe('ogs@shanghaitech.edu.cn');
    expect(PETITION_DEPARTMENTS.facility.email).toBe('ogs@shanghaitech.edu.cn');
    expect(PETITION_DEPARTMENTS.canteen.email).not.toBe('facility@shanghaitech.edu.cn');
  });

  it('⚠️ IT 的电话不是图书馆的（20685191 是 library@ 的）', () => {
    expect(PETITION_DEPARTMENTS.it.phone).toContain('20685566');
    expect(PETITION_DEPARTMENTS.it.phone).not.toContain('20685191');
  });

  it('⚠️ 通用诉求投行政综合办公室，不投党务', () => {
    // ucoffice@ 是「综合办公室（党务）」，通用诉求不该投那里。
    expect(PETITION_DEPARTMENTS.other.email).toBe('office@shanghaitech.edu.cn');
    expect(PETITION_DEPARTMENTS.other.email).not.toBe('ucoffice@shanghaitech.edu.cn');
  });

  it('每个部门都有名称、电话与出处（发信前要能核对）', () => {
    for (const category of PETITION_CATEGORIES) {
      const dept = PETITION_DEPARTMENTS[category];
      expect(dept.name.length).toBeGreaterThan(1);
      expect(dept.phone).toMatch(/[0-9]/);
      expect(dept.source.length).toBeGreaterThan(5);
    }
  });

  it('⚠️ 教务处的邮箱是 student@（反直觉但实测如此）', () => {
    // 这条断言存在的原因：`student@` 看起来像「学生事务」，直觉会猜错。
    // 官网「联系我们」明确把 `student@` 列在**教务处**名下（86-21-20685313）。
    // 如果有人「顺手改回」 academics@ 或 studentaffairs@，这条会红。
    expect(PETITION_DEPARTMENTS.teaching.email).toBe('student@shanghaitech.edu.cn');
    expect(PETITION_DEPARTMENTS.dorm.email).toBe('studentaffairs@shanghaitech.edu.cn');
  });
});
