/**
 * 找搭子演示会话（占位）。
 *
 * 契约 §5 的身份层（CAS / Egate OAuth + KedaYa 自有 JWT）**尚未接入**；
 * 与 `application/forum/session.ts` 的 `DEMO_FORUM_SESSION` 是同一类占位，
 * 已在 `apps/web/README.md`「未实现」中列出。
 *
 * 唯一必须遵守的语义：
 * - `userId` 是**实名** id；
 * - `gender` **只用于准入判定**（`genderPreference` 的 F5 硬过滤），
 *   **不参与打分、不进向量**（规格 §1.2 N5）。性别本身也不在任何响应里出现。
 * - `skillLevel` 同样只用于 F6 硬过滤与 sport 板块的规则分。
 */
import type { BuddyGender, BuddySkillLevel } from '@/domain/models/buddy';

export interface BuddySession {
  authenticated: boolean;
  userId: string;
  nickname: string;
  gender: BuddyGender;
  skillLevel: BuddySkillLevel | null;
  department: string | null;
}

export const DEMO_BUDDY_SESSION: BuddySession = {
  authenticated: true,
  userId: 'u_1024',
  nickname: '鸭鸭先冲',
  gender: 'female',
  skillLevel: 'casual',
  department: '信息科学与技术学院',
};

/** 未登录会话（列表与详情仍可读，写操作会拿到 UNAUTHENTICATED） */
export const ANONYMOUS_BUDDY_SESSION: BuddySession = {
  authenticated: false,
  userId: 'u_guest',
  nickname: '访客',
  gender: 'unspecified',
  skillLevel: null,
  department: null,
};
