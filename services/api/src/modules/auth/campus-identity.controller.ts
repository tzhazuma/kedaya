import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { modulePath } from '@kedaya/contracts';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { CampusIdentityService } from './campus-identity.service';

/**
 * 「身份」模块的读侧端点（挂在 `/auth` 下，与登录/绑定同域）。
 *
 * 为什么要单独一个控制器而不是塞进 `AuthController`：
 *   `AuthController` 承担的是**登录/令牌**这条最关键、最不能失败的路径，
 *   而本控制器的两个端点都会去打校园上游（会超时、会 401）。
 *   拆开之后，「登录」的依赖图里不再出现任何上游数据适配器。
 *
 * 与 `AuthController` 共享 `@Controller(modulePath('auth'))` 是允许的 ——
 * Nest 按「基路径 + 方法路径」注册，只要具体路由不重叠即可。
 */
@ApiTags('auth · 身份（校园实名 · 第二级读侧）')
@Controller(modulePath('auth'))
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class CampusIdentityController {
  constructor(private readonly identityService: CampusIdentityService) {}

  @Get('campus/overview')
  @ApiOperation({
    summary: '绑定总览：四个校园系统各自的可用状态（供「身份」页一次拉齐）',
    description:
      '一次请求返回全部平台，避免客户端拼 4 个请求时出现"一半成功一半失败"的中间态。' +
      '绝不返回任何 session 内容。',
  })
  overview(@CurrentUser() userId: string) {
    return this.identityService.overview(userId);
  }

  @Get('campus-identity')
  @ApiOperation({
    summary: '校园实名身份（默认脱敏；reveal=1 取明文并写审计）',
    description:
      '默认返回打码后的姓名/学号/邮箱（脱敏在服务端做，明文不出服务端）。' +
      '`reveal=1` 时返回明文并落审计日志（契约 §9）。' +
      '未绑定 EGATE → CAMPUS_BINDING_REQUIRED。',
  })
  identity(@CurrentUser() userId: string, @Query('reveal') reveal?: string) {
    return this.identityService.view(userId, reveal === '1' || reveal === 'true');
  }
}
