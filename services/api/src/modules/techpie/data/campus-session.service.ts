/**
 * TechPie 整合 · `CampusSessionPort` 的 Phase 0 实现
 *
 * 规格 `docs/features/techpie-integration.md` §5.3 / §9.1；
 * 裁决 `00-FROZEN-CONTRACT.md` §11.18-D / E、§11.19-A/B、§11.20-B。
 *
 * ## 这个文件为什么在 `techpie/data/` 而不是 `auth/data/`
 *
 * 契约 §5 硬规则 1 要求两级身份**在实现层**也不能耦合；
 * 不变式 **I2** 把它钉成静态扫描（`modules/auth/data/**` 不得 import
 * `campus-session.port`）。实现放在身份模块里，那条扫描就只能靠"没写 import"
 * 来通过 —— 而真正的耦合（身份模块持有校园会话）依然存在。
 * 因此本实现**物理地**搬到了能力层。搬完之后 I2 是**结构性**成立的。
 *
 * ## ⚠️ 合规硬约束（本文件最重要的事）
 *
 * **Phase 0 只有 `ecard`（OPENID 通道）一个写入者。**
 * 需要代持 CASTGC 的平台（`egate` / `cpdaily` / `jwc` / `cas` / `techpie`）在信息办
 * **书面回复**（U7）之前**没有任何写入路径** —— `bind()` 的第一行就把它们拒掉。
 *
 * 这不是"先做着等批准"，而是**根本不做**：一旦落库就有了未经授权的凭证副本，
 * 事后清理无法消除已发生的风险（裁决 §11.18-D 的原话）。
 * 由 `data/campus-session.service.spec.ts` 的测试逐平台钉死。
 *
 * 明文密码（U12）同样：`bind()` 在**碰它之前**就拒绝，
 * 且**绝不**写进数据库、日志、审计正文或错误信息（规格 §10.3）。
 *
 * ## ⚠️ 状态枚举已按 §11.19-A 收敛
 *
 * 落库的 `TechpieLink.status` 现在是 **`ACTIVE`**（旧拼法 `LINKED` 已作废）。
 * 判定"可用"统一走 `isActiveLinkStatus()` —— 全仓只有那一处 `=== 'ACTIVE'`。
 */

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CampusSession as CampusSessionRow } from '@prisma/client';
import { decryptSecret, encryptSecret, fingerprintSecret } from '../../../common/crypto/secret-box';
import { InternalError } from '../../../common/errors/app-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { toCampusBindingState } from '../domain/techpie.domain';
import {
  CAMPUS_PLATFORM_PHASE,
  CampusSessionError,
  PHASE0_BINDABLE_PLATFORMS,
  isActiveLinkStatus,
  isPhase0Bindable,
  type BindCredential,
  type CampusBindingState,
  type CampusPlatform,
  type CampusSessionPort,
} from '../domain/ports/campus-session.port';
import { toLinkModel } from './techpie.repository';

/** 校园卡 OPENID 绑定的默认有效期（30 天）。OPENID 通道没有会话过期概念，这里只做卫生。 */
const ECARD_OPENID_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 密文里存的东西：**只有** OPENID 通道的绑定标识，没有任何 CASTGC。
 *
 * ⚠️ **如实声明 Phase 0 的缺口**：真实通道下这里应该存
 * `code2session` 换来的 `openid`，而 `authCode` 必须**立即用掉并丢弃**
 * （§11.19-B 第 2 条）。Phase 0 没有 AppSecret、也没有可用的 `code2session`
 * 上游，因此这里存的是**一次性 authCode 本身**，仅作为"这条绑定对应哪个用户"
 * 的**占位标识**。真实通道打通后必须改掉，且**不得**把 authCode 写进日志（§10.3）。
 */
interface EcardOpenIdSecret {
  channel: 'wechat';
  /** Phase 0 是占位（见上）；真实通道下应是 code2session 的 openid */
  authCode: string;
  /** 仅当上游确实给了一个可注入的 cookie header 时才有值（Phase 0 恒为 null） */
  cookieHeader: string | null;
}

