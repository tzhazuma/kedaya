/** 账号注销的仓储端口（data 层实现） */
export const ACCOUNT_DELETION_REPOSITORY = Symbol('KEDAYA_ACCOUNT_DELETION_REPOSITORY');

export type AccountDeletionOutcome =
  | { readonly deletedAt: string }
  | 'already-deleted';

export interface AccountDeletionRepository {
  /**
   * 在一个事务里：撤销会话/凭据/第三方身份/校园绑定，匿名化 `User` 行。
   *
   * 返回 `'already-deleted'` 表示竞态中被别人先删了（调用方应返回 409）。
   * **任何一步失败必须抛错让事务回滚**，不允许部分成功。
   */
  deleteAccount(userId: string): Promise<AccountDeletionOutcome>;

  /**
   * 这个用户是否**已经注销**。
   *
   * 为什么需要它：注销时凭据被整表删除，所以第二次请求进来时
   * `findByUserId` 返回 null —— 若不先查这个，会落到"密码不正确"（401），
   * 而用户实际需要看到的是 409「该账号已注销」。
   */
  isDeleted(userId: string): Promise<boolean>;
}
