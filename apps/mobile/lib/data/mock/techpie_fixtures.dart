/// techpie / campus-card 的 mock 数据（契约 §7 硬规则 4：无后端可跑）。
///
/// 全部为**元数据**：没有任何 cookie / 会话串 / 明文口令。
/// 票据与付款码这类短时效凭据**不进 fixture** —— 它们由 mock 仓库在调用时现场生成。
library;

import '../../domain/models/campus_capability.dart';
import '../../domain/models/campus_card.dart';
import '../../domain/models/techpie_link.dart';
import 'mock_fixtures.dart';

/// mock 校园卡的 OPENID 尾巴（脱敏值，不是真 OPENID）。
const String mockCampusCardOpenIdTail = '****a1b2';

/// 已存在的两条绑定：`cpdaily` 可用、`egate` 已过期（覆盖两种不同引导）。
///
/// 刻意**不含 `ecard`**：校园卡走独立 OPENID 通道，它出现在
/// `CampusCardPort.linkStatus()` 里，而不是 techpie 的绑定列表里。
final List<TechpieLink> mockTechpieLinks = <TechpieLink>[
  TechpieLink(
    id: 'tp-1001',
    summary: CampusBindingSummary(
      platform: CampusPlatform.cpdaily,
      status: CampusBindingStatus.linked,
      externalUserId: '20240001',
      expiresAt: mockNow.add(const Duration(days: 30)),
      lastSyncAt: mockNow,
    ),
  ),
  TechpieLink(
    id: 'tp-1002',
    summary: CampusBindingSummary(
      platform: CampusPlatform.egate,
      status: CampusBindingStatus.expired,
      externalUserId: '20240001',
      expiresAt: mockNow.subtract(const Duration(days: 1)),
      lastSyncAt: mockNow.subtract(const Duration(days: 2)),
    ),
  ),
];

