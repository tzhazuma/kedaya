/// 可达鸭模块注册表（Dart 侧镜像，冻结契约 §4）。
///
/// 真相来源：`packages/contracts/src/modules.ts`。导航、宫格、权限判定、路由前缀
/// 全部由本表驱动 —— **禁止在 widget 里硬编码模块清单**。
/// 两边一致性由 `test/domain/module_registry_test.dart` 断言（21 个模块、id 唯一、
/// route == id、同意门规则与 `modules.test.ts` 相同）。
library;

/// 敏感级：high / critical 必须走独立权限域 + 审计（契约 §9）。
enum ModuleSensitivity {
  low('low'),
  medium('medium'),
  high('high'),
  critical('critical');

  const ModuleSensitivity(this.wire);

  final String wire;

  bool get isSensitive =>
      this == ModuleSensitivity.high || this == ModuleSensitivity.critical;

  static ModuleSensitivity fromWire(String wire) {
    for (final ModuleSensitivity value in ModuleSensitivity.values) {
      if (value.wire == wire) return value;
    }
    return ModuleSensitivity.low;
  }
}

enum ModuleCategory {
  business('business'),
  core('core');

  const ModuleCategory(this.wire);

  final String wire;

  static ModuleCategory fromWire(String wire) {
    for (final ModuleCategory value in ModuleCategory.values) {
      if (value.wire == wire) return value;
    }
    return ModuleCategory.business;
  }
}

/// 一个模块的冻结元数据。
final class KedayaModule {
  const KedayaModule({
    required this.id,
    required this.nameZh,
    required this.nameEn,
    required this.summary,
    required this.category,
    required this.sensitivity,
    required this.requiresConsent,
    required this.route,
  });

  /// 冻结的模块 key，同时是 API 路由段。
  final String id;

  final String nameZh;
  final String nameEn;
  final String summary;
  final ModuleCategory category;
  final ModuleSensitivity sensitivity;

  /// 是否必须二次同意才能进入（契约 §9）。
  final bool requiresConsent;

  /// API 路由前缀（不含 `/api/v1`）。
  final String route;

  /// 生成 API 路径，例: `path(['items', '123']) -> 'groupbuy/items/123'`。
  String path([Iterable<Object> segments = const <Object>[]]) => <String>[
        route,
        ...segments.map((Object segment) => '$segment')
      ].join('/');

  @override
  String toString() => 'KedayaModule($id, ${sensitivity.wire})';
}

/* ------------------------------------------------------------------ *
 * 14 个业务模块（来自需求图）
 * ------------------------------------------------------------------ */
const List<KedayaModule> businessModules = <KedayaModule>[
  KedayaModule(
    id: 'groupbuy',
    nameZh: '拼单',
    nameEn: 'Group Buy',
    summary: '拼团凑单：发起、参团、成团、结算',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'groupbuy',
  ),
  KedayaModule(
    id: 'takeout-guard',
    nameZh: '偷外卖',
    nameEn: 'Takeout Guard',
    summary: '外卖被拿错的举报、举证、协商与信用记录',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'takeout-guard',
  ),
  KedayaModule(
    id: 'flea-market',
    nameZh: '跳蚤',
    nameEn: 'Flea Market',
    summary: '二手闲置发布、搜索、议价与面交',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'flea-market',
  ),
  KedayaModule(
    id: 'dorm-harmony',
    nameZh: '宿舍矛盾',
    nameEn: 'Dorm Harmony',
    summary: '匿名调解申请、调解员介入与宿舍公约投票',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.high,
    requiresConsent: true,
    route: 'dorm-harmony',
  ),
  KedayaModule(
    id: 'errand',
    nameZh: '跑腿',
    nameEn: 'Errand',
    summary: '代取快递、买饭、送件，悬赏与接单',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'errand',
  ),
  KedayaModule(
    id: 'buddy',
    nameZh: '找搭子',
    nameEn: 'Buddy Finder',
    summary: '运动、自习、吃饭、出行的组队匹配',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'buddy',
  ),
  KedayaModule(
    id: 'lost-found',
    nameZh: '失物招领',
    nameEn: 'Lost & Found',
    summary: '丢失登记、拾获登记与双向匹配',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'lost-found',
  ),
  KedayaModule(
    id: 'canteen',
    nameZh: '食堂营养',
    nameEn: 'Canteen Nutrition',
    summary: '菜品营养数据、热量估算与饮食建议',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'canteen',
  ),
  KedayaModule(
    id: 'forum',
    nameZh: '论坛',
    nameEn: 'Forum',
    summary: '版块、主题、回复、举报与治理',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'forum',
  ),
  KedayaModule(
    id: 'ai-portrait',
    nameZh: 'AI 校园画像',
    nameEn: 'AI Portrait',
    summary: '基于用户行为的画像与推荐，可解释、可关闭',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.high,
    requiresConsent: true,
    route: 'ai-portrait',
  ),
  KedayaModule(
    id: 'wellbeing',
    nameZh: '心理治疗',
    nameEn: 'Wellbeing',
    summary: '心理咨询预约、心理测评与危机干预入口',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.critical,
    requiresConsent: true,
    route: 'wellbeing',
  ),
  KedayaModule(
    id: 'faq',
    nameZh: '常见问题',
    nameEn: 'FAQ',
    summary: '知识库与工单式自助答疑',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'faq',
  ),
  KedayaModule(
    id: 'techpie',
    nameZh: 'TechPie 整合',
    nameEn: 'TechPie Bridge',
    summary: '与 TechPie / GeekPie 体系互联互通',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'techpie',
  ),
  KedayaModule(
    id: 'wildlife',
    nameZh: '野生动物',
    nameEn: 'Campus Wildlife',
    summary: '野生居民档案：物种与个体、校园活动地图、投喂规范与观测上报',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'wildlife',
  ),
  KedayaModule(
    id: 'facility',
    nameZh: '场馆预约',
    nameEn: 'Facility Booking',
    summary: '体育场馆、健身房等校园场馆的预约与核销',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'facility',
  ),
  // 第 17 个业务模块（契约 `businessModules` 的最后一条；Dart 镜像目前还不含
  // `petition` 与 `campus-map`，因此 teabreak 在这里落在 `facility` 之后）。
  KedayaModule(
    id: 'teabreak',
    nameZh: '会议茶歇',
    nameEn: 'Conference Tea Breaks',
    summary: '把手边学术会议的时间地点和茶歇时报上来，别让点心凉在会议室里',
    category: ModuleCategory.business,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'teabreak',
  ),
];

