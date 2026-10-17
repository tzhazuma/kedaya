import { Inject, Injectable, Optional } from '@nestjs/common';
import { MINIAPP_PAGES, type Page } from '@kedaya/contracts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../common/errors/app-error';
import {
  NOTIFICATION_PORT,
  miniappDetailLink,
  type NotificationPort,
} from '../../common/notifications/notification.port';
import {
  ERRAND_MAX_REWARD_FEN,
  ERRAND_SORTS,
  ERRAND_STATUS,
  ERRAND_STATUSES,
  ERRAND_TASK_REPOSITORY,
  type CreateErrandTaskInput,
  type ErrandSort,
  type ErrandTaskListQuery,
  type ErrandTaskModel,
  type ErrandTaskRepository,
  type UpdateErrandTaskInput,
} from './domain/errand.domain';

/**
 * 跑腿用例层（契约 §7：controller → service → repository）。
 *
 * 这里集中放置**领域规则**，让 controller 只做 HTTP 形状、repository 只做 IO：
 *   · 归属：发布者才能改 / 删 / 取消 / 确认完成，接单者才能确认送达；
 *   · 状态机：open → accepted → delivered → completed，cancelled 为终态，
 *     非法跃迁返回 CONFLICT；
 *   · 校验：悬赏区间、截止时间、标题与地点长度（脏数据不落库）。
 *
 * 依赖用**显式 token** 注入（不使用 design:paramtypes），
 * 因此 `new ErrandTaskService(fakeRepo)` 就能在 vitest 里直接测，无需 DI 容器。
 * `notifier` 是 `@Optional()` 的：纯领域单测可以不提供它。
 */
@Injectable()
export class ErrandTaskService {
  constructor(
    @Inject(ERRAND_TASK_REPOSITORY) private readonly repo: ErrandTaskRepository,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifier?: NotificationPort,
  ) {}

