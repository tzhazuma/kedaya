/**
 * 工具注册表（agent 的"手和眼"）。
 *
 * 每个工具都是**受权限约束的实时取数**：它拿到的 `context.userId` 就是
 * 调用者本人（守卫已经在控制器层校验过 token），工具内部再走各模块**自己的**
 * 用例层（`ScheduleCourseService` / `CampusCardTransactionService` …）——
 * 也就是说 agent **不越过任何模块的领域规则**，它只是这些用例的另一个调用方。
 *
 * 三条硬规则：
 *   1. 需要登录的工具在未登录时**明确拒答 + 引导登录**，绝不用别人的数据兜底；
 *   2. 上游失败（未绑定 / 上游不可用）**当成一等公民**处理：返回一句人话 +
 *      一个可点击的下一步，而不是把异常抛给用户；
 *   3. 读取高敏感数据（实名 / 校园卡）时**写审计**，与页面访问同一套口径。
 */

import { Inject, Injectable } from '@nestjs/common';
import { MINIAPP_PAGES } from '@kedaya/contracts';
import { AuditService } from '../../common/compliance/audit.service';
import { CampusBindingRequiredError, UpstreamUnavailableError } from '../../common/errors/app-error';
import { CampusIdentityService } from '../auth/campus-identity.service';
import { CAMPUS_DATA_PORT, type CampusDataPort } from '../auth/domain/campus-data.domain';
import { CampusCardService } from '../campus-card/campus-card.service';
import type { CampusCardAccount } from '../campus-card/domain/campus-card.domain';
import { ProfileSettingService } from '../profile/profile.service';
import { ScheduleCourseService } from '../schedule/schedule.service';
import type {
  AgentAction,
  AgentFact,
  AgentTool,
  AgentToolResult,
} from './domain/agent.domain';

function formatYuan(fen: number): string {
  return `¥${(fen / 100).toFixed(2)}`;
}

/**
 * 观测时刻 → 用户可读的「MM-DD HH:mm」（**固定东八区**：校园在北京时间）。
 * 格式化失败时退回原始串 —— 宁可显示得难看，也不显示错的或空白。
 */
function formatMoment(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
  } catch {
    return iso;
  }
}

@Injectable()
export class AgentToolsService {
  constructor(
    private readonly schedule: ScheduleCourseService,
    private readonly campusCard: CampusCardService,
    private readonly identity: CampusIdentityService,
    private readonly profile: ProfileSettingService,
    private readonly audit: AuditService,
    @Inject(CAMPUS_DATA_PORT) private readonly campusData: CampusDataPort,
  ) {}

  /** 全部工具（顺序即规则路由的优先级） */
  tools(): AgentTool[] {
    return [
      this.scheduleNextTool(),
      this.scheduleTodayTool(),
      this.cardOverviewTool(),
      this.profileConsentTool(),
      this.identityTool(),
      this.accountGuideTool(),
    ];
  }

  /** 按关键词命中工具（规则路由用；不做模糊匹配，避免"答非所问"） */
  matchTools(question: string, limit = 2): AgentTool[] {
    const normalized = question.toLowerCase();
    const hits = this.tools().filter((tool) =>
      tool.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
    );
    return hits.slice(0, limit);
  }

  /* ================================================================ *
   * 课表
   * ================================================================ */

  private scheduleNextTool(): AgentTool {
    return {
      name: 'schedule.next',
      description: '查下一节课：课程名、时间、地点、还有多久开始',
      requiresAuth: true,
      keywords: ['下一节', '下节课', '接下来', '还有多久', '几点上课', '几点有课', '马上'],
      run: async (context) => {
        if (context.userId === null) return this.needLogin('查课表');
        const result = await this.schedule.nextClass(context.userId);
        const facts: AgentFact[] = [];

        if (result.ongoing.length > 0) {
          facts.push({
            tool: 'schedule.next',
            label: '正在上课',
            value: result.ongoing
              .map((course) => `${course.courseName}（${course.timeLabel}${place(course.location)}）`)
              .join('；'),
          });
        }

        if (result.next !== null) {
          const minutes = result.minutesUntilNext ?? 0;
          facts.push({
            tool: 'schedule.next',
            label: '下一节课',
            value:
              `${result.next.courseName} · ${result.next.timeLabel}` +
              `${place(result.next.location)}` +
              (minutes > 0 ? `，${minutes} 分钟后开始` : '，即将开始'),
            simulated: this.isSimulated(),
          });
        } else if (result.ongoing.length === 0) {
          facts.push({
            tool: 'schedule.next',
            label: '今天的课',
            value: '今天已经没有排课了',
          });
        }

        return { facts, actions: [navigate('打开课表', MINIAPP_PAGES.schedule)] };
      },
    };
  }

