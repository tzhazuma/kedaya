/**
 * 课表 · schedule（契约 §4）
 *
 * 本文件由 scripts/scaffold.mjs 生成；要改形状请改脚本里的 SPEC 表，
 * 改完重跑 `npm run scaffold`，避免 15 个模块各写一套。
 */
import { Inject, Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { ValidationError } from '../../common/errors/app-error';
import {
  SCHEDULE_COURSE_REPOSITORY,
  type CreateScheduleCourseInput,
  type ScheduleCourseModel,
  type ScheduleCourseRepository,
  type UpdateScheduleCourseInput,
} from './domain/schedule.domain';

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ScheduleCourseService extends CrudService<ScheduleCourseModel, CreateScheduleCourseInput, UpdateScheduleCourseInput> {
  constructor(
    @Inject(SCHEDULE_COURSE_REPOSITORY) private readonly repo: ScheduleCourseRepository,
  ) {
    super(repo, 'schedule', '课表');
  }

  /**
   * 创建。userId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   */
  override async create(input: CreateScheduleCourseInput, actorId?: string): Promise<ScheduleCourseModel> {
    const owner = input.userId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 userId', { field: 'userId' });
    }
    return super.create({ ...input, userId: owner });
  }
  /** 领域查询：某学期某天的课表 */
  listByWeekday(term: string, weekday: number): Promise<ScheduleCourseModel[]> {
    return this.repo.listByWeekday(term, weekday);
  }}
