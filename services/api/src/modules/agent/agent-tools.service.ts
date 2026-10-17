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
import { CampusCardTransactionService } from '../campus-card/campus-card.service';
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

@Injectable()
export class AgentToolsService {
  constructor(
    private readonly schedule: ScheduleCourseService,
    private readonly campusCard: CampusCardTransactionService,
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
      description: '查校园卡余额、最近消费、还能撑几天、疑似异常扣款',
      requiresAuth: true,
      keywords: ['余额', '校园卡', '卡里', '花了', '消费', '充值', '还能撑', '钱', '扣款', '挂失', '丢了'],
      run: async (context) => {
        if (context.userId === null) return this.needLogin('查校园卡');

        let overview;
        try {
          overview = await this.campusCard.overview(context.userId);
        } catch (error) {
          if (error instanceof CampusBindingRequiredError) {
            return {
              facts: [
                {
                  tool: 'card.overview',
                  label: '校园卡',
                  value: '你还没有绑定校园卡系统，所以我还看不到余额。绑定后就能查了。',
                },
              ],
              actions: [navigate('去绑定校园卡', MINIAPP_PAGES.identity)],
            };
          }
          if (error instanceof UpstreamUnavailableError) {
            return {
              facts: [
                {
                  tool: 'card.overview',
                  label: '校园卡',
                  value: '校园卡系统暂时不可用，而且本地还没有可用缓存。请稍后重试，我不会瞎猜一个余额给你。',
                },
              ],
              actions: [navigate('打开校园卡页面', MINIAPP_PAGES.campusCard)],
            };
          }
          throw error;
        }

        // 高敏感读取落审计（与页面访问同口径）
        await this.audit.recordQuietly({
          actorId: context.userId,
          action: 'agent.tool.card-overview',
          resource: 'CampusCardTransaction',
          module: 'campus-card',
          metadata: { stale: overview.stale },
        });

        const facts: AgentFact[] = [
          {
            tool: 'card.overview',
            label: '余额',
            value:
              `${formatYuan(overview.balanceFen)}` +
              (overview.lowBalance ? '（已低于提醒阈值，建议尽快充值）' : '') +
              (overview.insight.estimatedDaysLeft === null
                ? ''
                : `，按最近 7 天消费大概还能撑 ${overview.insight.estimatedDaysLeft} 天`),
            simulated: overview.simulated,
          },
          {
            tool: 'card.overview',
            label: '今日消费',
            value:
              overview.insight.todayOutCount === 0
                ? '今天还没有消费记录'
                : `${formatYuan(overview.insight.todayOutFen)}（${overview.insight.todayOutCount} 笔）`,
          },
        ];

        if (overview.insight.anomalies.length > 0) {
          facts.push({
            tool: 'card.overview',
            label: '疑似异常扣款',
            value: overview.insight.anomalies
              .map((item) => `${item.merchant} ${formatYuan(item.amountFen)}（约日常的 ${item.ratioToMedian} 倍）`)
              .join('；'),
          });
        }

        const notice = overview.stale
          ? '校园卡系统当前不可用，以上是上一次成功同步的数据，可能不是最新。'
          : undefined;

        return {
          facts,
          actions: [navigate('打开校园卡', MINIAPP_PAGES.campusCard)],
          ...(notice === undefined ? {} : { notice }),
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
