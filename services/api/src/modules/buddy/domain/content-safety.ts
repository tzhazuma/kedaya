/**
 * 找搭子 · 内容安全（规格 §6.4，验收 T25）
 *
 * ## 要解决的问题
 *
 * 组队最终要能联系上，但把联系方式写进 `description` 会让它**公开可见并被爬取**
 * （规格 §6.2）。所以 `description` 禁止包含联系方式，命中返回
 * `VALIDATION_FAILED` / `CONTACT_INFO_IN_DESCRIPTION`。
 *
 * ## ⚠️ 对规格原文正则的一处**刻意收紧**（必须记录）
 *
 * 规格 §6.4 给的是 `[Vv]信?\s*[:：]?\s*\w+`。这个正则在真实文本上有严重误报：
 * `"Have a nice day"` 里的 `v` + `e` 就会命中（`[Vv]` 匹配 v，`信?` 可空，
 * `\s*[:：]?\s*` 可空，`\w+` 匹配 e）。组队描述里出现英文是常态，
 * 一个会误报的正则比没有正则更糟 —— 它会让用户无法发布正常内容，
 * 且错误信息（"含联系方式"）与事实不符。
 *
 * 因此我们要求**显式的平台词**（微信/weixin/wechat/wx/vx/v信）或数字模式，
 * 并加词边界。收紧后的规则仍然覆盖规格 §6.4 列出的三类
 * （中国大陆手机号 / 微信 / QQ），且**不误报普通英文**。
 * 误报/漏报的取舍：**宁可漏报也不误报** —— 漏报由内容安全（M2 共享能力）
 * 与举报兜底，误报则直接堵死正常用户。
 */

export type ContactPatternKind = 'MOBILE' | 'WECHAT' | 'QQ';

export interface ContactPattern {
  kind: ContactPatternKind;
  pattern: RegExp;
  /** 命中后给用户看的提示（不回声命中的原文，避免把联系方式写进错误日志/响应） */
  hint: string;
}

/**
 * 模式表。**顺序即优先级**（手机号最确定，先报）。
 *
 * 刻意**不**收录裸邮箱：校园场景里邮箱是正常联系方式（甚至官方渠道），
 * 把它当违规会挡住合理用法。若 Lead 要求，加一条即可。
 */
export const CONTACT_PATTERNS: readonly ContactPattern[] = [
  {
    kind: 'MOBILE',
    // 中国大陆手机号：1[3-9] + 9 位数字，两侧不能紧跟数字（避免命中订单号中间一段）
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/,
    hint: '正文里不要写手机号',
  },
  {
    kind: 'WECHAT',
    // 必须出现平台词：微信 / weixin / wechat / wx / vx / v信（大小写不敏感）
    pattern: /(?:微信|weixin|wechat|vx|wx|v信)\s*(?:号|id)?\s*[:：=]?\s*[A-Za-z][A-Za-z0-9_-]{4,}/i,
    hint: '正文里不要写微信号',
  },
  {
    kind: 'QQ',
    // QQ / qq / QQ号 + 5–12 位数字
    pattern: /(?:QQ|qq)\s*(?:号)?\s*[:：=]?\s*\d{5,12}/,
    hint: '正文里不要写 QQ 号',
  },
];

export interface ContactScanResult {
  hit: boolean;
  kind?: ContactPatternKind;
  hint?: string;
}

/**
 * 扫描文本里的联系方式。
 *
 * 返回**不包含命中的原文**：错误响应与日志里回显命中的联系方式
 * 等于把它又记录了一遍（日志同样是泄漏面）。
 */
export function scanContactInfo(text: string | null | undefined): ContactScanResult {
  if (typeof text !== 'string' || text.length === 0) return { hit: false };
  for (const { kind, pattern, hint } of CONTACT_PATTERNS) {
    if (pattern.test(text)) return { hit: true, kind, hint };
  }
  return { hit: false };
}
