import type { CampusPlatform, CampusSession } from './auth.domain';

/**
 * 第二级 · 能力层的数据端口（契约 §5）。
 *
 * 与 `CampusSessionPort` 的分工（两者都在 auth 模块的 domain 里，但职责不同）：
 *   · `CampusSessionPort` —— **保管**凭据：绑定 / 解绑 / 取 session（密文落库，只有它能解密）；
 *   · `CampusDataPort`    —— **使用**凭据：拿着 session 去上游取业务数据。
 *
 * 为什么要拆开：三块「有真实价值」的能力（身份、课表、校园卡）都要用同一个
 * session 去不同的上游取数，但**谁都不允许自己碰密文**。拆成端口后：
 *   · 上游换地址/换协议只改 data 层一个适配器；
 *   · `schedule` / `campus-card` 模块只依赖本接口，不需要 import Prisma，
 *     也不需要知道 session 是怎么解的（契约 §5 硬规则 2 的落地方式）。
 *
 * ⚠️ 真实对接点：上科大的 EGATE / CPDAILY / JWC / CARD 都要求
 * **官方申请**的客户端凭据与合法来源地址。本仓库默认跑
 * `CAMPUS_DATA_MODE=mock`（确定性模拟数据，响应里 `simulated: true` 如实标注），
 * 拿到正式授权后把 `CAMPUS_DATA_MODE` 切成 `live` 并配置各系统的 DATA_URL 即可，
 * 端口契约不变。
 */

/** 上游身份（实名信息，**高敏感**：默认脱敏返回，明文需要显式 reveal + 审计） */
export interface CampusIdentityDatum {
  studentId: string;
  realName: string;
  department: string | null;
  email: string | null;
  /** 校区，如「张江」 */
  campus: string | null;
}

/** 上游课表条目（与本地 `ScheduleCourse` 行字段对齐，便于直接落库） */
export interface CampusCourseDatum {
  courseName: string;
  teacher: string | null;
  location: string | null;
  /** 1=周一 … 7=周日 */
  weekday: number;
  /** 第几节开始 / 结束（1..12） */
  startSlot: number;
  endSlot: number;
  /** 周次说明，如「1-16 周」；上游不给则为 null */
  weeks: string | null;
}

export interface CampusCardTransactionDatum {
  amountFen: number;
  direction: 'in' | 'out';
  merchant: string;
  happenedAt: Date;
  balanceAfterFen: number;
}

export interface CampusCardSnapshot {
  balanceFen: number;
  transactions: CampusCardTransactionDatum[];
  /** 上游数据的时间戳 —— UI 必须展示它，否则用户无法判断"这余额是不是新的" */
  dataAsOf: Date;
}

export interface CampusDataPort {
  /** 当前实现是模拟数据还是真实上游。**必须如实透传给客户端**（不得把模拟数据当真实的） */
  readonly mode: 'mock' | 'live';
  fetchIdentity(session: CampusSession): Promise<CampusIdentityDatum>;
  fetchSchedule(session: CampusSession, term: string): Promise<CampusCourseDatum[]>;
  fetchCard(session: CampusSession): Promise<CampusCardSnapshot>;
}

export const CAMPUS_DATA_PORT = Symbol('KEDAYA_CAMPUS_DATA_PORT');

/**
 * 开发用模拟凭据前缀：`demo:<platform>:<userId>`。
 *
 * 它**不是**真实 session —— 只是让「绑定 → 取数 → 解绑」这条链路在没有
 * 官方授权的情况下也能完整跑通（并让 `CampusSessionPort` 的加密落库逻辑
 * 得到真实覆盖）。仅在 `CAMPUS_DATA_MODE=mock` 且非生产环境由服务端签发。
 */
export const DEMO_CAMPUS_SESSION_PREFIX = 'demo:';

export function buildDemoCampusSessionRef(platform: CampusPlatform, userId: string): string {
  return `${DEMO_CAMPUS_SESSION_PREFIX}${platform}:${userId}`;
}

export function isDemoCampusSessionRef(sessionRef: string): boolean {
  return sessionRef.startsWith(DEMO_CAMPUS_SESSION_PREFIX);
}

/**
 * 实名信息脱敏（契约 §9 数据最小化）。
 *
 * 规则：姓名只留姓氏 + 星号；学号只留前 4 位；邮箱只留首字母与域名。
 * 脱敏在**服务端**做 —— 客户端拿到什么就显示什么，不给"前端自己打码"的机会
 * （前端打码意味着明文已经离开服务端）。
 */
export function maskCampusIdentity(datum: CampusIdentityDatum): CampusIdentityDatum {
  const name = [...datum.realName];
  const maskedName = name.length <= 1 ? datum.realName : `${name[0]}${'*'.repeat(name.length - 1)}`;

  const maskedStudentId = datum.studentId.length <= 4 ? datum.studentId : `${datum.studentId.slice(0, 4)}${'*'.repeat(datum.studentId.length - 4)}`;

  const maskedEmail =
    datum.email === null || !datum.email.includes('@')
      ? datum.email
      : `${datum.email.slice(0, 1)}***${datum.email.slice(datum.email.indexOf('@'))}`;

  return {
    ...datum,
    realName: maskedName,
    studentId: maskedStudentId,
    email: maskedEmail,
  };
}
