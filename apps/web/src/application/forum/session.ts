/**
 * 演示会话（占位）。
 *
 * 契约 §5 的身份层（CAS / Egate OAuth + KedaYa 自有 JWT）**尚未接入**；
 * 在真实 `AuthPort` 落地前，论坛切片用这份常量代替"当前登录用户"，
 * 与后台切片的 `DEMO_ADMIN_ACTOR` 是同一类占位，已在 README「未实现」中列出。
 *
 * 唯一必须遵守的语义：`userId` 是**实名** id，匿名化由 data 层（mock/http 后端）完成，
 * application / presentation **不得**自己拼匿名身份 id。
 */

export interface ForumSession {
  authenticated: boolean;
  userId: string;
  nickname: string;
}

export const DEMO_FORUM_SESSION: ForumSession = {
  authenticated: true,
  userId: 'u_1024',
  nickname: '鸭鸭先冲',
};

/** 未登录会话（用于演示 campus_only 版块被锁定的分支） */
export const ANONYMOUS_FORUM_SESSION: ForumSession = {
  authenticated: false,
  userId: 'u_guest',
  nickname: '访客',
};
