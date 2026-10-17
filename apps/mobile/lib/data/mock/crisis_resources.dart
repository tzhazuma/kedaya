import '../../domain/models/wellbeing_appointment.dart';

/// 内置危机干预资源（契约 §9：`wellbeing` 必须提供危机干预热线出口，
/// 且**不可被埋进二级菜单**）。
///
/// ⚠️ **数据责任**：这里的号码是**示例数据**，上线前必须由学校心理健康中心
/// 提供并替换（见 `apps/mobile/README.md` 的"上线前必须替换"清单）。
/// 之所以内置一份：危机出口不允许因为网络失败而消失 —— 实现会先返回内置资源，
/// 再用服务端资源覆盖。
const List<CrisisResource> builtInCrisisResources = <CrisisResource>[
  CrisisResource(
    name: '示例 · 校园心理支持热线',
    phone: '021-0000-0000',
    description: '示例数据，非真实号码；上线前由学校心理健康中心提供并替换',
    availability: '工作日 8:30-17:00',
  ),
  CrisisResource(
    name: '示例 · 全国心理援助热线',
    phone: '12356',
    description: '公开号码，接入前请再核实；示例数据，需学校确认后启用',
    availability: '7x24',
  ),
];
