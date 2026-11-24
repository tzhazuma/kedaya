/// 一餐的记录（`canteen` 营养管家）。
///
/// 记录只描述**已经吃过的东西**：日期、餐次、条目（菜品 + 份数 + 当餐的
/// 营养快照）与合计营养。营养快照按**一份**保存，展示时再乘份数，
/// 因此修改份数不需要回查菜品库，历史记录也不会因为菜品库改价/改营养而变样。
///
/// 记录保存在本机（`LocalCachePort`），**不上传**。页面文案必须说清这一点，
/// 不能给出「已同步到服务器」的假反馈。
library;

import 'canteen_dish.dart';
import 'json_read.dart';

/// 餐次。顺序即「今日记录」的分组顺序。
enum MealSlot {
  breakfast('breakfast', '早餐'),
  lunch('lunch', '午餐'),
  dinner('dinner', '晚餐'),
  snack('snack', '加餐');

  const MealSlot(this.wire, this.label);

  /// 本地存储里的稳定标识（改显示文案不会让旧记录失效）。
  final String wire;

  final String label;

  /// 按当前时刻猜一个餐次，作为「记一餐」的默认值。
  ///
  /// 只是默认值：用户随时可以改，页面不会因为猜错而限制保存。
  static MealSlot suggestedAt(DateTime time) => switch (time.hour) {
        < 10 => MealSlot.breakfast,
        < 15 => MealSlot.lunch,
        < 21 => MealSlot.dinner,
        _ => MealSlot.snack,
      };

  static MealSlot? fromWire(String wire) {
    final String normalized = wire.trim().toLowerCase();
    for (final MealSlot slot in MealSlot.values) {
      if (slot.wire == normalized) return slot;
    }
    return null;
  }
}

/// 餐次里的一条：菜品 + 份数 + **每份**营养快照。
final class MealEntry {
  const MealEntry({
    required this.dishId,
    required this.dishName,
    required this.servings,
    required this.nutritionPerServing,
  });

  final String dishId;

  /// 保存当时的菜名，菜品库改名或下架都不影响历史记录。
  final String dishName;

  /// 份数，界面以 0.5 为步长（1.5 份 = 一份半）。
  final double servings;

  /// **一份**的营养估算；合计见 [total]。
  final NutritionFacts nutritionPerServing;

  /// 本条合计：每份营养 × 份数，四舍五入到整数。
  NutritionFacts get total => nutritionPerServing.scaled(servings);

  String get servingsLabel => formatCanteenServings(servings);

  Map<String, Object?> toJson() => <String, Object?>{
        'dishId': dishId,
        'dishName': dishName,
        'servings': servings,
        'nutrition': nutritionPerServing.toJson(),
      };

  factory MealEntry.fromJson(Map<String, Object?> json) => MealEntry(
        dishId: readString(json, 'dishId'),
        dishName: readString(json, 'dishName'),
        servings: readDouble(json, 'servings'),
        nutritionPerServing:
            NutritionFacts.fromJson(readMap(json, 'nutrition')),
      );
}

/// 一次「记一餐」保存下来的记录。
final class MealRecord {
  const MealRecord({
    required this.id,
    required this.date,
    required this.slot,
    required this.entries,
  });

  final String id;

  /// 只保留年月日（本地时区）。构造时请用 [canteenDateOnly] 归一。
  final DateTime date;

  final MealSlot slot;
  final List<MealEntry> entries;

  bool get isEmpty => entries.isEmpty;

  /// 合计营养 = 每个条目合计相加。
  NutritionFacts get total => entries.fold(
        NutritionFacts.zero,
        (NutritionFacts sum, MealEntry entry) => sum + entry.total,
      );

  MealRecord copyWith({List<MealEntry>? entries}) => MealRecord(
        id: id,
        date: date,
        slot: slot,
        entries: entries ?? this.entries,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'date': _dateKey(date),
        'slot': slot.wire,
        'entries':
            entries.map((MealEntry entry) => entry.toJson()).toList(),
      };

