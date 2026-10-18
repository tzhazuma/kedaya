import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalError, UpstreamUnavailableError } from '../../../common/errors/app-error';
import type { CampusPlatform, CampusSession } from '../domain/auth.domain';
import type {
  CampusCardSnapshot,
  CampusCourseDatum,
  CampusDataPort,
  CampusIdentityDatum,
} from '../domain/campus-data.domain';

/**
 * `CampusDataPort` 的**真实上游实现**（`CAMPUS_DATA_MODE=live`）。
 *
 * 这是把「官方授权拿到的 session」真正用出去的地方：
 *   · 凭据只作为 Cookie 头随请求发出，**不落日志、不进错误信息**；
 *   · 每个上游地址独立配置（`CAMPUS_EGATE_DATA_URL` / `CAMPUS_JWC_DATA_URL` /
 *     `CAMPUS_CARD_DATA_URL`），未配置时**明确报错**而不是返回空数据 ——
 *     "静默返回空"会让用户以为"我这学期没课/卡里没钱"，比报错更糟；
 *   · 超时/网络错误统一翻成 `UPSTREAM_UNAVAILABLE`，客户端可重试、可降级到缓存。
 *
 * 上游 JSON 形状按「最省事的约定」解析（`{ ... }` 或 `{ data: {...} }`），
 * 拿到正式接口文档后只需调整下面三个 `parse*` 方法。
 */
@Injectable()
export class HttpCampusDataAdapter implements CampusDataPort {
  readonly mode = 'live' as const;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async fetchIdentity(session: CampusSession): Promise<CampusIdentityDatum> {
    const body = await this.getJson(session, 'egate', '/identity');
    return {
      studentId: readString(body, 'studentId'),
      realName: readString(body, 'realName'),
      department: readOptionalString(body, 'department'),
      email: readOptionalString(body, 'email'),
      campus: readOptionalString(body, 'campus'),
    };
  }

  async fetchSchedule(session: CampusSession, term: string): Promise<CampusCourseDatum[]> {
    const body = await this.getJson(session, 'jwc', `/schedule?term=${encodeURIComponent(term)}`);
    const rows = Array.isArray(body) ? body : readArray(body, 'courses');
    return rows.map((row) => ({
      courseName: readString(row, 'courseName'),
      teacher: readOptionalString(row, 'teacher'),
      location: readOptionalString(row, 'location'),
      weekday: readNumber(row, 'weekday'),
      startSlot: readNumber(row, 'startSlot'),
      endSlot: readNumber(row, 'endSlot'),
      weeks: readOptionalString(row, 'weeks'),
    }));
  }

  async fetchCard(session: CampusSession): Promise<CampusCardSnapshot> {
    const body = await this.getJson(session, 'ecard', '/snapshot');
    const rows = readArray(body, 'transactions');
    return {
      balanceFen: readNumber(body, 'balanceFen'),
      dataAsOf: new Date(),
      transactions: rows.map((row) => ({
        amountFen: readNumber(row, 'amountFen'),
        direction: readString(row, 'direction') === 'in' ? 'in' : 'out',
        merchant: readString(row, 'merchant'),
        happenedAt: new Date(readString(row, 'happenedAt')),
        balanceAfterFen: readNumber(row, 'balanceAfterFen'),
      })),
    };
  }

  /* ---------------- 内部 ---------------- */

  private baseUrl(platform: CampusPlatform): string {
    const url = this.config.get<string>(`CAMPUS_${platform}_DATA_URL`);
    if (!url) {
      throw new InternalError(
        `校园系统 ${platform} 未配置数据地址：请在服务端设置 CAMPUS_${platform}_DATA_URL；` +
          '本地开发请改用 CAMPUS_DATA_MODE=mock（默认值），' +
          '模拟数据会在响应里标注 simulated=true',
      );
    }
    return url.replace(/\/$/, '');
  }

  private async getJson(session: CampusSession, platform: CampusPlatform, path: string): Promise<unknown> {
    const timeoutMs = Number(this.config.get<string>('CAMPUS_UPSTREAM_TIMEOUT_MS') ?? 6000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl(platform)}${path}`, {
        method: 'GET',
        // 凭据只在请求头里出现，绝不写日志
        headers: { Cookie: session.sessionRef, Accept: 'application/json' },
        signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 6000),
      });
    } catch {
      throw new UpstreamUnavailableError(`校园系统 ${platform} 暂时不可用，请稍后重试`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new UpstreamUnavailableError(`校园系统 ${platform} 的授权已失效，请重新绑定`);
    }
    if (!response.ok) {
      throw new UpstreamUnavailableError(`校园系统 ${platform} 返回了异常状态（${response.status}）`);
    }

    try {
      return await response.json();
    } catch {
      throw new UpstreamUnavailableError(`校园系统 ${platform} 返回了无法解析的数据`);
    }
  }
}

/* ---------------- 解析小工具：形状不对就抛 UPSTREAM_UNAVAILABLE ---------------- */

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UpstreamUnavailableError('上游返回了非预期的数据结构');
  }
  const record = value as Record<string, unknown>;
  // 统一信封 { data: {...} } 与裸对象两种形状
  return typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : record;
}

function readString(source: unknown, key: string): string {
  const value = asRecord(source)[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new UpstreamUnavailableError(`上游响应缺少字段 ${key}`);
  }
  return value;
}

function readOptionalString(source: unknown, key: string): string | null {
  const value = asRecord(source)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(source: unknown, key: string): number {
  const value = asRecord(source)[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new UpstreamUnavailableError(`上游响应字段 ${key} 不是数字`);
  }
  return value;
}

function readArray(source: unknown, key: string): unknown[] {
  const record = asRecord(source);
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new UpstreamUnavailableError(`上游响应字段 ${key} 不是数组`);
  }
  return value;
}
