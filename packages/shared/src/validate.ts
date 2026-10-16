/**
 * 上科大身份校验。
 *
 * ⚠️ 这些规则是**前端预校验**，用于即时反馈；真正的权威校验在后端。
 * 若学校域名/学号规则变化，只改这里。
 */

/** 上科大邮箱域名白名单（学生 + 教工） */
export const SHANGHAITECH_EMAIL_DOMAINS: readonly string[] = [
  'shanghaitech.edu.cn',
  'stu.shanghaitech.edu.cn',
];

/** 是否上科大邮箱 */
export function isShanghaiTechEmail(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return SHANGHAITECH_EMAIL_DOMAINS.includes(domain);
}

/** 取邮箱域名部分，非法返回 null */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/**
 * 学号粗校验：上科大学号为 8 位数字。
 * 注意：这是**启发式**，真实规则由教务系统决定。
 */
export function isStudentId(value: string): boolean {
  return /^\d{8}$/.test(value.trim());
}

/** 手机号（中国大陆） */
export function isChinaMobile(value: string): boolean {
  return /^1[3-9]\d{9}$/.test(value.trim());
}

/** 是否疑似含敏感个人信息（用于发帖/举报内容的前端提示，非安全边界） */
export function containsLikelyPii(text: string): boolean {
  return (
    /1[3-9]\d{9}/.test(text) ||
    /\b\d{17}[\dXx]\b/.test(text) ||
    /\b\d{8}\b/.test(text) ||
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(text)
  );
}

/** 昵称/标题长度校验 */
export function isLengthWithin(value: string, min: number, max: number): boolean {
  const len = [...value.trim()].length;
  return len >= min && len <= max;
}

/** 生成 URL 友好的 slug（中文会被剔除，因此结果可能为空） */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
