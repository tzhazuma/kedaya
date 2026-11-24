/// 心理支持热线兜底常量。
///
/// 契约 §9：危机干预出口必须**首屏可见、且不依赖任何接口**。
/// 因此这里的文案与号码是编译期常量，页面直接渲染 —— 网络失败、本机数据
/// 解析失败、甚至同意门还没通过时，它都不会消失。
///
/// ⚠️ 号码是**占位示例**：上线前必须由学校心理中心提供真实号码，
/// 并逐个拨通核实。客户端不猜测、不拼接真实号码。
library;

/// 首屏热线卡的固定文案。
const String wellbeingCrisisHeadline = '如果你现在有伤害自己的想法，请立刻联系';

/// 号码上线前必须完成的核实动作。
const String wellbeingCrisisVerifyNote = '上线前必须逐个拨通核实';

/// 首屏号码的完整展示文案（占位号码，上线前必须替换并逐个拨通核实）。
const String wellbeingCrisisPhoneLabel = '校园心理中心 021-XXXXXXXX（示例）';

/// 占位号码的说明（页面同时展示在号码下方）。
const String wellbeingCrisisDemoNote = '示例号码，当前无法真实拨通；上线前必须逐个拨通核实';

/// 一条热线联系方式。
final class WellbeingCrisisContact {
  const WellbeingCrisisContact({
    required this.name,
    required this.phone,
    required this.note,
  });

  final String name;
  final String phone;
  final String note;

  /// 例：`校园心理中心 021-XXXXXXXX（示例）`。
  String get displayLabel => '$name $phone（示例）';
}

/// 兜底热线：即使所有数据源都失败，也必须渲染这一条。
const WellbeingCrisisContact wellbeingCrisisFallback = WellbeingCrisisContact(
  name: '校园心理中心',
  phone: '021-XXXXXXXX',
  note: wellbeingCrisisDemoNote,
);
