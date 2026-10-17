/**
 * 校园绑定守卫 —— 契约 §5 硬规则 3 / 不变式 **I4** 的通用落点
 *
 * ## 为什么需要它
 *
 * 「已登录但未绑定」是**合法状态**：身份有效，但用户还没绑定对应校园系统。
 * 此时校园能力（`schedule` 等）必须返回 **409 `CAMPUS_BINDING_REQUIRED`**，
 * **不是** 401 —— 401 会触发客户端的"登出并跳登录"逻辑，而用户其实已经登录了
 * （ADR 0004 §5.4、契约 §11.4 I4）。
 *
 * 把这件事做成**守卫**而不是每个 service 里各写一遍，有两个好处：
 *   1. 判定逻辑只有一处，不会某个端点漏掉；
 *   2. `@RequireCampusBinding('cpdaily')` 让"这个模块依赖哪个校园平台"
 *      在**代码里可见**（而不是藏在注释里）。
 *
 * ## 用法
 *
 * ```ts
 * @UseGuards(AuthGuard, CampusBindingGuard)   // 顺序不能反：AuthGuard 先解出身份
 * @RequireCampusBinding('cpdaily')
 * @Controller('schedule')
 * ```
 */

import { CanActivate, Inject, Injectable, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { currentContext } from '../../../common/context/request-context';
import { CampusBindingRequiredError, UnauthenticatedError } from '../../../common/errors/app-error';
import { CAMPUS_SESSION_PORT } from '../../auth/domain/auth.domain';
import type { CampusSessionPort } from '../domain/ports/campus-session.port';

/**
 * 绑定的"可用"状态。
 *
 * ⚠️ 这里刻意**内联**而不是复用 techpie 的 `isActiveLinkStatus`：
 * 合并同学分支后，auth 与 techpie 各有一套 `CampusPlatform` 枚举
 * （auth 是 `'CPDAILY'` 大写，techpie 是 §11.20-C 的 `'cpdaily'` 小写），
 * 两者**类型不兼容**。守卫只关心"状态是否可用"，不关心平台拼法，
 * 因此内联一行判断，把耦合点降到最小。
 * 根治办法是统一两套枚举（记录为待办）。
 */
const ACTIVE_STATUSES = new Set(['ACTIVE', 'LINKED']);


export const CAMPUS_BINDING_PLATFORM_KEY = 'kedaya:campusBindingPlatform';

/**
 * 声明本控制器/处理器依赖哪个校园平台。
 *
 * ⚠️ 未声明时默认 `cpdaily`（结构化校园数据的主通道）——
 * 默认值刻意是"最可能被用到的那一个"，而不是"不检查"：
 * **fail-closed** 比"忘了标注就放行"安全得多。
 */
/** 平台标识。用 `string` 而不是某一边的 `CampusPlatform` —— 见下方 ACTIVE_STATUSES 的说明。 */
export type GuardPlatform = string;

export const RequireCampusBinding = (platform: GuardPlatform) =>
  SetMetadata(CAMPUS_BINDING_PLATFORM_KEY, platform);

@Injectable()
export class CampusBindingGuard implements CanActivate {
  constructor(
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const platform =
      this.reflector.getAllAndOverride<GuardPlatform>(CAMPUS_BINDING_PLATFORM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'cpdaily';

    const userId = currentContext()?.userId;
    // 正常情况下 AuthGuard 已经拦掉了未登录；这里是纵深防御。
    if (!userId) throw new UnauthenticatedError();

    // 两套 `CampusPlatform` 枚举不兼容（auth 大写 / techpie 小写），此处按边界转型。
    // 根治办法是统一枚举，记录为待办。
    const binding = await this.campusSession.getBinding(userId, platform as never);
    // §11.19-A：可用状态是 ACTIVE（旧拼法 LINKED 已作废）。
    // 判定只走 `isActiveLinkStatus` 一处，避免 `=== 'LINKED'` 散落各处。
    if (!binding || !ACTIVE_STATUSES.has(String(binding.status))) {
      throw new CampusBindingRequiredError(`请先绑定校园系统（${platform}）后再使用该功能`, {
        provider: platform,
        status: binding?.status ?? 'UNBOUND',
        // 机器可读：这不是认证问题，客户端应**跳绑定引导页**而不是跳登录页
        next: 'GO_BIND',
      });
    }
    return true;
  }
}
