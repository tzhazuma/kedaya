import { describe, expect, it } from 'vitest';
import {
  containsLikelyPii,
  emailDomain,
  isChinaMobile,
  isLengthWithin,
  isShanghaiTechEmail,
  isStudentId,
  slugify,
} from './validate';

describe('isShanghaiTechEmail', () => {
  it('接受上科大域名', () => {
    expect(isShanghaiTechEmail('zhangsan@shanghaitech.edu.cn')).toBe(true);
    expect(isShanghaiTechEmail('zhangsan@stu.shanghaitech.edu.cn')).toBe(true);
    expect(isShanghaiTechEmail('ZHANGSAN@SHANGHAITECH.EDU.CN')).toBe(true);
  });

  it('拒绝其它域名与畸形输入', () => {
    expect(isShanghaiTechEmail('a@gmail.com')).toBe(false);
    expect(isShanghaiTechEmail('a@fake-shanghaitech.edu.cn')).toBe(false);
    expect(isShanghaiTechEmail('a@shanghaitech.edu.cn.evil.com')).toBe(false);
    expect(isShanghaiTechEmail('no-at-sign')).toBe(false);
    expect(isShanghaiTechEmail('@shanghaitech.edu.cn')).toBe(false);
    expect(isShanghaiTechEmail('a@')).toBe(false);
  });
});

describe('emailDomain', () => {
  it('取域名', () => {
    expect(emailDomain('a@Stu.ShanghaiTech.edu.cn')).toBe('stu.shanghaitech.edu.cn');
    expect(emailDomain('bad')).toBeNull();
  });
});

describe('isStudentId / isChinaMobile', () => {
  it('学号 8 位数字', () => {
    expect(isStudentId('20261234')).toBe(true);
    expect(isStudentId(' 20261234 ')).toBe(true);
    expect(isStudentId('2026123')).toBe(false);
    expect(isStudentId('202612345')).toBe(false);
    expect(isStudentId('2026123a')).toBe(false);
  });

  it('手机号', () => {
    expect(isChinaMobile('13800138000')).toBe(true);
    expect(isChinaMobile('12800138000')).toBe(false);
    expect(isChinaMobile('1380013800')).toBe(false);
  });
});

describe('containsLikelyPii', () => {
  it('识别手机号/邮箱/学号', () => {
    expect(containsLikelyPii('联系我 13800138000')).toBe(true);
    expect(containsLikelyPii('邮箱 a@b.com')).toBe(true);
    expect(containsLikelyPii('学号 20261234')).toBe(true);
    expect(containsLikelyPii('今天天气不错')).toBe(false);
  });
});

describe('isLengthWithin / slugify', () => {
  it('按码点计数（中文按 1 个字符）', () => {
    expect(isLengthWithin('可达鸭', 1, 5)).toBe(true);
    expect(isLengthWithin('可达鸭', 4, 5)).toBe(false);
  });

  it('slugify 剔除中文', () => {
    expect(slugify('Hello World')).toBe('hello-world');
    expect(slugify('  a  b  ')).toBe('a-b');
    expect(slugify('可达鸭')).toBe('');
  });
});
