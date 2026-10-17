/**
 * 校园卡 · campus-card（契约 §4）
 *
 * CRUD 骨架由 scripts/scaffold.mjs 生成；下面的领域方法（余额总览 / 挂失指引）
 * 才是用户真正要的东西。
 *
 * **高可用设计（本模块最重要的一条）**：
 *   余额来自校园卡系统（第二级），上游随时可能挂。此时**绝不能**把余额
 *   渲染成 `0.00` —— 用户会以为钱没了，比"暂时看不到"严重得多。
 *   因此策略是：上游失败 → 退回本地缓存 → 明确标注 `stale: true` +
 *   上次成功时间；只有**连缓存都没有**时才把错误抛给客户端。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/compliance/audit.service';
import { CrudService } from '../../common/crud/crud.service';
import { CampusBindingRequiredError, ValidationError } from '../../common/errors/app-error';
import { CAMPUS_SESSION_PORT, type CampusSessionPort } from '../auth/domain/auth.domain';
import { CLOCK } from '../auth/domain/local-account.domain';
import { CAMPUS_DATA_PORT, type CampusDataPort } from '../auth/domain/campus-data.domain';
import {
  CAMPUS_CARD_TRANSACTION_REPOSITORY,
  type CampusCardTransactionModel,
  type CampusCardTransactionRepository,
  type CreateCampusCardTransactionInput,
  type UpdateCampusCardTransactionInput,
} from './domain/campus-card.domain';
import {
  LOW_BALANCE_THRESHOLD_FEN,
  buildInsight,
  isLowBalance,
  withBalanceForecast,
  type CardSpendingInsight,
} from './domain/card-insight';

/** 缓存展示窗口：够看一个月，再多也没人翻 */
const CACHE_WINDOW = 100;

export interface CampusCardTransactionView {
  id: string;
  amountFen: number;
  direction: string;
  merchant: string;
  happenedAt: string;
  balanceAfterFen: number;
  /** `"−12.50"` / `"+200.00"`：符号由服务端算好，避免各端各写一套格式化 */
  amountLabel: string;
}

export interface CampusCardOverview {
  /** 已绑定的卡系统（目前只有 CARD） */
  platform: 'CARD';
  balanceFen: number;
  thresholdFen: number;
  lowBalance: boolean;
  dataAsOf: string;
  /** 本地上次成功同步时间；无缓存为 null */
  syncedAt: string | null;
  /** true = 上游失败，当前展示的是缓存数据（UI 必须显著提示） */
  stale: boolean;
  staleReason: string | null;
  simulated: boolean;
  transactions: CampusCardTransactionView[];
  insight: CardSpendingInsight;
}

/** 挂失指引（我们**不能**替用户挂失：没有上游写权限，假装"已挂失"是欺骗） */
export interface CampusCardLostReport {
  accepted: true;
  /** 我们做了什么、没做什么，如实说清 */
  note: string;
  steps: string[];
  channels: { name: string; detail: string }[];
  audited: boolean;
}

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class CampusCardTransactionService extends CrudService<
  CampusCardTransactionModel,
  CreateCampusCardTransactionInput,
  UpdateCampusCardTransactionInput
