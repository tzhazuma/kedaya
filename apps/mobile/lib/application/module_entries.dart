import '../domain/models/kedaya_module.dart';

/// 模块目录的**展示与跳转**策略。
///
/// 契约注册表（`kedayaModules`）是三端共享的冻结镜像，描述"系统有哪些能力域"；
/// 本文件描述"用户在 App 里点哪里"。两者分离，才能在不改契约的前提下
/// 调整信息架构（例如把某个模块的能力并入已有页面）。

/// 已有真实页面的模块：模块 id → 落地路由。
///
/// 未列出的模块仍然只有如实说明页（`/module/:id`），没有假页面、没有假成功。
const Map<String, String> moduleEntryRoutes = <String, String>{
  'groupbuy': '/groupbuy',
  'buddy': '/buddy',
  'forum': '/forum',
  'faq': '/faq',
  'wildlife': '/wildlife',
  'techpie': '/campus-services',
  'campus-card': '/campus-card',
  'teabreak': '/teabreak',
  'activities': '/activities',
  'zhishu': '/zhishu',
  'notifications': '/notifications',
  'takeout-guard': '/takeout-guard',
  'lost-found': '/lost-found',
  'flea-market': '/flea-market',
  'errand': '/errand',
  'dorm-harmony': '/dorm-harmony',
  'schedule': '/schedule',
  'deadlines': '/deadlines',
  'canteen': '/canteen',
  'campus-map': '/campus-map',
  'facility': '/facility',
  'petition': '/petition',
  'wellbeing': '/wellbeing',
  'ai-portrait': '/ai-portrait',
};

/// 能力已并入其它入口、因此**不再单独占一个模块格子**的模块 id。
///
/// `techpie`（校园整合）的四个能力分别落在：校园系统直连 → 校园服务页，
/// 校园卡 → 校园卡模块，绑定管理与能力清单 → 我的页。路由本身保留，
/// 只是不再让用户面对一个叫"TechPie"的入口。
const Set<String> mergedModuleIds = <String>{'techpie'};

/// 目录里实际展示的模块（保持契约顺序，只过滤已合并项）。
List<KedayaModule> directoryModules(Iterable<KedayaModule> modules) => modules
    .where((KedayaModule m) => !mergedModuleIds.contains(m.id))
    .toList(growable: false);

/// 该模块是否已有真实页面（决定卡片角标与点击行为）。
bool moduleHasRealPage(String moduleId) =>
    moduleEntryRoutes.containsKey(moduleId);

/// 点击模块卡片后的去向：有真实页面就**直达**，否则去如实说明页。
String moduleEntryLocation(String moduleId) =>
    moduleEntryRoutes[moduleId] ?? '/module/$moduleId';