/// 能力目录（**逐字镜像 `services/api` 的 `TECHPIE_CAPABILITIES`**）。
///
/// ⚠️ 为什么镜像而不是自造 id：客户端的"服务端状态覆盖"是**按 id 匹配**的
/// （`campusCapabilitiesProvider` 用服务端返回的 `status` 覆盖本目录的状态）。
/// 两边的 id 一旦不一致，覆盖就会静默失效 —— 因此这里的 13 条 id 与
/// `services/api/src/modules/techpie/domain/capabilities.ts` 完全一致，
/// 改一处必须改两处。
///
/// Phase 0 的 `state` 只是占位（`UNKNOWN` = "服务端没给结论"），
/// 真实状态由 `resolveCampusCapabilities` 按绑定情况算出来；
/// Phase 1–2 一律 `notImplemented`，且**任何**解析都不会把它变成"可用"。
const List<CampusCapability> mockCampusCapabilityCatalog = <CampusCapability>[
  CampusCapability(
    id: 'ecard.balance',
    title: '校园卡余额',
    description: '余额查询（独立 OPENID 通道，与校园会话代持无关）。',
    phase: CampusCapabilityPhase.phase0,
    platform: CampusPlatform.ecard,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'ecard.transactions',
    title: '校园卡流水',
    description: '消费与充值记录（整数分金额）。',
    phase: CampusCapabilityPhase.phase0,
    platform: CampusPlatform.ecard,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'ecard.payment_code',
    title: '校园卡付款码',
    description: '短时效支付凭据；不缓存、不落盘。',
    phase: CampusCapabilityPhase.phase0,
    platform: CampusPlatform.ecard,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'webview.ecourse',
    title: 'E云课堂',
    description: '课程资料与回放；用户自己登录（W4 直连，不注入会话）。',
    phase: CampusCapabilityPhase.phase0,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'webview.student_leave',
    title: '学生请假',
    description: '请假申请与审批进度；用户自己登录。',
    phase: CampusCapabilityPhase.phase0,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'webview.student_activity',
    title: '学生活动',
    description: '活动报名与签到；用户自己登录。',
    phase: CampusCapabilityPhase.phase0,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'webview.elrc',
    title: '课程录播（ELRC）',
    description: '录播回看（纯外链，无任何会话注入）。',
    phase: CampusCapabilityPhase.phase0,
    state: CampusCapabilityState.unknown,
  ),
  CampusCapability(
    id: 'schedule.courses',
    title: '课程表',
    description: '学期与课程表（需要结构化调用 CpDaily）。',
    phase: CampusCapabilityPhase.phase1,
    platform: CampusPlatform.cpdaily,
    state: CampusCapabilityState.notImplemented,
  ),
  CampusCapability(
    id: 'schedule.exams',
    title: '考试表',
    description: '考试安排（与课表同一会话）。',
    phase: CampusCapabilityPhase.phase1,
    platform: CampusPlatform.cpdaily,
    state: CampusCapabilityState.notImplemented,
  ),
  CampusCapability(
    id: 'schedule.deadlines',
    title: 'DDL 聚合',
    description: 'Blackboard / 考试 / Gradescope / Hydro 的截止日期聚合。',
    phase: CampusCapabilityPhase.phase1,
    platform: CampusPlatform.cpdaily,
    state: CampusCapabilityState.notImplemented,
  ),
  CampusCapability(
    id: 'auth.school_cas',
    title: '学校统一身份认证直连',
    description: '一级身份直接对接学校 CAS（阻塞于信息办，未获批）。',
    phase: CampusCapabilityPhase.phase1,
    platform: CampusPlatform.cas,
    state: CampusCapabilityState.notImplemented,
  ),
  CampusCapability(
    id: 'facility.reservation',
    title: '场馆预约',
    description: '体育场馆预约（需要学校 OA 会话）。',
    phase: CampusCapabilityPhase.phase2,
    platform: CampusPlatform.cpdaily,
    state: CampusCapabilityState.notImplemented,
  ),
  CampusCapability(
    id: 'techpie.auto_renew',
    title: '会话自动续期',
    description: '后台自动续期校园会话（依赖 GeekPie / HeZeBang 确认续期接口）。',
    phase: CampusCapabilityPhase.phase2,
    platform: CampusPlatform.techpie,
    state: CampusCapabilityState.notImplemented,
  ),
];

/// 校园卡账户（mock）。
final CampusCardAccount mockCampusCardAccount = CampusCardAccount(
  holderName: '可达鸭测试账号',
  cardNumberMasked: '**** **** **** 1234',
  balanceFen: 32860,
  updatedAt: mockNow,
);

/// 校园卡流水（mock）：支出与充值各两笔，覆盖两个方向。
final List<CampusCardTransaction> mockCampusCardTransactions =
    <CampusCardTransaction>[
  CampusCardTransaction(
    id: 'cc-2001',
    merchant: '一食堂',
    amountFen: 1580,
    direction: CampusCardTransactionDirection.debit,
    occurredAt: mockNow.subtract(const Duration(hours: 3)),
    balanceAfterFen: 32860,
  ),
  CampusCardTransaction(
    id: 'cc-2002',
    merchant: '图书馆自助打印',
    amountFen: 60,
    direction: CampusCardTransactionDirection.debit,
    occurredAt: mockNow.subtract(const Duration(days: 1)),
    balanceAfterFen: 34440,
  ),
  CampusCardTransaction(
    id: 'cc-2003',
    merchant: '校园卡在线充值',
    amountFen: 20000,
    direction: CampusCardTransactionDirection.credit,
    occurredAt: mockNow.subtract(const Duration(days: 3)),
    balanceAfterFen: 34500,
  ),
  CampusCardTransaction(
    id: 'cc-2004',
    merchant: '二食堂',
    amountFen: 1320,
    direction: CampusCardTransactionDirection.debit,
    occurredAt: mockNow.subtract(const Duration(days: 4)),
    balanceAfterFen: 14500,
  ),
];
