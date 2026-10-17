/**
 * TechPie 演示会话（占位）。
 *
 * 契约 §5 的身份层（上科大统一身份认证 + 可达鸭自有 JWT）**尚未接入**；
 * 与 `application/buddy/session.ts` / `application/forum/session.ts` 是同一类占位。
 *
 * ⚠️ 契约 §11.18-F：一级身份**不照抄 TechPie 的 Casdoor 方案**（那会把可达鸭的
 * 账号体系绑到另一个第三方服务的可用性上），实现用**过渡 IdP**（方案 B），
 * **但 Port 形状按方案 A（学校 CAS 直连）设计** —— 因此这里显式标注
 * `identitySource: 'transitional-idp'`，UI 必须如实告诉用户这是过渡身份源。
 *
 * ⚠️ 契约 §11.4 I1：本类型**不含**任何校园凭证字段
 * （`cookie` / `cookies` / `session` / `sessionToken` / `tgc` / `castgc` /
 * `ticket` / `tenant`）。"我绑定了哪些校园系统"是**二级能力层**的事实，
 * 只能从 `GET /techpie/links` 读，绝不进身份层。
 */
export interface TechpieSession {
  authenticated: boolean;
  /** 实名 id（一级身份） */
  userId: string;
  nickname: string;
  department: string | null;
  /**
   * 一级身份来源。
   * `'school-cas'` = 目标方案（学校官方，未获批，U6）；
   * `'transitional-idp'` = 过渡方案（当前）。
   */
  identitySource: 'school-cas' | 'transitional-idp';
}

export const DEMO_TECHPIE_SESSION: TechpieSession = {
  authenticated: true,
  userId: 'u_1024',
  nickname: '鸭鸭先冲',
  department: '信息科学与技术学院',
  identitySource: 'transitional-idp',
};

/** 未登录会话（绑定列表与能力清单会拿到 UNAUTHENTICATED） */
export const ANONYMOUS_TECHPIE_SESSION: TechpieSession = {
  authenticated: false,
  userId: 'u_guest',
  nickname: '访客',
  department: null,
  identitySource: 'transitional-idp',
};

/**
 * 过渡身份源的**诚实提示**（UI 必须展示，不是可选项）。
 * 规格 §4.2：「必须在文档与 UI 上标明这是过渡身份源」。
 */
export const TRANSITIONAL_IDENTITY_NOTICE =
  '当前登录使用过渡身份源（学校 CAS 直连仍在申请中）。' +
  '这不影响校园系统绑定的合规边界：无论一级身份来自哪里，' +
  '可达鸭都不会把校园会话当作身份，也不会把校园凭证放进登录态。';
