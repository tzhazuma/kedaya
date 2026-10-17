/**
 * 课表 · schedule（契约 §4）
 *
 * CRUD 骨架由 scripts/scaffold.mjs 生成；下面的领域方法（今日 / 本周 / 同步 /
 * 下一节课）是本模块真正的价值所在 —— 用户要的不是"一堆课程行"，
 * 而是「我现在该去哪」「今天还剩什么」「课表和教务一致吗」。
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { CampusBindingRequiredError, ValidationError } from '../../common/errors/app-error';
import {
  CAMPUS_SESSION_PORT,
  type CampusSessionPort,
} from '../auth/domain/auth.domain';
import { CLOCK } from '../auth/domain/local-account.domain';
import {
  CAMPUS_DATA_PORT,
  type CampusDataPort,
} from '../auth/domain/campus-data.domain';
import {
  SCHEDULE_COURSE_REPOSITORY,
  type CreateScheduleCourseInput,
  type ScheduleCourseModel,
  type ScheduleCourseRepository,
  type UpdateScheduleCourseInput,
} from './domain/schedule.domain';
import {
  MAX_SLOT,
  findConflicts,
  relativeDayLabel,
  resolveMoment,
  slotRangeLabel,
  termLabel,
  termOf,
  weekdayLabel,
  weekdayOf,
  type ScheduleConflict,
} from './domain/timetable.domain';

/** 下发给客户端的一条课程（时间信息由服务端算好，客户端只渲染） */
export interface ScheduleCourseView {
  id: string;
  courseName: string;
  teacher: string | null;
  location: string | null;
  weekday: number;
  startSlot: number;
  endSlot: number;
  /** `"08:15–09:05"` */
  timeLabel: string;
  /** `"第 1-2 节"` */
  slotLabel: string;
}

export interface ScheduleTodayView {
  term: string;
  termLabel: string;
  date: string;
  weekday: number;
  weekdayLabel: string;
  courses: ScheduleCourseView[];
  ongoing: ScheduleCourseView[];
  next: ScheduleCourseView | null;
  minutesUntilNext: number | null;
  nextStartsAt: string | null;
  finishedForToday: boolean;
  conflicts: ScheduleConflict[];
  /** 是否模拟数据（课表来自 mock 上游时必须如实标注） */
  simulated: boolean;
  /** 课表是否为空 —— UI 据此给"去同步"引导，而不是显示空白页 */
  empty: boolean;
}

export interface ScheduleWeekView {
  term: string;
  termLabel: string;
  /** 今天是周几（1..7），UI 用来高亮 */
  today: number;
  days: {
    weekday: number;
    label: string;
    relativeLabel: string;
    isToday: boolean;
    courses: ScheduleCourseView[];
  }[];
  conflicts: ScheduleConflict[];
  totalCount: number;
  /** 该用户有课表的其他学期（可切换查看） */
  terms: string[];
  simulated: boolean;
}

export interface ScheduleSyncResult {
  term: string;
  termLabel: string;
  imported: number;
  conflicts: ScheduleConflict[];
  simulated: boolean;
  syncedAt: string;
}

/**
 * 用例层（契约 §7）：只编排，不含 IO。
 * 依赖通过**显式 token** 注入（而非 design:paramtypes），
 * 这样在 vitest 等不做 emitDecoratorMetadata 的转译器下 DI 依然成立。
 */
@Injectable()
export class ScheduleCourseService extends CrudService<
  ScheduleCourseModel,
  CreateScheduleCourseInput,
  UpdateScheduleCourseInput
