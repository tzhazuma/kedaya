import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../common/compliance/audit.service';
import { CampusBindingRequiredError } from '../../common/errors/app-error';
import {
  CAMPUS_SESSION_PORT,
  type CampusPlatform,
  type CampusSessionPort,
} from './domain/auth.domain';
import {
  CAMPUS_DATA_PORT,
  isDemoCampusSessionRef,
  maskCampusIdentity,
  type CampusDataPort,
  type CampusIdentityDatum,
} from './domain/campus-data.domain';
import { CAMPUS_PLATFORMS } from './domain/auth.domain';

/**
 * 「身份」模块的用例层 —— 校园实名身份的**唯一出口**。
 *
 * 为什么单独一个服务而不是塞进 `AuthService`：
 *   1. 职责不同。`AuthService` 管的是**第一级**（登录、签发 KedaYa JWT）；
 *      本服务管的是**第二级**的读侧（实名信息），两者混在一起会让
 *      "登录"这条最关键的路径依赖上"上游取数"这种容易失败的 IO。
 *   2. 可用性。实名取数会失败（上游挂了 / session 过期），而登录不该被它拖累。
 *
 * 三条隐私硬约束（契约 §9）：
 *   · 默认**脱敏**返回（姓名/学号/邮箱打码），明文必须显式 `reveal`；
 *   · 每次 `reveal` 都写审计日志（谁、何时、看了什么）；
 *   · 模拟数据必须如实标注 `simulated: true`，客户端不得冒充真实身份展示。
 */
@Injectable()
export class CampusIdentityService {
  private readonly logger = new Logger(CampusIdentityService.name);

  constructor(
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(CAMPUS_DATA_PORT) private readonly campusData: CampusDataPort,
    @Inject(ConfigService) private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  /** 当前数据来源（供 UI 如实标注） */
  get dataMode(): 'mock' | 'live' {
    return this.campusData.mode;
  }

  /**
   * 四个校园系统的绑定总览 —— 「身份」页一次请求就够了。
   *
   * 为什么不复用 `/auth/campus-bindings`：那个端点只回已绑定的记录，
   * 而页面需要的是「**全部四个**平台，哪些可用、哪些该去绑定」，
   * 客户端拼 4 次请求既慢又容易出现"一半成功一半失败"的中间态。
   */
  async overview(userId: string): Promise<CampusPlatformOverview> {
    const bindings = await this.campusSession.listBindings(userId);
    const now = Date.now();

    const platforms = await Promise.all(
      CAMPUS_PLATFORMS.map(async (platform) => {
        const binding = bindings.find((item) => item.platform === platform);
        const expired = binding !== undefined && binding.expiresAt.getTime() <= now;
        const active = binding !== undefined && binding.status === 'active' && !expired;
        // `acquireSession` 是唯一权威判定（它就是能力模块实际会走的那条路径）
        const session = active ? await this.campusSession.acquireSession(userId, platform) : null;

        return {
          platform,
          /** 现在就能用（已绑定且未过期） */
          available: session !== null,
          boundAt: binding?.createdAt ?? null,
          expiresAt: binding?.expiresAt ?? null,
          /** 绑定但已过期 —— UI 要提示"授权已过期，请重新绑定"而不是"未绑定" */
          expired: binding !== undefined && expired,
          /** 疑似模拟凭据（仅开发环境可能出现） */
          simulated: session !== null && isDemoCampusSessionRef(session.sessionRef),
        };
      }),
    );

    return { dataMode: this.dataMode, platforms };
  }

  /**
   * 实名身份视图。
   *
   * @param reveal true = 返回明文（会写审计）；false = 脱敏（默认）
   *
   * 未绑定 EGATE → `CAMPUS_BINDING_REQUIRED`（契约 §5 硬规则 3），
   * 而不是返回一个空对象让前端显示"姓名：--"。
   */
  async view(userId: string, reveal: boolean): Promise<CampusIdentityView> {
    const session = await this.campusSession.acquireSession(userId, 'EGATE');
    if (!session) {
      throw new CampusBindingRequiredError(
        '请先完成统一身份认证（EGATE）绑定，才能查看实名信息',
        { platform: 'EGATE' },
      );
    }

    let datum: CampusIdentityDatum;
    try {
      datum = await this.campusData.fetchIdentity(session);
    } catch (error) {
      // 上游失败：把原因留给调用方（客户端会退到上次成功的缓存并标注"数据可能不是最新"）
      this.logger.warn(
        `校园实名信息读取失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }

    if (reveal) {
      await this.audit.record({
        actorId: userId,
        action: 'auth.campus-identity.reveal',
        resource: 'CampusIdentity',
        module: 'auth',
        metadata: { platform: 'EGATE', dataMode: this.dataMode },
      });
    }

    return {
      platform: 'EGATE',
      masked: !reveal,
      identity: reveal ? datum : maskCampusIdentity(datum),
      simulated: this.dataMode === 'mock',
      dataMode: this.dataMode,
      fetchedAt: new Date().toISOString(),
      audited: reveal,
    };
  }

  /** 真实模式下要求必须由客户端提供正式 session；模拟模式下由服务端签发演示凭据 */
  isDemoBindingAllowed(): boolean {
    const mode = this.config.get<string>('CAMPUS_DATA_MODE') ?? 'mock';
    const production = (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
    return mode === 'mock' && !production;
  }
}

export interface CampusPlatformStatus {
  platform: CampusPlatform;
  available: boolean;
  boundAt: Date | null;
  expiresAt: Date | null;
  expired: boolean;
  simulated: boolean;
}

export interface CampusPlatformOverview {
  dataMode: 'mock' | 'live';
  platforms: CampusPlatformStatus[];
}

export interface CampusIdentityView {
  platform: CampusPlatform;
  masked: boolean;
  identity: CampusIdentityDatum;
  simulated: boolean;
  dataMode: 'mock' | 'live';
  fetchedAt: string;
  audited: boolean;
}