  private scheduleTodayTool(): AgentTool {
    return {
      name: 'schedule.today',
      description: '查今天的全部课程与上课地点',
      requiresAuth: true,
      keywords: ['课表', '有课', '上课', '今天', '教室', '在哪上', '课程'],
      run: async (context) => {
        if (context.userId === null) return this.needLogin('查课表');
        const today = await this.schedule.today(context.userId);
        const simulated = today.simulated;

        if (today.empty) {
          return {
            facts: [
              {
                tool: 'schedule.today',
                label: '今日课表',
                value: `今天（${today.weekdayLabel}）没有课。如果这不对，可能是还没同步课表。`,
                simulated,
              },
            ],
            actions: [navigate('去同步课表', MINIAPP_PAGES.schedule)],
          };
        }

        const value = today.courses
          .map((course) => `${course.timeLabel} ${course.courseName}${place(course.location)}`)
          .join('；');

        return {
          facts: [
            {
              tool: 'schedule.today',
              label: `今日课表（${today.weekdayLabel}，共 ${today.courses.length} 节）`,
              value,
              simulated,
            },
            ...(today.conflicts.length > 0
              ? [
                  {
                    tool: 'schedule.today',
                    label: '注意：时间冲突',
                    value: today.conflicts
                      .map((conflict) => `${conflict.a.courseName} 与 ${conflict.b.courseName}`)
                      .join('；'),
                  },
                ]
              : []),
          ],
          actions: [navigate('打开课表', MINIAPP_PAGES.schedule)],
        };
      },
    };
  }

  /* ================================================================ *
   * 校园卡
   * ================================================================ */

  private cardOverviewTool(): AgentTool {
    return {
      name: 'card.overview',
      description: '查校园卡余额（取自最近一次成功同步的账单）',
      requiresAuth: true,
      keywords: ['余额', '校园卡', '卡里', '花了', '消费', '充值', '还能撑', '钱', '扣款', '挂失', '丢了'],
      run: async (context) => {
        if (context.userId === null) return this.needLogin('查校园卡');

        // ⚠️ 只报契约 §11.21-B 里**真实存在**的字段：`account` 给的是
        // 「最近一条流水的 balanceAfterFen」。契约没有消费画像 / 异常扣款，
        // 这里就**不编**「还能撑几天」这种看起来具体、其实是猜的数字。
        //
        // ⚠️ 没有任何流水时 `account` 也会给 `balanceFen: 0` —— 那是"读不到余额"，
        // 不是"卡里没钱"。硬报 ¥0.00 会让用户以为钱没了，所以这里只承认查不到。
        let account: CampusCardAccount;
        try {
          account = await this.campusCard.account(context.userId);
        } catch (error) {
          if (error instanceof CampusBindingRequiredError) {
            return {
              facts: [
                {
                  tool: 'card.overview',
                  label: '校园卡',
                  value: '你还没有开通校园卡，所以我还看不到余额。开通后就能查了。',
                },
              ],
              actions: [navigate('去开通校园卡', MINIAPP_PAGES.identity)],
            };
          }
          if (error instanceof UpstreamUnavailableError) {
            return {
              facts: [
                {
                  tool: 'card.overview',
                  label: '校园卡',
                  value: '校园卡系统暂时不可用，请稍后重试 —— 我不会瞎猜一个余额给你。',
                },
              ],
              actions: [navigate('打开校园卡', MINIAPP_PAGES.campusCard)],
            };
          }
          throw error;
        }

        // 高敏感读取落审计（与页面访问同口径）
        await this.audit.recordQuietly({
          actorId: context.userId,
          action: 'agent.tool.card-overview',
          resource: 'CampusCard',
          module: 'campus-card',
          metadata: { hasUpdatedAt: account.updatedAt !== undefined },
        });

        const syncedAt =
          account.updatedAt === undefined ? null : formatMoment(account.updatedAt);

        // 没有账单记录 ⇒ 读不到余额（而不是余额为 0）：宁可说查不到
        if (syncedAt === null) {
          return {
            facts: [
              {
                tool: 'card.overview',
                label: '校园卡',
                value: '我这边还没有你的账单记录，所以看不到余额。去校园卡页面看看？',
              },
            ],
            actions: [navigate('打开校园卡', MINIAPP_PAGES.campusCard)],
          };
        }

        return {
          facts: [
            {
              tool: 'card.overview',
              label: '余额',
              value: `${formatYuan(account.balanceFen)}（数据时间 ${syncedAt}）`,
            },
          ],
          actions: [navigate('打开校园卡', MINIAPP_PAGES.campusCard)],
        };
      },
    };
  }

  /* ================================================================ *
   * 隐私 / 同意
   * ================================================================ */