  async list(query: Partial<ErrandTaskListQuery> = {}): Promise<Page<ErrandTaskModel>> {
    return this.repo.list({
      limit: query.limit ?? 20,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.status === undefined ? {} : { status: normalizeStatus(query.status) }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword.trim().slice(0, 60) }),
      ...(query.fromPlace === undefined ? {} : { fromPlace: query.fromPlace }),
      ...(query.toPlace === undefined ? {} : { toPlace: query.toPlace }),
      ...(query.requesterId === undefined ? {} : { requesterId: query.requesterId }),
      ...(query.runnerId === undefined ? {} : { runnerId: query.runnerId }),
      sort: normalizeSort(query.sort),
    });
  }

  async create(input: CreateErrandTaskInput, actorId?: string): Promise<ErrandTaskModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再发布跑腿任务');

    return this.repo.create({
      requesterId: actorId, // 永远以登录主体为准，忽略请求体里的 requesterId
      title: normalizeTitle(input.title),
      detail: normalizeText(input.detail, 2000, '任务明细'),
      rewardFen: normalizeReward(input.rewardFen),
      fromPlace: normalizePlace(input.fromPlace, '出发地'),
      toPlace: normalizePlace(input.toPlace, '目的地'),
      deadline: normalizeDeadline(input.deadline),
    });
  }

  async detail(id: string): Promise<ErrandTaskModel> {
    const task = await this.repo.findById(id);
    if (!task) throw new NotFoundError('跑腿任务不存在或已被删除');
    return task;
  }

  async update(id: string, input: UpdateErrandTaskInput, actorId?: string): Promise<ErrandTaskModel> {
    const task = await this.detail(id);
    this.assertOwner(task, actorId, '只能修改自己发布的跑腿任务');
    this.assertEditable(task);

    const patch: UpdateErrandTaskInput = {};
    if (input.title !== undefined) patch.title = normalizeTitle(input.title);
    if (input.detail !== undefined) patch.detail = normalizeText(input.detail, 2000, '任务明细');
    if (input.rewardFen !== undefined) patch.rewardFen = normalizeReward(input.rewardFen);
    if (input.fromPlace !== undefined) patch.fromPlace = normalizePlace(input.fromPlace, '出发地');
    if (input.toPlace !== undefined) patch.toPlace = normalizePlace(input.toPlace, '目的地');
    if (input.deadline !== undefined) patch.deadline = normalizeDeadline(input.deadline);

    return this.repo.update(id, patch);
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const task = await this.detail(id);
    this.assertOwner(task, actorId, '只能删除自己发布的跑腿任务');
    this.assertEditable(task);
    await this.repo.remove(id);
  }

  /**
   * 接单。
   *
   * 三条硬规则：不能接自己发布的单、只有 `open` 可接、重复接单返回 CONFLICT。
   * 接单时一次性写入 `runnerId` / `acceptedAt` / `status`，避免出现
   * "已接单但没记录接单时间"的中间态。
   */
  async accept(id: string, actorId?: string): Promise<ErrandTaskModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录后再接单');

    const task = await this.detail(id);
    if (task.requesterId === actorId) {
      throw new ValidationError('不能接自己发布的跑腿任务');
    }
    if (task.status !== ERRAND_STATUS.open) {
      if (task.runnerId === actorId) throw new ConflictError('你已经接过这一单了');
      throw new ConflictError('该任务已被接单或已结束');
    }

    const updated = await this.repo.applyState(id, {
      status: ERRAND_STATUS.accepted,
      runnerId: actorId,
      acceptedAt: new Date(),
    });

    // 通知发布者：有人接单了。正文**不含**接单者昵称 —— 拉昵称要再查一次用户表，
    // 而这条通知的价值在"去确认"，不在"谁接的"（详情页里有）。
    await this.notifySafely({
      userId: task.requesterId,
      title: '你的跑腿悬赏已被接单',
      body: `「${task.title}」已被同学接单，完成后请及时确认。`,
      source: 'errand',
      link: miniappDetailLink(MINIAPP_PAGES.errandDetail, id),
    });

    return updated;
  }

  /** 接单者确认送达：只有 runner 本人、且状态为 accepted 时可操作 */
  async deliver(id: string, actorId?: string): Promise<ErrandTaskModel> {
    if (!actorId) throw new UnauthenticatedError('请先登录');

    const task = await this.detail(id);
    if (task.runnerId !== actorId) {
      throw new ForbiddenError('只有接单者可以确认送达');
    }
    if (task.status !== ERRAND_STATUS.accepted) {
      throw new ConflictError('只有「已接单」的任务可以确认送达');
    }

    const updated = await this.repo.applyState(id, {
      status: ERRAND_STATUS.delivered,
      deliveredAt: new Date(),
    });

    await this.notifySafely({
      userId: task.requesterId,
      title: '你的跑腿任务已送达',
      body: `「${task.title}」已被接单者标记为送达，确认后即可结算。`,
      source: 'errand',
      link: miniappDetailLink(MINIAPP_PAGES.errandDetail, id),
    });

    return updated;
  }

  /** 发布者确认完成：状态必须是 delivered */
  async complete(id: string, actorId?: string): Promise<ErrandTaskModel> {
    const task = await this.detail(id);
    this.assertOwner(task, actorId, '只有发布者可以确认完成');
    if (task.status !== ERRAND_STATUS.delivered) {
      throw new ConflictError('只有「已送达」的任务可以确认完成');
    }

    const updated = await this.repo.applyState(id, {
      status: ERRAND_STATUS.completed,
      settledAt: new Date(),
    });

    // 通知接单者：任务已确认完成（这是 TA 唯一能收到"对方确认了"的渠道）
    if (task.runnerId) {
      await this.notifySafely({
        userId: task.runnerId,
        title: '跑腿任务已确认完成',
        body: `「${task.title}」发布者已确认完成，悬赏请按双方约定结算。`,
        source: 'errand',
        link: miniappDetailLink(MINIAPP_PAGES.errandDetail, id),
      });
    }

    return updated;
  }

  /** 发布者取消：open / accepted 时可用；completed / cancelled 后不再受理 */
  async cancel(id: string, actorId?: string): Promise<ErrandTaskModel> {
    const task = await this.detail(id);
    this.assertOwner(task, actorId, '只有发布者可以取消任务');

    if (task.status !== ERRAND_STATUS.open && task.status !== ERRAND_STATUS.accepted) {
      throw new ConflictError('该任务当前状态不可取消');
    }

    return this.repo.applyState(id, { status: ERRAND_STATUS.cancelled });
  }

  private assertOwner(task: ErrandTaskModel, actorId: string | undefined, message: string): void {
    if (!actorId) throw new UnauthenticatedError('请先登录');
    if (task.requesterId !== actorId) throw new ForbiddenError(message);
  }

  /**
   * 写站内信（best-effort）。
   *
   * 这里再包一层 `try/catch`，而不是只依赖 `NotificationService.notify` 自己吞异常：
   * 端口是接口，将来换实现（例如发订阅消息的实现忘了吞异常）时，
   * 这一层能保证"通知失败绝不影响跑腿状态机"这条规则不被破坏。
   */
  private async notifySafely(input: Parameters<NotificationPort['notify']>[0]): Promise<void> {
    if (!this.notifier) return;
    try {
      await this.notifier.notify(input);
    } catch {
      // 通知失败只影响"用户晚一点知道"，不影响任务状态已经落库的事实
    }
  }

  /** completed / cancelled 之后任务已经结束，不再允许修改或删除 */
  private assertEditable(task: ErrandTaskModel): void {
    if (task.status === ERRAND_STATUS.completed || task.status === ERRAND_STATUS.cancelled) {
      throw new ConflictError('已完成的跑腿任务不能再修改');
    }
  }
}

