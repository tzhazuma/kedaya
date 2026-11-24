/// 校园服务直达（`campus-services`，非契约模块，techpie 的扩展页）。
///
/// 这里只放**公开入口 URL**，不处理任何 cookie：登录发生在内嵌浏览器的
/// 校园页面上，由学校系统自己维持会话。这样「E云课堂 / 请假 / 活动 / 录播」
/// 都能用，而本机不接触任何校园凭据。
library;

enum CampusServiceGroup {
  study('学习'),
  affairs('办事'),
  activity('活动');

  const CampusServiceGroup(this.label);

  final String label;
}

/// 一条校园服务入口。
final class CampusService {
  const CampusService({
    required this.id,
    required this.name,
    required this.url,
    required this.group,
    required this.description,
    required this.requiresLogin,
  });

  final String id;
  final String name;
  final String url;
  final CampusServiceGroup group;
  final String description;

  /// 打开后是否需要先登录（登录由校园系统自己完成，本机不代持）。
  final bool requiresLogin;
}

/// URL 来源：2026-11-24 从 TechPie 的 `lib/services` 与 `lib/pages` 中提取，
/// 均为学校公开域名；没有把任何 token / cookie / 内部参数写进来。
const List<CampusService> campusServices = <CampusService>[
  CampusService(
    id: 'elearning',
    name: 'E云课堂',
    url: 'https://elearning.shanghaitech.edu.cn:8443/',
    group: CampusServiceGroup.study,
    description: 'Blackboard 课程站点、课件与作业',
    requiresLogin: true,
  ),
  CampusService(
    id: 'elrc',
    name: '课程录播（ELRC）',
    url: 'https://elrc.shanghaitech.edu.cn/learn/videoreview?type=1',
    group: CampusServiceGroup.study,
    description: '按课程查看录播回放',
    requiresLogin: true,
  ),
  CampusService(
    id: 'eams',
    name: '教务系统（EAMS）',
    url: 'https://eams.shanghaitech.edu.cn/eams/home.action',
    group: CampusServiceGroup.study,
    description: '选课、成绩、考试安排',
    requiresLogin: true,
  ),
  CampusService(
    id: 'leave',
    name: '学生请假',
    url: 'https://egate.shanghaitech.edu.cn/',
    group: CampusServiceGroup.affairs,
    description: '一站式服务大厅（请假、证明等）',
    requiresLogin: true,
  ),
  CampusService(
    id: 'facility',
    name: '场馆空闲（OA）',
    url: 'https://oa.shanghaitech.edu.cn/wui/main.jsp?templateId=1',
    group: CampusServiceGroup.affairs,
    description: '羽毛球 / 乒乓球 / 网球 / 匹克球真实空闲',
    requiresLogin: true,
  ),
  CampusService(
    id: 'activity',
    name: '学生活动',
    url: 'https://egate.shanghaitech.edu.cn/',
    group: CampusServiceGroup.activity,
    description: '活动报名与签到（扫码在活动页内完成）',
    requiresLogin: true,
  ),
];

/// 按分组取服务；组内保持声明顺序。
Map<CampusServiceGroup, List<CampusService>> groupCampusServices(
  List<CampusService> services,
) {
  final Map<CampusServiceGroup, List<CampusService>> grouped =
      <CampusServiceGroup, List<CampusService>>{};
  for (final CampusServiceGroup group in CampusServiceGroup.values) {
    final List<CampusService> items = services
        .where((CampusService s) => s.group == group)
        .toList(growable: false);
    if (items.isNotEmpty) grouped[group] = items;
  }
  return grouped;
}

/// 打开失败时的降级文案（不假装成功）。
String campusServiceFallbackMessage(CampusService service) =>
    '本机不支持内嵌浏览器，已复制「${service.name}」链接，可粘贴到浏览器打开';