> {
  private readonly logger = new Logger(CampusCardTransactionService.name);

  constructor(
    @Inject(CAMPUS_CARD_TRANSACTION_REPOSITORY)
    private readonly repo: CampusCardTransactionRepository,
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(CAMPUS_DATA_PORT) private readonly campusData: CampusDataPort,
    @Inject(CLOCK) private readonly clock: () => Date,
    private readonly audit: AuditService,
  ) {
    super(repo, 'campus-card', '校园卡');
  }

  /**
   * 创建。userId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(
    input: CreateCampusCardTransactionInput,
    actorId?: string,
  ): Promise<CampusCardTransactionModel> {
    const owner = input.userId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 userId', { field: 'userId' });
    }
    return super.create({ ...input, userId: owner });
  }

  /**
   * 契约 §5 硬规则 3 的第二个落点：
   * 校园卡能力属于**第二级**，未绑定 → CAMPUS_BINDING_REQUIRED。
   * 注意本模块虽是 high 敏感，但**不设同意门**（契约 §9）。
   */
  async balanceSummary(userId: string) {
    const session = await this.campusSession.acquireSession(userId, 'CARD');
    if (!session) {
      throw new CampusBindingRequiredError('请先绑定校园卡系统（CARD）后再查看汇总', {
        platform: 'CARD',
      });
    }
    return this.repo.summarize(userId);
  }

  /**
   * 余额总览 —— 「校园卡」页的全部数据，一次请求拉齐。
   *
   * 流程：取 session → 打上游 → 成功则刷新缓存；失败则退回缓存并标注 `stale`。
   */
  async overview(
    userId: string,
    thresholdOverride?: number,
  ): Promise<CampusCardOverview> {
    const thresholdFen = thresholdOverride ?? LOW_BALANCE_THRESHOLD_FEN;
    const session = await this.campusSession.acquireSession(userId, 'CARD');
    if (!session) {
      throw new CampusBindingRequiredError('请先绑定校园卡系统（CARD）后再查看余额', {
        platform: 'CARD',
      });
    }

    try {
      const snapshot = await this.campusData.fetchCard(session);

      // 刷新缓存失败不该影响本次展示（上游数据已经拿到手了）
      let syncedAt: Date = this.clock();
      try {
        await this.repo.replaceAll(
          userId,
          snapshot.transactions.map((tx) => ({ userId, ...tx })),
        );
        syncedAt = (await this.repo.lastCachedAt(userId)) ?? syncedAt;
      } catch (error) {
        this.logger.warn(
          `校园卡流水写入缓存失败（已跳过，仍展示上游数据）: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      const transactions = snapshot.transactions.map((tx, index) =>
        toView({ id: `upstream-${index}`, userId, createdAt: syncedAt, ...tx }),
      );

      return {
        platform: 'CARD',
        balanceFen: snapshot.balanceFen,
        thresholdFen,
        lowBalance: isLowBalance(snapshot.balanceFen, thresholdFen),
        dataAsOf: snapshot.dataAsOf.toISOString(),
        syncedAt: syncedAt.toISOString(),
        stale: false,
        staleReason: null,
        simulated: this.campusData.mode === 'mock',
        transactions,
        insight: this.insightOf(transactions, snapshot.balanceFen),
      };
    } catch (error) {
      const cached = await this.repo.listRecent(userId, CACHE_WINDOW);
      if (cached.length === 0) throw error; // 无缓存可退 —— 如实报错，客户端展示"重试"

      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`校园卡上游不可用，退回缓存展示: ${reason}`);

      const latest = cached[0] as CampusCardTransactionModel;
      const transactions = cached.map(toView);
      const lastCachedAt = await this.repo.lastCachedAt(userId);

      return {
        platform: 'CARD',
        // 缓存里最新一笔的余额快照就是"最后一次看到的余额"
        balanceFen: latest.balanceAfterFen,
        thresholdFen,
        lowBalance: isLowBalance(latest.balanceAfterFen, thresholdFen),
        dataAsOf: latest.happenedAt.toISOString(),
        syncedAt: lastCachedAt?.toISOString() ?? null,
        stale: true,
        staleReason: reason,
        simulated: this.campusData.mode === 'mock',
        transactions,
        insight: this.insightOf(transactions, latest.balanceAfterFen),
      };
    }
  }

  /**
   * 挂失指引。
   *
   * 刻意**不做**"一键挂失"：KedaYa 对校园卡系统没有写权限，
   * 假造一个"已挂失"的成功提示会让用户在真正需要冻结的几分钟里毫无防备。
   * 这里只做两件确定有价值的事：把官方挂失路径讲清楚 + 落审计（便于事后追溯）。
   */
  async lostReport(userId: string, reason?: string): Promise<CampusCardLostReport> {
    await this.audit.record({
      actorId: userId,
      action: 'campus-card.lost-report.view',
      resource: 'CampusCardTransaction',
      module: 'campus-card',
      metadata: { reason: reason ?? null },
    });

    return {
      accepted: true,
      note:
        '可达鸭不会、也无法替你挂失 —— 校园卡挂失需要在校园卡系统完成。' +
        '下面是最快的官方路径；请务必在挂失后确认余额未被继续扣减。',
      steps: [
        '立即在校园卡自助终端或官方渠道办理挂失（冻结卡片）',
        '回忆最后一次刷卡地点，联系该处管理人员登记（食堂/图书馆常有拾卡登记）',
        '挂失 24 小时后仍不放心，可到校园卡服务中心补办并核对流水',
        '若发现非本人消费，带上流水记录找服务中心申诉（本页可截图作为凭证）',
      ],
      channels: [
        { name: '校园卡服务中心', detail: '工作日 08:30–17:00，可受理挂失 / 补办 / 申诉' },
        { name: '校园卡自助终端', detail: '各食堂入口一般都有，24 小时可自助挂失' },
        { name: '信息化服务台', detail: '处理账号与卡片解绑 / 异常扣款核查' },
      ],
      audited: true,
    };
  }

  private insightOf(
    transactions: readonly CampusCardTransactionView[],
    balanceFen: number,
  ): CardSpendingInsight {
    // 洞察只依赖「金额 / 方向 / 时间 / 商户」，因此可以复用一个最小的行形状
    const rows: CampusCardTransactionModel[] = transactions.map((tx) => ({
      id: tx.id,
      userId: '',
      amountFen: tx.amountFen,
      direction: tx.direction,
      merchant: tx.merchant,
      happenedAt: new Date(tx.happenedAt),
      balanceAfterFen: tx.balanceAfterFen,
      createdAt: new Date(tx.happenedAt),
    }));
    return withBalanceForecast(buildInsight(rows, this.clock()), balanceFen);
  }
}

function toView(row: CampusCardTransactionModel): CampusCardTransactionView {
  const yuan = (row.amountFen / 100).toFixed(2);
  return {
    id: row.id,
    amountFen: row.amountFen,
    direction: row.direction,
    merchant: row.merchant,
    happenedAt: row.happenedAt.toISOString(),
    balanceAfterFen: row.balanceAfterFen,
    amountLabel: row.direction === 'in' ? `+${yuan}` : `−${yuan}`,
  };
}