/* ------------------------------------------------------------------ *
 * 6 个基础模块（第 6 个是 2026-10-19 新增的 deadlines，与契约同序）
 * ------------------------------------------------------------------ */
const List<KedayaModule> coreModules = <KedayaModule>[
  KedayaModule(
    id: 'auth',
    nameZh: '身份',
    nameEn: 'Auth',
    summary: '上科大统一身份认证与第三方校园系统绑定',
    category: ModuleCategory.core,
    sensitivity: ModuleSensitivity.high,
    requiresConsent: false,
    route: 'auth',
  ),
  KedayaModule(
    id: 'schedule',
    nameZh: '课表',
    nameEn: 'Schedule',
    summary: '学期、课程表与考试安排',
    category: ModuleCategory.core,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'schedule',
  ),
  // DDL 聚合（第 21 个模块，2026-10-19 加入，逐字镜像契约 `modules.ts`）。
  // 归入 core：与 `schedule` 同属学业基础设施；medium 因为条目能反推在修哪些课，
  // 但不含成绩、答案与平台凭据。本轮**没有**对应的后端模块。
  KedayaModule(
    id: 'deadlines',
    nameZh: 'DDL 聚合',
    nameEn: 'Deadlines',
    summary:
        '把散在 Blackboard / Gradescope / Piazza / e云平台的作业与考试截止日期聚到一处，按紧迫度排序并保留回源链接',
    category: ModuleCategory.core,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'deadlines',
  ),
  KedayaModule(
    id: 'campus-card',
    nameZh: '校园卡',
    nameEn: 'Campus Card',
    summary: '余额、流水与付款码',
    category: ModuleCategory.core,
    sensitivity: ModuleSensitivity.high,
    requiresConsent: false,
    route: 'campus-card',
  ),
  KedayaModule(
    id: 'profile',
    nameZh: '我的',
    nameEn: 'Profile',
    summary: '资料、设置与隐私开关',
    category: ModuleCategory.core,
    sensitivity: ModuleSensitivity.medium,
    requiresConsent: false,
    route: 'profile',
  ),
  KedayaModule(
    id: 'notifications',
    nameZh: '通知',
    nameEn: 'Notifications',
    summary: '站内信、订阅消息（小程序）与推送',
    category: ModuleCategory.core,
    sensitivity: ModuleSensitivity.low,
    requiresConsent: false,
    route: 'notifications',
  ),
];

/* ------------------------------------------------------------------ *
 * 派生
 * ------------------------------------------------------------------ */

/// 与 `modules.ts` 的 `MODULES` 同序：core 在前，business 在后。
const List<KedayaModule> kedayaModules = <KedayaModule>[
  ...coreModules,
  ...businessModules,
];

final Map<String, KedayaModule> _byId = <String, KedayaModule>{
  for (final KedayaModule module in kedayaModules) module.id: module,
};

KedayaModule? moduleById(String id) => _byId[id];

/// 需要二次同意的模块（契约 §9）。注意 `auth` / `campus-card` 虽然是 high，
/// 但**不设同意门** —— 登录/开卡这个行为本身就是同意。
List<KedayaModule> consentModules() => kedayaModules
    .where((KedayaModule module) => module.requiresConsent)
    .toList(growable: false);

/// 高敏感模块（high + critical）。
List<KedayaModule> sensitiveModules() => kedayaModules
    .where((KedayaModule module) => module.sensitivity.isSensitive)
    .toList(
      growable: false,
    );

/// 未注册的 id 返回 false（与 `requiresConsent()` 的 TS 实现一致）。
bool moduleRequiresConsent(String id) => _byId[id]?.requiresConsent ?? false;

bool moduleIsSensitive(String id) =>
    _byId[id]?.sensitivity.isSensitive ?? false;

/// 生成 API 路径，例: `modulePath('groupbuy', 'items', '123') -> 'groupbuy/items/123'`。
String modulePath(String id, [Iterable<Object> segments = const <Object>[]]) {
  final KedayaModule? module = _byId[id];
  final String base = module?.route ?? id;
  return <String>[base, ...segments.map((Object segment) => '$segment')]
      .join('/');
}
