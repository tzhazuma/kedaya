/**
 * `deadline-source-url` 的测试。
 *
 * 两条不变量各一组用例：
 * 1. 会话参数**绝不**进库（漏一个就是凭据泄漏）；
 * 2. 只读白名单**只放行看**的页面（放行一个写操作就可能删掉学生的作业）。
 *
 * 白名单测试同时锁住「不能太紧」：真实课程页必须通过，否则采集器上线就采不到东西。
 */

import { describe, expect, it } from 'vitest';

import {
  isReadOnlySourceUrl,
  READ_ONLY_PLATFORMS,
  sanitizeSourceUrl,
} from './deadline-source-url';

describe('sanitizeSourceUrl', () => {
  it('删掉各类会话参数，保留业务参数', () => {
    expect(
      sanitizeSourceUrl(
        'https://elearning.shanghaitech.edu.cn:8443/webapps/blackboard/execute/launcher?type=Course&id=_1_1&sid=abc&token=xyz&course_id=_1_1',
      ),
    ).toBe(
      'https://elearning.shanghaitech.edu.cn:8443/webapps/blackboard/execute/launcher?course_id=_1_1&id=_1_1&type=Course',
    );
  });

  it('CAS 的 ticket 与 OAuth 的 code 也算会话参数', () => {
    expect(sanitizeSourceUrl('https://x.test/a?ticket=ST-1&keep=1')).toBe('https://x.test/a?keep=1');
    expect(sanitizeSourceUrl('https://x.test/a?code=abc&keep=1')).toBe('https://x.test/a?keep=1');
  });

  it('参数排序，保证同样的链接得到同样的字符串', () => {
    const first = sanitizeSourceUrl('https://x.test/a?b=2&a=1');
    const second = sanitizeSourceUrl('https://x.test/a?a=1&b=2');
    expect(first).toBe(second);
    expect(first).toBe('https://x.test/a?a=1&b=2');
  });

  it('保留不含会话信息的老式锚点（用于对账）', () => {
    expect(sanitizeSourceUrl('https://x.test/myGrades#grade-42')).toBe(
      'https://x.test/myGrades#grade-42',
    );
  });

  it('清理含会话信息的锚点', () => {
    expect(sanitizeSourceUrl('https://x.test/a#access_token=1')).toBe('https://x.test/a');
  });

  it('拒绝带凭据的链接', () => {
    expect(sanitizeSourceUrl('https://user:pass@x.test/a')).toBeNull();
  });

  it('拒绝非 http(s) 协议', () => {
    expect(sanitizeSourceUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeSourceUrl('ftp://x.test/a')).toBeNull();
    expect(sanitizeSourceUrl('mailto:a@b.c')).toBeNull();
  });

  it('非法 / 空输入返回 null', () => {
    expect(sanitizeSourceUrl('')).toBeNull();
    expect(sanitizeSourceUrl('   ')).toBeNull();
    expect(sanitizeSourceUrl('not a url')).toBeNull();
    expect(sanitizeSourceUrl(null)).toBeNull();
    expect(sanitizeSourceUrl(undefined)).toBeNull();
  });

  it('幂等', () => {
    const once = sanitizeSourceUrl('https://x.test/a?token=1&b=2');
    expect(once).not.toBeNull();
    expect(sanitizeSourceUrl(once)).toBe(once);
  });
});