  private profileConsentTool(): AgentTool {
    return {
      name: 'profile.consents',
      description: '查隐私开关与各敏感模块的同意状态（可撤回）',
      requiresAuth: true,
      keywords: ['同意', '授权', '隐私', '画像', '撤回', '导出', '数据', '开关'],
      run: async (context) => {
        if (context.userId === null) return this.needLogin('查看隐私设置');

        const [consents, settings] = await Promise.all([
          this.profile.listConsents(context.userId),
          this.profile.me(context.userId),
        ]);

        const gated = consents.filter((item) => item.gated);
        const active = gated.filter((item) => item.active);

        return {
          facts: [
            {
              tool: 'profile.consents',
              label: '需要单独同意的模块',
              value:
                gated.length === 0
                  ? '当前没有需要二次同意的模块'
                  : `${gated.length} 个，其中已授权 ${active.length} 个：` +
                    gated.map((item) => `${item.nameZh}${item.active ? '（已授权）' : '（未授权）'}`).join('、'),
            },
            {
              tool: 'profile.consents',
              label: '隐私开关',
              value:
                `AI 画像：${settings.allowAiPortrait ? '已开启' : '已关闭'}；` +
                `心理健康：${settings.allowWellbeing ? '已开启' : '已关闭'}；` +
                `宿舍矛盾：${settings.allowDormHarmony ? '已开启' : '已关闭'}；` +
                `实名展示：${settings.showRealName ? '开启' : '关闭'}`,
            },
          ],
          actions: [navigate('打开隐私与数据', MINIAPP_PAGES.profileSettings)],
        };
      },
    };
  }

  /* ================================================================ *
   * 身份（实名，脱敏）
   * ================================================================ */

  private identityTool(): AgentTool {
    return {
      name: 'identity.view',
      description: '查校园实名身份（默认脱敏）与校园系统绑定状态',
      requiresAuth: true,
      keywords: ['实名', '我是谁', '学号', '姓名', '院系', '身份', '绑定'],
      run: async (context) => {
        if (context.userId === null) return this.needLogin('查看身份信息');

        const facts: AgentFact[] = [];

        try {
          const overview = await this.identity.overview(context.userId);
          const available = overview.platforms.filter((item) => item.available);
          facts.push({
            tool: 'identity.view',
            label: '校园系统绑定',
            value:
              available.length === 0
                ? '还没有绑定任何校园系统，所以查不到课表和校园卡'
                : available.map((item) => platformLabel(item.platform)).join('、'),
            simulated: overview.dataMode === 'mock',
          });
        } catch (error) {
          if (!(error instanceof CampusBindingRequiredError)) throw error;
          facts.push({
            tool: 'identity.view',
            label: '校园系统绑定',
            value: '还没有绑定任何校园系统，去身份页绑定后就能查课表和校园卡了。',
          });
        }

        try {
          // 一律用脱敏视图：agent 的回答可能出现在任何截屏里
          const view = await this.identity.view(context.userId, false);
          facts.push({
            tool: 'identity.view',
            label: '实名信息（已打码）',
            value:
              `${view.identity.realName} · ${view.identity.studentId}` +
              `${view.identity.department === null ? '' : ` · ${view.identity.department}`}`,
            simulated: view.simulated,
          });
        } catch (error) {
          if (error instanceof CampusBindingRequiredError) {
            facts.push({
              tool: 'identity.view',
              label: '实名信息',
              value: '还没绑定统一身份认证（EGATE），绑定后才能显示你的实名信息。',
            });
          } else {
            throw error;
          }
        }

        return {
          facts,
          actions: [navigate('打开身份页面', MINIAPP_PAGES.identity)],
        };
      },
    };
  }

  /**
   * 「账号与登录」指引工具。
   *
   * 注意它**只有指引、没有事实**：登录方式属于产品知识（已在内置指南里），
   * 真正需要判断的"我有没有设密码"由客户端页面呈现（agent 不读凭据表）。
   */
  private accountGuideTool(): AgentTool {
    return {
      name: 'account.guide',
      description: '解释登录方式、绑定邮箱、解绑微信等账号操作怎么走',
      requiresAuth: false,
      keywords: ['登录', '注册', '密码', '邮箱', '微信登录', '绑定邮箱', '解绑', '账号'],
      run: async () => ({
        facts: [],
        actions: [
          navigate('去登录 / 注册', MINIAPP_PAGES.authLogin),
          navigate('绑定邮箱', MINIAPP_PAGES.authBindEmail),
        ],
      }),
    };
  }

  /* ---------------- 共用小工具 ---------------- */

  private needLogin(what: string): AgentToolResult {
    return {
      facts: [
        {
          tool: 'auth.required',
          label: '需要先登录',
          value: `要${what}需要先登录 —— 我不会用别人的数据来回答你。`,
        },
      ],
      actions: [navigate('去登录', MINIAPP_PAGES.authLogin)],
    };
  }

  /** 课表与校园卡共用同一个上游数据模式开关 */
  private isSimulated(): boolean {
    return this.campusData.mode === 'mock';
  }
}

function place(location: string | null): string {
  return location === null || location === '' ? '' : ` @ ${location}`;
}

function navigate(label: string, path: string): AgentAction {
  return { type: 'navigate', label, path };
}

function platformLabel(platform: string): string {
  switch (platform) {
    case 'EGATE':
      return '统一身份认证';
    case 'JWC':
      return '教务系统（课表）';
    case 'CARD':
      return '校园卡系统';
    case 'CPDAILY':
      return '校园日常（通知）';
    default:
      return platform;
  }
}