@Injectable()
export class CampusSessionService implements CampusSessionPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /* ---------------- 读 ---------------- */

  async listBindings(userId: string): Promise<CampusBindingState[]> {
    const rows = await this.prisma.techpieLink.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toState);
  }

  async getBinding(userId: string, platform: CampusPlatform): Promise<CampusBindingState | null> {
    const row = await this.prisma.techpieLink.findUnique({
      where: { userId_provider: { userId, provider: platform } },
    });
    // 用真值判断而不是 `!== null`：离线测试夹具（内存版 Prisma）不会为可空列补
    // `null`，而语义上「未软删」就是「该字段没有值」。生产 Prisma 返回 null，同样成立。
    if (!row || row.deletedAt) return null;
    return toState(row);
  }

  /* ---------------- 写 ---------------- */

  /**
   * 发起绑定。
   *
   * 前两道闸门**先于任何凭证处理**：
   *   1. 平台必须是 Phase 0 可绑定的（当前只有 `ecard`）；
   *   2. 凭证不能是明文密码。
   * 两者都不通过时，`credential` 连**读**都没被读过 —— 更不会进日志。
   */
  async bind(
    userId: string,
    platform: CampusPlatform,
    credential: BindCredential,
  ): Promise<CampusBindingState> {
    if (!isPhase0Bindable(platform)) {
      throw new CampusSessionError(
        'PHASE_BLOCKED',
        `「${platform}」的绑定需要代持校园会话，本轮不实现（阻塞于信息办书面回复，规格 U7）`,
        {
          platform,
          phase: CAMPUS_PLATFORM_PHASE[platform],
          phase0BindablePlatforms: [...PHASE0_BINDABLE_PLATFORMS],
          // 未决问题编号：U7（学校是否允许第三方代持 CASTGC）+ U12（明文密码）
          blockedBy: ['U7', 'U12'],
        },
      );
    }

    if (credential.kind === 'password') {
      // ⚠️ 这里**不读取** studentId / password 的任何字段，也不把它们放进 message/details。
      throw new CampusSessionError(
        'PLAIN_PASSWORD_REFUSED',
        '可达鸭不接受明文密码。若学校提供 OAuth / 扫码 / 短信，必须优先使用；在信息办回复前该通道不实现',
        { platform, blockedBy: ['U12'] },
      );
    }

    if (credential.channel !== 'wechat' || credential.authCode.trim().length === 0) {
      throw new CampusSessionError(
        'INVALID_CREDENTIAL',
        'authCode 不合法（channel 必须是 wechat，authCode 不能为空）',
        { platform },
      );
    }

    const existing = await this.prisma.techpieLink.findUnique({
      where: { userId_provider: { userId, provider: platform } },
    });
    if (existing && !existing.deletedAt && isActiveLinkStatus(existing.status)) {
      throw new CampusSessionError('ALREADY_LINKED', '该校园平台已经绑定，请先解绑再重新绑定', { platform });
    }

    const authCode = credential.authCode.trim();
    const expiresAt = new Date(Date.now() + ECARD_OPENID_TTL_MS);
    const secret: EcardOpenIdSecret = { channel: 'wechat', authCode, cookieHeader: null };
    const sessionCipher = encryptSecret(JSON.stringify(secret), this.encryptionKey());

    // 两步写在一个事务里：**绝不允许**出现"link 说已绑定、凭证表却没有行"
    // 或反过来的悬挂态（失败模式 F11）。
    const [link] = await this.prisma.$transaction([
      this.prisma.techpieLink.upsert({
        where: { userId_provider: { userId, provider: platform } },
        create: {
          userId,
          provider: platform,
          // §11.19-A：可用状态是 ACTIVE（旧拼法 LINKED 已作废）
          status: 'ACTIVE',
          externalUserId: authCode,
          expiresAt,
          lastSyncAt: new Date(),
        },
        update: {
          status: 'ACTIVE',
          externalUserId: authCode,
          expiresAt,
          lastSyncAt: new Date(),
          deletedAt: null,
        },
      }),
      this.prisma.campusSession.upsert({
        where: { userId_platform: { userId, platform } },
        create: {
          userId,
          platform,
          status: 'ACTIVE',
          sessionCipher,
          cipherKeyId: this.cipherKeyId(),
          externalUserId: authCode,
          expiresAt,
        },
        update: {
          status: 'ACTIVE',
          sessionCipher,
          cipherKeyId: this.cipherKeyId(),
          externalUserId: authCode,
          expiresAt,
          renewFailCount: 0,
        },
      }),
    ]);

    return toState(link);
  }

  /**
   * 解绑。
   *
   * **硬删** `CampusSession` 整行（规格 §5.3 约束 4 / `05-security-privacy.md:458`）——
   * 只把 link 标记成失效是**说谎**：凭证副本还在库里。
   */
  async unbind(userId: string, platform: CampusPlatform): Promise<void> {
    await this.prisma.$transaction([
      // 凭证副本：硬删（deleteMany 对"本来就没有"是幂等的）
      this.prisma.campusSession.deleteMany({ where: { userId, platform } }),
      // 绑定元数据：软删（保留"曾经绑定过"的审计线索，契约 §2.9）
      this.prisma.techpieLink.updateMany({
        where: { userId, provider: platform, deletedAt: null },
        data: { status: 'REVOKED', deletedAt: new Date(), externalUserId: null },
      }),
    ]);
  }

  /**
   * 手动续期（契约 §11.2 冻结 action）。
   *
   * Phase 0 的上游**没有**续期能力：`/api/auth/renew` 是 TechPie **自建后端**的能力
   * （规格 §6.3 R4 / U8），我们无法假定它对我们开放。
   * 因此这里**如实报错**，绝不谎称"已续期"（失败模式 F3）。
   */
  async renew(userId: string, platform: CampusPlatform): Promise<CampusBindingState> {
    const binding = await this.getBinding(userId, platform);
    if (!binding) {
      throw new CampusSessionError('NOT_FOUND', '绑定不存在或已解绑', { platform });
    }
    throw new CampusSessionError(
      'RENEW_NOT_SUPPORTED',
      '该平台的会话续期能力尚未对我们开放，无法续期（规格 §6.3 R4 / U8）。可达鸭不会谎称续期成功',
      { platform, blockedBy: ['U8'] },
    );
  }

  /* ---------------- I3：cookie 的唯一出口 ---------------- */

  /**
   * 契约 §11.4 **I3**：校园 cookie 的唯一受限出口。
   *
   * ⚠️ 写法说明：这里是**属性箭头函数**而不是方法简写。
   * 方法简写会让 `cookieHeaderFor` 这个子串同时出现在「声明」与「调用」处，
   * 于是 I3 的静态扫描只能退化成启发式规则；用属性写法后，
   * 「`cookieHeaderFor` 出现」⟺「有人真的在调用它」，扫描因此是**完备**的。
   * 详见 `domain/ports/campus-session.port.ts` 头部的论证。
   *
   * 返回值是**完整 header 串**而不是 cookie 对象：调用方在类型上就无法
   * 挑选出单个 cookie 单独使用（ADR 0004 §2.3）。
   */
  readonly cookieHeaderFor = async (userId: string, platform: CampusPlatform): Promise<string> => {
    const row = await this.prisma.campusSession.findUnique({
      where: { userId_platform: { userId, platform } },
    });

    if (!row || row.status !== 'ACTIVE') {
      throw new CampusSessionError('NOT_FOUND', '没有可用的校园会话，请先绑定', { platform });
    }
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new CampusSessionError('NOT_FOUND', '校园会话已过期，请重新绑定', { platform });
    }

    const plaintext = decryptSecret(row.sessionCipher, this.encryptionKey());
    const secret = parseSecret(plaintext);

    // ⚠️ OPENID 通道**没有**可注入的 cookie（规格 §8.4 方案 W4：
    // 小程序 `web-view` 无法注入 cookie；Phase 0 的结论是"我们不接触 cookie"）。
    // 因此这里如实报错，而不是编一个假的 header 串。
    if (!secret.cookieHeader) {
      throw new CampusSessionError(
        'NOT_FOUND',
        '该绑定是 OPENID 通道，没有可注入的 cookie（Phase 0 采用 W4：用户在校园系统页面自己登录）',
        { platform },
      );
    }
    return secret.cookieHeader;
  };

  /* ---------------- 内部 ---------------- */

  private encryptionKey(): string {
    const key = this.config.get<string>('CAMPUS_SESSION_ENC_KEY');
    if (!key) {
      throw new InternalError('CAMPUS_SESSION_ENC_KEY 未配置：无法安全保存校园会话');
    }
    return key;
  }

  /** 密钥版本标识（**不可逆**，只用于轮换时区分密文批次） */
  private cipherKeyId(): string {
    return `v1:${fingerprintSecret(this.encryptionKey(), 'kedaya-keyid')}`;
  }
}

