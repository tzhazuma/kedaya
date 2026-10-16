import { describe, expect, it } from 'vitest';
import { CONTACT_PATTERNS, scanContactInfo } from './content-safety';

/**
 * 验收 T25（规格 §6.4 / §8.3）：
 * `description` 含手机号 → 422 `VALIDATION_FAILED` / `CONTACT_INFO_IN_DESCRIPTION`
 * —— e2e 覆盖手机号 / 微信 / QQ 三类模式。
 *
 * 这里测的是纯函数（判定逻辑）；HTTP 层的 422 + `details.reason` 在
 * `test/buddy-http.spec.ts` 里端到端验证。
 *
 * ## 一个必须记录的偏离
 *
 * 规格 §6.4 给的正则是 `[Vv]信?\s*[:：]?\s*\w+`，它在普通英文上会**严重误报**
 * （`"Have a nice day"` 里的 `v` + `e` 就命中）。本实现收紧为"必须出现显式平台词"。
 * 下面有一组用例专门钉死"普通英文不误报"。
 */
describe('scanContactInfo（规格 §6.4，验收 T25）', () => {
  it('手机号（中国大陆 11 位）被识别为 MOBILE', () => {
    for (const text of [
      '联系我 13812345678',
      '电话：13812345678',
      '加我 15900001111 一起打',
    ]) {
      const result = scanContactInfo(text);
      expect(result.hit, text).toBe(true);
      expect(result.kind, text).toBe('MOBILE');
    }
  });

  it('微信号（显式平台词 + 账号）被识别为 WECHAT', () => {
    for (const text of [
      '微信：duck_2026',
      '加微信 abc12345',
      'wechat: myid1234',
      'vx：hello_world',
      'v信 wxid_abc123',
    ]) {
      const result = scanContactInfo(text);
      expect(result.hit, text).toBe(true);
      expect(result.kind, text).toBe('WECHAT');
    }
  });

  it('QQ 号被识别为 QQ', () => {
    for (const text of ['QQ：123456789', 'qq 87654321', 'QQ号:1234567']) {
      const result = scanContactInfo(text);
      expect(result.hit, text).toBe(true);
      expect(result.kind, text).toBe('QQ');
    }
  });

  it('⚠️ 普通英文**不误报**（规格原文的正则会在这里挂掉）', () => {
    for (const text of [
      'Have a nice day, very welcome to join us',
      'We will meet at the very big gym',
      'badminton lovers only',
      'everyone is welcome',
    ]) {
      expect(scanContactInfo(text).hit, text).toBe(false);
    }
  });

  it('普通描述不误报（组队场景的真实文本）', () => {
    for (const text of [
      '体育馆 3 号场，打两小时，新手也行',
      '在图书馆三楼自习，缺一个搭子',
      '一起去迪士尼，周末两天',
      '我们 4 个人，2 男 2 女',
      '打 2 小时，10:00 开始',
    ]) {
      expect(scanContactInfo(text).hit, text).toBe(false);
    }
  });

  it('⚠️ 已知取舍：**紧贴其他数字**的 11 位串不判为手机号（宁可漏报也不误报）', () => {
    // 正则用了 (?<!\d)…(?!\d) 前后视。理由：订单号 / 学号 / 快递单号里
    // 出现 1[3-9] 开头的 11 位数字是常见的，把它们判成"写了手机号"会
    // 直接堵死正常用户，且错误信息与事实不符。
    // 代价：把手机号粘在长数字串里可以绕过 —— 这条残余风险记入交付说明，
    // 由 M2 的内容安全共享能力（正则 + 模型）兜底，而不是在本模块堆正则。
    expect(scanContactInfo('订单 2026101700013812345678').hit).toBe(false);
    // 而独立写出的手机号一定被拦下
    expect(scanContactInfo('订单 2026101700013812345678 电话 13812345678').hit).toBe(true);
  });

  it('手机号长度不对（10 位 / 12 位）不误判为手机号', () => {
    expect(scanContactInfo('1234567890').hit).toBe(false);
    expect(scanContactInfo('138123456789').hit).toBe(false);
  });

  it('空 / null / undefined 安全返回未命中', () => {
    expect(scanContactInfo('')).toEqual({ hit: false });
    expect(scanContactInfo(null)).toEqual({ hit: false });
    expect(scanContactInfo(undefined)).toEqual({ hit: false });
  });

  it('返回结果**不含命中的原文**（回显等于把它又记录进响应与日志）', () => {
    const result = scanContactInfo('微信：secret_id_9999');
    expect(JSON.stringify(result)).not.toContain('secret_id_9999');
    expect(Object.keys(result).sort()).toEqual(['hint', 'hit', 'kind']);
  });

  it('模式表顺序即优先级：同时出现手机号与微信时报手机号（最确定的先报）', () => {
    const result = scanContactInfo('微信 abc12345 手机 13812345678');
    expect(result.kind).toBe('MOBILE');
  });

  it('每个模式都带中文提示（用于错误文案）', () => {
    for (const pattern of CONTACT_PATTERNS) {
      expect(pattern.hint.length).toBeGreaterThan(0);
      expect(pattern.pattern).toBeInstanceOf(RegExp);
    }
  });
});