> {
  private readonly logger = new Logger(ScheduleCourseService.name);

  constructor(
    @Inject(SCHEDULE_COURSE_REPOSITORY) private readonly repo: ScheduleCourseRepository,
    @Inject(CAMPUS_SESSION_PORT) private readonly campusSession: CampusSessionPort,
    @Inject(CAMPUS_DATA_PORT) private readonly campusData: CampusDataPort,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {
    super(repo, 'schedule', '课表');
  }

  /**
   * 创建。userId 允许由请求主体补全（未登录时必须在 body 里显式给出）。
   *
   * 额外做一次节次合法性校验：教务数据可能带 `startSlot > endSlot` 的脏行，
   * 手工加课也可能是打错了。宁可当场报错，也不要把脏数据写进课表 ——
   * 学生会因此看到"这节课 11:25 开始，08:15 结束"这种荒谬结果。
   */
  override async create(
    input: CreateScheduleCourseInput,
    actorId?: string,
  ): Promise<ScheduleCourseModel> {
    const owner = input.userId ?? actorId;
    if (!owner) {
      throw new ValidationError('未登录时必须显式提供 userId', { field: 'userId' });
    }
    assertSlotRange(input.startSlot, input.endSlot);
    return super.create({ ...input, userId: owner });
  }

  /** 领域查询：某学期某天的课表 */
  listByWeekday(term: string, weekday: number): Promise<ScheduleCourseModel[]> {
    return this.repo.listByWeekday(term, weekday);
  }

  /** 今日课表 + 「现在 / 下一节」 */
  async today(userId: string, termOverride?: string): Promise<ScheduleTodayView> {
    const now = this.clock();
    const term = termOverride ?? termOf(now);
    const courses = await this.repo.listByUserTerm(userId, term);
    const today = weekdayOf(now);
    const todays = courses.filter((course) => course.weekday === today);
    const moment = resolveMoment(todays, now);

    return {
      term,
      termLabel: termLabel(term),
      date: formatDate(now),
      weekday: today,
      weekdayLabel: weekdayLabel(today),
      courses: todays.map(toView),
      ongoing: moment.ongoing.map(toView),
      next: moment.next === null ? null : toView(moment.next),
      minutesUntilNext: moment.minutesUntilNext,
      nextStartsAt: moment.nextStartsAt,
      finishedForToday: moment.finishedForToday,
      conflicts: findConflicts(courses).filter((conflict) => conflict.weekday === today),
      simulated: this.campusData.mode === 'mock',
      empty: todays.length === 0,
    };
  }

  /** 本周课表（一次拉齐 7 天 + 冲突 + 可切换的学期） */
  async week(userId: string, termOverride?: string): Promise<ScheduleWeekView> {
    const now = this.clock();
    const term = termOverride ?? termOf(now);
    const today = weekdayOf(now);

    const [courses, terms] = await Promise.all([
      this.repo.listByUserTerm(userId, term),
      this.repo.listTerms(userId),
    ]);

    return {
      term,
      termLabel: termLabel(term),
      today,
      days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        label: weekdayLabel(weekday),
        relativeLabel: relativeDayLabel(weekday, today),
        isToday: weekday === today,
        courses: courses.filter((course) => course.weekday === weekday).map(toView),
      })),
      conflicts: findConflicts(courses),
      totalCount: courses.length,
      terms: terms.includes(term) ? terms : [term, ...terms],
      simulated: this.campusData.mode === 'mock',
    };
  }

  /** 下一节课（agent「可达鸭」与桌面小组件共用） */
  async nextClass(userId: string): Promise<{
    next: ScheduleCourseView | null;
    minutesUntilNext: number | null;
    nextStartsAt: string | null;
    ongoing: ScheduleCourseView[];
    todayLabel: string;
  }> {
    const todayView = await this.today(userId);
    return {
      next: todayView.next,
      minutesUntilNext: todayView.minutesUntilNext,
      nextStartsAt: todayView.nextStartsAt,
      ongoing: todayView.ongoing,
      todayLabel: `${todayView.weekdayLabel} · ${todayView.termLabel}`,
    };
  }

  /**
   * 从教务系统（JWC）同步课表。
   *
   * 高可用要点：
   *   · 未绑定 → `CAMPUS_BINDING_REQUIRED`（客户端据此展示"去绑定"，而不是报错弹窗）；
   *   · 上游失败 → 直接抛出，**不清空**本地已有课表（replaceTerm 只在拿到数据后才执行），
   *     因此同步失败时用户看到的仍是上一次成功的课表 —— 这是最关键的一条：
   *     宁可显示旧课表并标注时间，也不要让用户的课表变空。
   */
  async syncFromCampus(userId: string, termOverride?: string): Promise<ScheduleSyncResult> {
    const term = termOverride ?? termOf(this.clock());
    const session = await this.campusSession.acquireSession(userId, 'JWC');
    if (!session) {
      throw new CampusBindingRequiredError(
        '请先绑定教务系统（JWC）才能同步课表',
        { platform: 'JWC' },
      );
    }

    const fetched = await this.campusData.fetchSchedule(session, term);
    const cleaned = fetched
      .filter((course) => isValidSlot(course.startSlot) && isValidSlot(course.endSlot))
      .filter((course) => course.startSlot <= course.endSlot)
      .map((course) => ({
        userId,
        term,
        courseName: course.courseName,
        teacher: course.teacher,
        location: course.location,
        weekday: course.weekday,
        startSlot: course.startSlot,
        endSlot: course.endSlot,
      }));

    const dropped = fetched.length - cleaned.length;
    if (dropped > 0) {
      this.logger.warn(`教务课表有 ${dropped} 条脏数据（节次非法）已被丢弃，term=${term}`);
    }

    const imported = await this.repo.replaceTerm(userId, term, cleaned);
    const conflicts = findConflicts(
      cleaned.map((course, index) => ({ id: `imported-${index}`, ...course })),
    );

    return {
      term,
      termLabel: termLabel(term),
      imported,
      conflicts,
      simulated: this.campusData.mode === 'mock',
      syncedAt: this.clock().toISOString(),
    };
  }
}

/* ---------------- 内部工具 ---------------- */

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOT;
}

function assertSlotRange(startSlot: number, endSlot: number): void {
  if (!isValidSlot(startSlot) || !isValidSlot(endSlot)) {
    throw new ValidationError(`节次必须是 1..${MAX_SLOT} 的整数`, { startSlot, endSlot });
  }
  if (startSlot > endSlot) {
    throw new ValidationError('开始节次不能晚于结束节次', { startSlot, endSlot });
  }
}

function toView(course: ScheduleCourseModel): ScheduleCourseView {
  return {
    id: course.id,
    courseName: course.courseName,
    teacher: course.teacher,
    location: course.location,
    weekday: course.weekday,
    startSlot: course.startSlot,
    endSlot: course.endSlot,
    timeLabel: slotRangeLabel(course.startSlot, course.endSlot),
    slotLabel: `第 ${course.startSlot}-${course.endSlot} 节`,
  };
}

function formatDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
