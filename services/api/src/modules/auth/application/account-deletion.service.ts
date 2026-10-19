import { Inject, Injectable } from '@nestjs/common';

import { UnauthenticatedError, ValidationError, ConflictError } from '../../../common/errors/app-error';
import { LocalAccountRepository, LOCAL_ACCOUNT_REPOSITORY } from '../domain/local-account.domain';
import { verifyPassword } from '../domain/password';
import {
  ACCOUNT_DELETION_REPOSITORY,
  type AccountDeletionRepository,
  type AccountDeletionOutcome,
} from '../domain/account-deletion.domain';

/**
 * 账号注销（PIPL 自助注销要求）。
 *
 * ## 为什么是「撤销身份 + 匿名化」而不是「删掉这一行」
 *
 * `schema.prisma` 里 60+ 个模型关联到 `User`。硬删会带来两个具体问题：
 *
 * 1. **别人的页面会出现空洞** —— 他的论坛帖子还挂在别人的回复里，
 *    他的拼单还挂在已成团的历史里。删掉作者行会让这些内容变成孤儿。
 * 2. **交易记录有留存义务** —— 拼单成团、场馆预约这类记录不能因为
 *    "作者注销了"就消失（对账、纠纷处理需要）。
 *
 * 所以做法是：**立即撤销一切能让他再登进来的东西 + 抹掉个人标识 + 打时间戳**，
 * 业务内容保留但作者变成「已注销用户」。
 *
 * ## 三条硬约束
 *
 * - **不能"尽力而为"**：任何一个 delete 失败就整个事务回滚。用户会以为账号没了，
 *   其实还在 —— 那比不提供注销更糟。
 * - **并发必须只有一个赢家**：两个请求同时进来，靠
 *   `user.updateMany({ where: { id, deletedAt: null } })` 的 `count` 判定。
 * - **密码错与账号不存在必须同一条文案**：否则这个端点成了账号枚举器。
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject(ACCOUNT_DELETION_REPOSITORY)
    private readonly repository: AccountDeletionRepository,
    @Inject(LOCAL_ACCOUNT_REPOSITORY)
    private readonly accounts: LocalAccountRepository,
  ) {}

  /**
   * 注销账号。
   *
   * @throws ValidationError  `confirm` 不是 `DELETE`（防误触），**此时不删任何东西**
   * @throws UnauthenticatedError 密码错误 / 账号不存在（同一条文案）
   * @throws ConflictError 已经注销过
   */
  async deleteAccount(
    userId: string,
    input: { password: string; confirm: string },
  ): Promise<{ deletedAt: string }> {
    // 1) 防误触必须**先于**任何写操作 —— 否则 `confirm` 写错也会开始删。
    if (input.confirm !== 'DELETE') {
      throw new ValidationError(
        '这是不可逆操作：请把确认字段填成 DELETE（全大写）后再提交。本条校验不通过时不会删除任何数据。',
      );
    }

    // 2) ⚠️ **先判已注销**，再验密码。
    //
    //    顺序很重要：注销时凭据被整表删除，所以第二次请求进来
    //    `findByUserId` 返回 null。若不先查这一层，会落到下面的
    //    "密码不正确"（401），而用户真正需要看到的是 409「该账号已注销」。
    if (await this.repository.isDeleted(userId)) {
      throw new ConflictError('该账号已注销');
    }

    // 3) 密码校验。账号不存在与密码错误走同一个分支 —— 不能让这个端点
    //    回答"这个邮箱注册过没有"。
    const account = await this.accounts.findByUserId(userId);
    if (account === null || !verifyPassword(input.password, account.passwordHash)) {
      throw new UnauthenticatedError('密码不正确，账号未注销');
    }

    // 4) 事务里撤销身份 + 匿名化。并发抢锁在 repository 内完成。
    const outcome: AccountDeletionOutcome = await this.repository.deleteAccount(userId);

    if (outcome === 'already-deleted') {
      throw new ConflictError('该账号已注销');
    }

    return { deletedAt: outcome.deletedAt };
  }
}