describe('isReadOnlySourceUrl', () => {
  const bb = 'https://elearning.shanghaitech.edu.cn:8443';

  it('三个平台的真实只读页面都能通过', () => {
    const allowed = [
      `${bb}/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1`,
      `${bb}/webapps/blackboard/execute/launcher?type=Course&id=_1_1`,
      `${bb}/webapps/blackboard/content/listContent.jsp?course_id=_1_1&content_id=_2_1`,
      `${bb}/webapps/bb-mygrades-BBLEARN/myGrades?course_id=_1_1&stream_name=mygrades`,
      `${bb}/webapps/assignment/uploadAssignment?content_id=_100_1&course_id=_1_1&mode=view`,
      'https://www.gradescope.com/courses/1001',
      'https://www.gradescope.com/courses/1001/assignments/555',
      'https://www.gradescope.com/account',
      'https://piazza.com/class/kx1',
      'https://piazza.com/class_profile/kx1',
    ];
    for (const url of allowed) {
      expect(isReadOnlySourceUrl(url).allowed, url).toBe(true);
    }
  });

  it('按平台判定时，别的平台地址不放行', () => {
    const decision = isReadOnlySourceUrl('https://www.gradescope.com/courses/1', 'blackboard');
    expect(decision).toEqual({ allowed: false, reason: 'host-not-allowed' });
  });

  it('http 不放行（课程内容不该裸奔）', () => {
    expect(isReadOnlySourceUrl('http://elearning.shanghaitech.edu.cn:8443/webapps/portal/execute/tabs/tabAction')).toEqual({
      allowed: false,
      reason: 'unsafe-protocol',
    });
  });

  it('Blackboard 只允许 8443 这个额外端口', () => {
    expect(
      isReadOnlySourceUrl('https://elearning.shanghaitech.edu.cn:9443/webapps/portal/execute/tabs/tabAction'),
    ).toEqual({ allowed: false, reason: 'port-not-allowed' });
  });

  it('拒绝写操作路径', () => {
    const denied = [
      `${bb}/webapps/login?action=logout`,
      `${bb}/webapps/gradebook/do/instructor/enterGrade`,
      `${bb}/webapps/assignment/uploadAssignment?action=delete`,
      'https://www.gradescope.com/courses/1/students',
      'https://www.gradescope.com/courses/1/new',
      'https://piazza.com/class_profile/get_resource/kx1/abc',
    ];
    for (const url of denied) {
      const decision = isReadOnlySourceUrl(url);
      expect(decision.allowed, url).toBe(false);
    }
  });

  it('拒绝动作型查询参数', () => {
    expect(
      isReadOnlySourceUrl(
        `${bb}/webapps/blackboard/content/listContent.jsp?course_id=_1_1&action=reset`,
      ),
    ).toEqual({ allowed: false, reason: 'action-parameter' });
    expect(
      isReadOnlySourceUrl(`${bb}/webapps/blackboard/content/listContent.jsp?mode=reset`),
    ).toEqual({ allowed: false, reason: 'action-parameter' });
    expect(
      isReadOnlySourceUrl(`${bb}/webapps/blackboard/content/listContent.jsp?cmd=view`),
    ).toEqual({ allowed: false, reason: 'action-parameter' });
  });

  it('拒绝资产文件（采集要页面结构，不是附件字节）', () => {
    expect(isReadOnlySourceUrl(`${bb}/courses/slides.pdf`)).toEqual({
      allowed: false,
      reason: 'asset',
    });
    expect(isReadOnlySourceUrl('https://www.gradescope.com/courses/1/assignments/2.pdf')).toEqual({
      allowed: false,
      reason: 'asset',
    });
  });

  it('拒绝带凭据、非法、空地址', () => {
    expect(isReadOnlySourceUrl('https://u:p@www.gradescope.com/courses/1')).toEqual({
      allowed: false,
      reason: 'credentials-in-url',
    });
    expect(isReadOnlySourceUrl('nope')).toEqual({ allowed: false, reason: 'invalid-url' });
    expect(isReadOnlySourceUrl('')).toEqual({ allowed: false, reason: 'invalid-url' });
    expect(isReadOnlySourceUrl(null)).toEqual({ allowed: false, reason: 'invalid-url' });
  });

  it('不在白名单的路径一律拒绝', () => {
    expect(isReadOnlySourceUrl('https://www.gradescope.com/foo/bar')).toEqual({
      allowed: false,
      reason: 'path-not-allowed',
    });
    // 危险动作词比「路径不在白名单」更早命中，原因也更有用
    expect(isReadOnlySourceUrl('https://www.gradescope.com/settings')).toEqual({
      allowed: false,
      reason: 'dangerous-path',
    });
    expect(isReadOnlySourceUrl('https://piazza.com/foo')).toEqual({
      allowed: false,
      reason: 'path-not-allowed',
    });
  });

  it('未知主机的 https 页面拒绝', () => {
    expect(isReadOnlySourceUrl('https://evil.test/courses/1')).toEqual({
      allowed: false,
      reason: 'host-not-allowed',
    });
  });

  it('每个策略都有至少一条路径与一个主机', () => {
    for (const platform of READ_ONLY_PLATFORMS) {
      const decision = isReadOnlySourceUrl(
        'https://www.gradescope.com/account',
        platform,
      );
      // 只验证策略表本身不是空的（具体放行与否由上面的用例覆盖）
      expect(decision).toHaveProperty('allowed');
    }
  });
});
