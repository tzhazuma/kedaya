import type { UserRepository } from './auth.domain';
import type { LocalAccountRepository } from './local-account.domain';
import { WECHAT_IDENTITY_PROVIDER } from './wechat.domain';

/**
 * 账号登录方式的**统一视图**。
 *
 * 为什么需要它：登录/注册/微信登录三条路径的响应必须同构，
 * 否则客户端要按"我是从哪个接口登录的"分叉渲染（「我的」页就更简陋）。
 * 这里一次性把"这个账号还有哪些登录方式"算清楚，三条路径共用。
 */
export interface AccountSummary {
  /** 是否设置了邮箱密码 */
  hasPassword: boolean;
  /** 绑定的邮箱（没有则 null） */
  email: string | null;
  /** 是否绑定了微信 */
  wechatBound: boolean;
  /**
   * 是否还有**除微信之外**的登录方式。
   *
   * 解绑微信前必须为 true —— 否则用户会把自己锁在门外
   * （微信身份一解绑，账号就再也登不进来了）。
   */
  hasOtherLoginMethod: boolean;
}

export interface AccountSummaryDeps {
  accounts: Pick<LocalAccountRepository, 'findByUserId'>;
  users: Pick<UserRepository, 'listIdentities'>;
}

export async function describeAccount(
  deps: AccountSummaryDeps,
  userId: string,
): Promise<AccountSummary> {
  const [account, identities] = await Promise.all([
    deps.accounts.findByUserId(userId),
    deps.users.listIdentities(userId),
  ]);

  const wechatBound = identities.some((identity) => identity.provider === WECHAT_IDENTITY_PROVIDER);
  const hasPassword = account !== null;

  return {
    hasPassword,
    email: account?.email ?? null,
    wechatBound,
    hasOtherLoginMethod: hasPassword || identities.some((identity) => identity.provider !== WECHAT_IDENTITY_PROVIDER),
  };
}