/* ------------------------------------------------------------------ *
 * 归一化与校验（纯函数，便于单测）
 * ------------------------------------------------------------------ */

function normalizeTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length === 0) throw new ValidationError('请填写任务标题', { field: 'title' });
  if ([...title].length > 60) throw new ValidationError('标题最多 60 个字', { field: 'title' });
  return title;
}

function normalizePlace(value: unknown, label: string): string {
  const place = typeof value === 'string' ? value.trim() : '';
  if (place.length === 0) throw new ValidationError(`请填写${label}`, { field: 'place' });
  if ([...place].length > 60) throw new ValidationError(`${label}最多 60 个字`, { field: 'place' });
  return place;
}

function normalizeReward(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError('悬赏必须是以「分」为单位的整数', { field: 'rewardFen' });
  }
  if (value < 0) throw new ValidationError('悬赏不能为负数', { field: 'rewardFen' });
  if (value > ERRAND_MAX_REWARD_FEN) {
    throw new ValidationError('悬赏超出上限（1000 元）', { field: 'rewardFen' });
  }
  return value;
}

function normalizeDeadline(value: unknown): Date {
  const deadline = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(deadline.getTime())) {
    throw new ValidationError('截止时间格式不正确', { field: 'deadline' });
  }
  if (deadline.getTime() <= Date.now()) {
    throw new ValidationError('截止时间必须晚于当前时间', { field: 'deadline' });
  }
  return deadline;
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string' || !(ERRAND_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError('任务状态不在支持范围内', {
      field: 'status',
      allowed: ERRAND_STATUSES,
    });
  }
  return value;
}

function normalizeSort(value: unknown): ErrandSort {
  if (value === undefined || value === null || value === '') return 'latest';
  if (typeof value !== 'string' || !(ERRAND_SORTS as readonly string[]).includes(value)) {
    throw new ValidationError('排序方式不支持', { field: 'sort', allowed: ERRAND_SORTS });
  }
  return value as ErrandSort;
}

function normalizeText(value: unknown, max: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ValidationError(`${label}格式不正确`);
  const text = value.trim();
  if (text.length === 0) return null;
  if ([...text].length > max) throw new ValidationError(`${label}最多 ${max} 个字`);
  return text;
}