/**
 * 行 → **port 类型** `CampusBindingState`。
 *
 * 复用 domain 的 `toCampusBindingState`（**唯一**的投影实现）——
 * 本文件不再自己拼一份，否则两处映射迟早漂移。
 * 它逐字段显式挑选并跑运行时断言（I1 的镜像）。
 */
function toState(row: Parameters<typeof toLinkModel>[0]): CampusBindingState {
  return toCampusBindingState(toLinkModel(row));
}

function parseSecret(plaintext: string): EcardOpenIdSecret {
  try {
    const parsed = JSON.parse(plaintext) as Partial<EcardOpenIdSecret>;
    return {
      channel: parsed.channel === 'wechat' ? 'wechat' : 'wechat',
      authCode: typeof parsed.authCode === 'string' ? parsed.authCode : '',
      cookieHeader: typeof parsed.cookieHeader === 'string' ? parsed.cookieHeader : null,
    };
  } catch {
    // 解密成功但内容不是 JSON：说明密文被换过或版本不匹配。
    // **不回显内容**（规格 §10.3）。
    throw new CampusSessionError('INVALID_CREDENTIAL', '校园会话密文格式不受支持，请重新绑定');
  }
}

/** 供测试断言用的导出（**不是**运行时依赖） */
export const __testing = { ECARD_OPENID_TTL_MS, toState, parseSecret };
export type { CampusSessionRow };