  factory MealRecord.fromJson(Map<String, Object?> json) {
    final String rawSlot = readString(json, 'slot');
    final MealSlot? slot = MealSlot.fromWire(rawSlot);
    if (slot == null) {
      throw FormatException('未知餐次 "$rawSlot"');
    }
    final List<MealEntry> entries = readListOrEmpty(json, 'entries')
        .whereType<Map<Object?, Object?>>()
        .map((Map<Object?, Object?> item) =>
            MealEntry.fromJson(Map<String, Object?>.from(item)))
        .toList(growable: false);
    if (entries.isEmpty) {
      throw const FormatException('餐次记录不能没有条目');
    }
    return MealRecord(
      id: readString(json, 'id'),
      date: _parseDate(readString(json, 'date')),
      slot: slot,
      entries: entries,
    );
  }
}

/// 份数的展示文案（界面步长为 0.5），例：1 →「1 份」、1.5 →「1.5 份」。
String formatCanteenServings(double servings) {
  if (servings == servings.roundToDouble()) {
    return '${servings.toInt()} 份';
  }
  return '${servings.toStringAsFixed(1)} 份';
}

/// 只保留本地时区的年月日。
DateTime canteenDateOnly(DateTime value) =>
    DateTime(value.year, value.month, value.day);

/// 两个时刻是否落在同一天（按本地年月日比较，不看时分秒）。
bool isSameCanteenDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// 某一天的记录；顺序保持记录列表原来的顺序。
List<MealRecord> mealRecordsOn(
  Iterable<MealRecord> records,
  DateTime day,
) =>
    records
        .where((MealRecord record) => isSameCanteenDay(record.date, day))
        .toList(growable: false);

/* ------------------------------------------------------------------ *
 * 保存前的校验
 * ------------------------------------------------------------------ */

/// 「记一餐」不能保存的原因。
enum MealDraftProblem {
  empty('还没有加入菜品，空餐次不能保存'),
  invalidServings('份数需要大于 0');

  const MealDraftProblem(this.message);

  final String message;
}

/// 校验一餐的条目；返回空列表表示可以保存。
///
/// 页面与控制器**共用**这一份规则，避免「按钮禁用但控制器放行」这类分叉。
List<MealDraftProblem> validateMealDraft(List<MealEntry> entries) {
  final List<MealDraftProblem> problems = <MealDraftProblem>[];
  if (entries.isEmpty) {
    problems.add(MealDraftProblem.empty);
  }
  if (entries.any((MealEntry entry) =>
      !entry.servings.isFinite || entry.servings <= 0)) {
    problems.add(MealDraftProblem.invalidServings);
  }
  return problems;
}

/// 控制器在保存被规则拦住时抛出；`message` 可直接展示。
final class MealDraftException implements Exception {
  const MealDraftException(this.problems);

  final List<MealDraftProblem> problems;

  String get message => problems
      .map((MealDraftProblem problem) => problem.message)
      .join('；');

  @override
  String toString() => 'MealDraftException: $message';
}

/* ------------------------------------------------------------------ *
 * 日期序列化（本地缓存只认 `yyyy-MM-dd`）
 * ------------------------------------------------------------------ */

String _dateKey(DateTime value) =>
    '${value.year.toString().padLeft(4, '0')}-'
    '${value.month.toString().padLeft(2, '0')}-'
    '${value.day.toString().padLeft(2, '0')}';

DateTime _parseDate(String value) {
  final List<String> parts = value.split('-');
  if (parts.length != 3) {
    throw FormatException('日期应为 yyyy-MM-dd，实际为 "$value"');
  }
  final int? year = int.tryParse(parts[0]);
  final int? month = int.tryParse(parts[1]);
  final int? day = int.tryParse(parts[2]);
  if (year == null || month == null || day == null) {
    throw FormatException('日期应为 yyyy-MM-dd，实际为 "$value"');
  }
  final DateTime parsed = DateTime(year, month, day);
  if (parsed.year != year || parsed.month != month || parsed.day != day) {
    throw FormatException('日期不合法 "$value"');
  }
  return parsed;
}
