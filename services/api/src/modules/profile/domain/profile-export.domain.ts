/**
 * 「我的」· 数据导出（契约 §9 数据可携权）。
 *
 * 为什么单独一个端口而不是在 service 里直接查 Prisma：
 *   「导出我自己的全部数据」天然要横跨多个模块的表（发布内容在各业务模块里），
 *   如果让 service 直接 query，就等于把 19 张表的知识塞进 profile 的用例层，
 *   以后任何模块改表都会牵动这里。
 *   因此把它收成一个**只读投影端口**：
 *     · domain 层只声明"我要一份账号档案 + 各模块条数"；
 *     · data 层负责怎么查（唯一碰 Prisma 的地方，符合契约 §7 依赖方向）。
 *
 * 范围说明（**如实告知用户，不假装导出全部**）：
 *   导出的是「账号与隐私档案」+「内容条数」，**不含**他人数据、不含校园卡
 *   逐笔流水的明细正文、不含匿名帖的匿名映射（契约 §9：匿名身份与实名解耦）。
 */

import type { ProfileSettingModel } from './profile.domain';

export interface ProfileExportIdentity {
  provider: string;
  email: string | null;
  realName: string | null;
  linkedAt: string;
}

export interface ProfileExportBinding {
  platform: string;
  status: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
}

export interface ProfileExportAccount {
  id: string;
  displayName: string;
  /** 只给"有没有"和是否是 data URL，不回吐 base64 本体（否则导出文件会异常臃肿） */
  hasAvatar: boolean;
  anonEnabled: boolean;
  department: string | null;
  createdAt: string;
  /** 是否为纯第三方登录账号（无邮箱密码） */
  hasPassword: boolean;
  identities: ProfileExportIdentity[];
  campusBindings: ProfileExportBinding[];
}

export interface ProfileExportContentCount {
  module: string;
  nameZh: string;
  count: number;
  /** 例如「本模块数据可在模块内自行删除」 */
  note?: string;
}

export interface ProfileExportPort {
  account(userId: string): Promise<ProfileExportAccount | null>;
  contentCounts(userId: string): Promise<ProfileExportContentCount[]>;
}

export const PROFILE_EXPORT_PORT = Symbol('KEDAYA_PROFILE_EXPORT_PORT');

export interface ProfileExport {
  generatedAt: string;
  account: ProfileExportAccount | null;
  settings: ProfileSettingModel | null;
  consents: {
    module: string;
    nameZh: string;
    version: string;
    grantedAt: string;
    revokedAt: string | null;
  }[];
  audit: {
    /** 与我相关的审计条数（含"谁看过我的实名信息"这类敏感读取） */
    total: number;
    recent: { action: string; module: string | null; resource: string; at: string }[];
  };
  content: ProfileExportContentCount[];
  note: string;
}
